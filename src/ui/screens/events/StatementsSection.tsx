import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { db } from "@/data/db";
import type { Statement } from "@/data/types";
import { statementsRepository } from "@/data/repositories";
import { toPersianDigits } from "@/domain/format";
import { EmptyState } from "@/ui/components/EmptyState";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { Avatar } from "@/ui/components/Avatar";
import "./StatementsSection.css";

interface MemberOption {
  personId: string;
  name: string;
  photo?: Blob;
}

interface StatementsSectionProps {
  eventId: string;
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

function nameOf(members: MemberOption[], personId: string | null): string {
  if (personId === null) return "گزارش جامع رویداد";
  return members.find((m) => m.personId === personId)?.name ?? "؟";
}

export function StatementsSection({ eventId, eventClosed, treasurerPersonId, activeMembers, onRequestSetTreasurer }: StatementsSectionProps) {
  const navigate = useNavigate();
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      </div>

      {error && <p className="field__error">{error}</p>}

      <h2 className="section-title">صورت‌حساب‌های صادرشده</h2>
      {sorted.length === 0 && <EmptyState hint="هنوز صورت‌حسابی صادر نشده است." />}

      <ul className="list">
        {sorted.map((statement) => {
          const name = nameOf(activeMembers, statement.personId);
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
    </div>
  );
}
