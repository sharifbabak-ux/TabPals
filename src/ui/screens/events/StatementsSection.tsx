import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { db } from "@/data/db";
import type { SendChannel, Statement } from "@/data/types";
import { statementsRepository } from "@/data/repositories";
import { toPersianDigits } from "@/domain/format";
import type { StatementLinkData } from "@/domain/statementLink";
import { EmptyState } from "@/ui/components/EmptyState";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { Avatar } from "@/ui/components/Avatar";
import { shareStatementFilesBulk } from "@/ui/screens/statements/sendActions";
import "./StatementsSection.css";

interface MemberOption {
  personId: string;
  name: string;
  photo?: Blob;
}

interface StatementsSectionProps {
  eventId: string;
  eventTitle: string;
  eventClosed: boolean;
  treasurerPersonId: string | null;
  activeMembers: MemberOption[];
  onRequestSetTreasurer: () => void;
}

const KIND_LABELS: Record<Statement["kind"], string> = {
  member: "صورت‌حساب عضو",
  treasurer: "صورت‌حساب مسئول صندوق",
  comprehensive: "گزارش جامع"
};

const SEND_CHANNEL_LABELS: Record<SendChannel, string> = {
  share: "فایل",
  whatsapp: "واتس‌اپ",
  telegram: "تلگرام",
  sms: "پیامک",
  print: "چاپ"
};

function nameOf(members: MemberOption[], personId: string | null): string {
  if (personId === null) return "گزارش جامع رویداد";
  return members.find((m) => m.personId === personId)?.name ?? "؟";
}

