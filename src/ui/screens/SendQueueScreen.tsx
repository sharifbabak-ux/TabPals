import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { db } from "@/data/db";
import type { SendChannel } from "@/data/types";
import { statementsRepository } from "@/data/repositories";
import { displayName } from "@/domain/displayName";
import { formatAmount, toPersianDigits } from "@/domain/format";
import type { StatementLinkData } from "@/domain/statementLink";
import { Avatar } from "@/ui/components/Avatar";
import { EmptyState } from "@/ui/components/EmptyState";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { openSms, openTelegram, openWhatsApp, shareStatementFile } from "./statements/sendActions";
import "./events/StatementsSection.css";

const SEND_CHANNEL_LABELS: Record<SendChannel, string> = {
  share: "فایل",
  whatsapp: "واتس‌اپ",
  telegram: "تلگرام",
  sms: "پیامک",
  print: "چاپ"
};

/**
 * "هر نفر جدا" bulk send queue (docs/PLAN.md Stage 3C): one row per member
 * with per-channel buttons; tapping a channel logs the send and marks the
 * row done. The selected member list lives in the URL's `personIds` query
 * param and progress is derived live from each statement's own `sendLog`,
 * so the whole screen survives the app being closed and reopened.
 */
export function SendQueueScreen() {
  const { eventId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const personIds = useMemo(() => (searchParams.get("personIds") ?? "").split(",").filter(Boolean), [searchParams]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const event = useLiveQuery(() => db.events.get(eventId), [eventId]);

  const rows = useLiveQuery(async () => {
    if (personIds.length === 0) return [];
    const allMemberRows = await db.eventMembers
      .where("eventId")
      .equals(eventId)
      .filter((m) => !m.deleted)
      .toArray();
    const allPersons = await db.persons.bulkGet(allMemberRows.map((m) => m.personId));
    const nameParts = allMemberRows.map((m, i) => ({ personId: m.personId, firstName: allPersons[i]?.firstName ?? "؟", lastName: allPersons[i]?.lastName ?? "" }));

    const statements = await db.statements
      .where("eventId")
      .equals(eventId)
      .filter((s) => !s.deleted && s.status === "current" && s.personId !== null && personIds.includes(s.personId))
      .toArray();

    return personIds
      .map((personId) => {
        const memberRow = allMemberRows.find((m) => m.personId === personId);
        const person = allPersons.find((p) => p?.id === personId);
        const statement = statements.find((s) => s.personId === personId);
        if (!memberRow || !person || !statement) return null;
        const data = JSON.parse(statement.snapshot) as StatementLinkData;
        return {
          personId,
          name: displayName({ personId, firstName: person.firstName, lastName: person.lastName }, nameParts),
          photo: person.photo,
          phone: person.phone,
          statement,
          data
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }, [eventId, personIds]);

  if (!event || !rows) return <div className="screen" />;

  const doneCount = rows.filter((r) => r.statement.sendLog.length > 0).length;

  async function handleChannel(row: NonNullable<typeof rows>[number], channel: SendChannel) {
    const key = `${row.personId}-${channel}`;
    setBusyKey(key);
    setError(null);
    try {
      if (channel === "share") {
        const result = await shareStatementFile(row.statement, row.data, event!.title, "image");
        if (result.message) setError(result.message);
      } else if (channel === "whatsapp") {
        openWhatsApp(row.statement, row.data, event!.title, row.phone);
      } else if (channel === "telegram") {
        openTelegram(row.statement, row.data, event!.title, row.phone);
      } else if (channel === "sms") {
        openSms(row.statement, row.data, event!.title, row.phone);
      }
      await statementsRepository.logSend(row.statement.id, channel, row.personId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در ارسال");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="screen">
      <button type="button" className="back-link" onClick={() => navigate(`/events/${eventId}`)}>
        ← بازگشت
      </button>

      <h1>صف ارسال گروهی</h1>
      <p className="field__hint">
        {toPersianDigits(doneCount)} از {toPersianDigits(rows.length)} ارسال شد
      </p>
      {error && <p className="field__error">{error}</p>}

      {rows.length === 0 ? (
        <EmptyState hint="عضوی برای ارسال پیدا نشد." />
      ) : (
        <ul className="list">
          {rows.map((row) => {
            const lastSend = row.statement.sendLog[row.statement.sendLog.length - 1];
            const balance = row.data.kind === "comprehensive" ? 0 : row.data.summary.balance;
            const chipClass = balance > 0 ? "balance-chip balance-chip--creditor" : balance < 0 ? "balance-chip balance-chip--debtor" : "balance-chip";
            return (
              <li key={row.personId} className="list-item send-queue-row">
                <Avatar id={row.personId} name={row.name} photo={row.photo} />
                <div className="list-item__main">
                  <span className="list-item__title">{row.name}</span>
                  {row.data.kind !== "comprehensive" && (
                    <span className={chipClass}>
                      {formatAmount(Math.abs(balance))} {row.data.event.currency}
                    </span>
                  )}
                  {lastSend && (
                    <span className="list-item__subtitle">
                      ارسال شد: {SEND_CHANNEL_LABELS[lastSend.channel]} · <JalaliDate date={new Date(lastSend.at)} time />
                    </span>
                  )}
                  <div className="send-queue-row__actions">
                    <button type="button" disabled={busyKey !== null} onClick={() => handleChannel(row, "share")}>
                      {busyKey === `${row.personId}-share` ? "در حال آماده‌سازی…" : "فایل"}
                    </button>
                    <button type="button" disabled={busyKey !== null} onClick={() => handleChannel(row, "whatsapp")}>
                      واتس‌اپ
                    </button>
                    <button type="button" disabled={busyKey !== null} onClick={() => handleChannel(row, "telegram")}>
                      تلگرام
                    </button>
                    <button type="button" disabled={busyKey !== null} onClick={() => handleChannel(row, "sms")}>
                      پیامک
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