export function StatementsSection({ eventId, eventTitle, eventClosed, treasurerPersonId, activeMembers, onRequestSetTreasurer }: StatementsSectionProps) {
  const navigate = useNavigate();
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bulkPickerOpen, setBulkPickerOpen] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkModeOpen, setBulkModeOpen] = useState(false);
  const [issueConfirmIds, setIssueConfirmIds] = useState<string[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const statements = useLiveQuery(
    () =>
      db.statements
        .where("eventId")
        .equals(eventId)
        .filter((s) => !s.deleted)
        .toArray(),
    [eventId]
  );

  const sorted = useMemo(() => (statements ?? []).slice().sort((a, b) => b.number - a.number), [statements]);

  async function withBusy(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  function currentStatementFor(personId: string): Statement | undefined {
    return sorted.find((s) => s.personId === personId && s.status === "current");
  }

  function openBulkPicker() {
    setBulkSelected(new Set());
    setBulkError(null);
    setBulkPickerOpen(true);
  }

  function proceedToModePicker() {
    setBulkPickerOpen(false);
    const personIds = Array.from(bulkSelected);
    const missing = personIds.filter((id) => !currentStatementFor(id));
    if (missing.length > 0) {
      setIssueConfirmIds(personIds);
    } else {
      setBulkModeOpen(true);
    }
  }

  async function handleIssueMissingConfirm() {
    if (!issueConfirmIds) return;
    setBulkBusy(true);
    setBulkError(null);
    try {
      const missing = issueConfirmIds.filter((id) => !currentStatementFor(id));
      for (const personId of missing) {
        await statementsRepository.issueForMember(eventId, personId);
      }
      setIssueConfirmIds(null);
      setBulkModeOpen(true);
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "خطا در صدور صورت‌حساب");
      setIssueConfirmIds(null);
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleSendAllInOneChat() {
    setBulkBusy(true);
    setBulkError(null);
    try {
      const entries = Array.from(bulkSelected)
        .map((id) => currentStatementFor(id))
        .filter((s): s is Statement => Boolean(s))
        .map((statement) => ({ statement, data: JSON.parse(statement.snapshot) as StatementLinkData }));

      const result = await shareStatementFilesBulk(entries, eventTitle, "image");
      if (result.ok) {
        for (const { statement } of entries) {
          await statementsRepository.logSend(statement.id, "share", "group");
        }
        setBulkModeOpen(false);
        setBulkSelected(new Set());
      }
      if (result.message) setBulkError(result.message);
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "خطا در ارسال گروهی");
    } finally {
      setBulkBusy(false);
    }
  }

  function handleSendPerMemberSeparately() {
    const personIds = Array.from(bulkSelected);
    setBulkModeOpen(false);
    navigate(`/events/${eventId}/statements/send-queue?personIds=${personIds.join(",")}`);
  }

  if (!eventClosed) {
    return (
      <div>
        <EmptyState hint="صورت‌حساب پس از پایان ایونت قابل صدور است." />
      </div>
    );
  }

  if (!treasurerPersonId) {
    return (
      <div className="statements-section__prompt">
        <EmptyState hint="برای صدور صورت‌حساب، ابتدا باید مسئول صندوق این ایونت را تعیین کنید." />
        <button type="button" className="form-actions__primary" onClick={onRequestSetTreasurer}>
          تعیین مسئول صندوق
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="action-grid">
        <button type="button" disabled={busy} onClick={() => withBusy(() => statementsRepository.issueForAllMembers(eventId))}>
          صدور صورت‌حساب همه‌ی اعضا
        </button>
        <button type="button" disabled={busy || activeMembers.length === 0} onClick={() => setMemberPickerOpen(true)}>
          صدور برای یک عضو
        </button>
        <button type="button" disabled={busy} onClick={() => withBusy(() => statementsRepository.issueComprehensiveReport(eventId))}>
          صدور گزارش جامع
        </button>
        <button type="button" disabled={busy || activeMembers.length === 0} onClick={openBulkPicker}>
          ارسال گروهی
        </button>
      </div>

      {error && <p className="field__error">{error}</p>}

      <h2 className="section-title">صورت‌حساب‌های صادرشده</h2>
      {sorted.length === 0 && <EmptyState hint="هنوز صورت‌حسابی صادر نشده است." />}

      <ul className="list">
        {sorted.map((statement) => {
          const name = nameOf(activeMembers, statement.personId);
          const lastSend = statement.sendLog[statement.sendLog.length - 1];
          return (
            <li key={statement.id} className="list-item" onClick={() => navigate(`/events/${eventId}/statements/${statement.id}`)}>
              {statement.personId && <Avatar id={statement.personId} name={name} photo={activeMembers.find((m) => m.personId === statement.personId)?.photo} />}
              <div className="list-item__main">
                <span className="list-item__title">
                  #{toPersianDigits(statement.number)} · {KIND_LABELS[statement.kind]} · {name}
                </span>
                <span className="list-item__subtitle">
                  نسخه {toPersianDigits(statement.issueVersion)} · <JalaliDate date={new Date(statement.issuedAt)} /> · {statement.verificationCode}
                </span>
                {lastSend && (
                  <span className="list-item__subtitle">
                    آخرین ارسال: {SEND_CHANNEL_LABELS[lastSend.channel]} · <JalaliDate date={new Date(lastSend.at)} time />
                  </span>
                )}
              </div>
              <div className="list-item__meta">
                <span className={`badge statement-status-chip statement-status-chip--${statement.status}`}>
                  {statement.status === "current" ? "معتبر" : "منسوخ"}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <BottomSheet open={memberPickerOpen} title="صدور صورت‌حساب برای یک عضو" onClose={() => setMemberPickerOpen(false)}>
        <ul className="list">
          {activeMembers.map((member) => (
            <li
              key={member.personId}
              className="list-item"
              onClick={() => {
                setMemberPickerOpen(false);
                void withBusy(() => statementsRepository.issueForMember(eventId, member.personId));
              }}
            >
              <Avatar id={member.personId} name={member.name} photo={member.photo} />
              <div className="list-item__main">
                <span className="list-item__title">{member.name}</span>
                {member.personId === treasurerPersonId && <span className="list-item__subtitle">مسئول صندوق</span>}
              </div>
            </li>
          ))}
        </ul>
      </BottomSheet>

      <BottomSheet open={bulkPickerOpen} title="انتخاب اعضا برای ارسال گروهی" onClose={() => setBulkPickerOpen(false)}>
        <div className="checklist-actions">
          <button type="button" onClick={() => setBulkSelected(new Set(activeMembers.map((m) => m.personId)))}>
            همه
          </button>
          <button type="button" onClick={() => setBulkSelected(new Set())}>
            هیچ‌کدام
          </button>
        </div>
        <ul className="checklist">
          {activeMembers.map((member) => (
            <li key={member.personId} className="checklist-item">
              <input
                type="checkbox"
                id={`bulk-send-${member.personId}`}
                checked={bulkSelected.has(member.personId)}
                onChange={() =>
                  setBulkSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(member.personId)) next.delete(member.personId);
                    else next.add(member.personId);
                    return next;
                  })
                }
              />
              <label htmlFor={`bulk-send-${member.personId}`}>{member.name}</label>
            </li>
          ))}
        </ul>
        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={() => setBulkPickerOpen(false)}>
            انصراف
          </button>
          <button type="button" className="form-actions__primary" disabled={bulkSelected.size === 0} onClick={proceedToModePicker}>
            ادامه ({toPersianDigits(bulkSelected.size)})
          </button>
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={issueConfirmIds !== null}
        title="صدور صورت‌حساب‌های صادرنشده"
        message="برای برخی از اعضای انتخاب‌شده صورت‌حساب معتبری وجود ندارد (صادر نشده یا منسوخ است). ابتدا صادر شود؟"
        confirmLabel="صدور و ادامه"
        onConfirm={handleIssueMissingConfirm}
        onCancel={() => setIssueConfirmIds(null)}
      />

      <BottomSheet open={bulkModeOpen} title="روش ارسال گروهی" onClose={() => (bulkBusy ? undefined : setBulkModeOpen(false))}>
        <ul className="list">
          <li className="list-item" onClick={() => !bulkBusy && handleSendAllInOneChat()}>
            <div className="list-item__main">
              <span className="list-item__title">همه در یک گفتگو</span>
              <span className="list-item__subtitle">{bulkBusy ? "در حال آماده‌سازی…" : "همه به‌صورت تصویر، در یک اشتراک‌گذاری"}</span>
            </div>
          </li>
          <li className="list-item" onClick={() => !bulkBusy && handleSendPerMemberSeparately()}>
            <div className="list-item__main">
              <span className="list-item__title">هر نفر جدا</span>
              <span className="list-item__subtitle">صف ارسال، با دکمه‌ی ارسال جداگانه برای هر عضو</span>
            </div>
          </li>
        </ul>
        {bulkError && <p className="field__error">{bulkError}</p>}
      </BottomSheet>
    </div>
  );
}
