import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { db } from "@/data/db";
import { formatAmount, toPersianDigits } from "@/domain/format";
import { EmptyState } from "@/ui/components/EmptyState";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { SessionFormSheet } from "./SessionFormSheet";
import { SessionStatusChip } from "./SessionStatusChip";

interface OrderSessionsSectionProps {
  eventId: string;
  currency: string;
  eventClosed: boolean;
  /** Member of an online event: sessions can be viewed but not created. */
  readOnly?: boolean;
  treasurerPersonId: string | null;
  treasurerName: string | null;
  onRequestSetTreasurer: () => void;
}

/** The event's «سفارش‌ها» tab: its group-order sessions, newest first (docs/PLAN.md Group Order UI #1). */
export function OrderSessionsSection({ eventId, currency, eventClosed, readOnly = false, treasurerPersonId, treasurerName, onRequestSetTreasurer }: OrderSessionsSectionProps) {
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = useState(false);

  const data = useLiveQuery(async () => {
    const sessions = await db.orderSessions
      .where("eventId")
      .equals(eventId)
      .filter((s) => !s.deleted)
      .toArray();
    const peopleBySession = new Map<string, Set<string>>();
    for (const session of sessions) {
      const people = new Set<string>();
      const lines = await db.orderLines.where("sessionId").equals(session.id).filter((l) => !l.deleted).toArray();
      for (const line of lines) {
        if (line.personId) people.add(line.personId);
        else for (const p of line.sharedParticipants ?? []) people.add(p.personId);
      }
      const totals = await db.orderPersonTotals.where("sessionId").equals(session.id).filter((t) => !t.deleted).toArray();
      for (const t of totals) people.add(t.personId);
      peopleBySession.set(session.id, people);
    }
    return { sessions, peopleBySession };
  }, [eventId]);

  const sorted = useMemo(() => (data?.sessions ?? []).slice().sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)), [data]);

  return (
    <div>
      <div className="screen-header">
        <h2 className="section-title" style={{ margin: 0 }}>
          سفارش‌ها
        </h2>
        {!eventClosed && !readOnly && (
          <button type="button" className="icon-button icon-button--label" onClick={() => setFormOpen(true)}>
            + نشست جدید
          </button>
        )}
      </div>

      {eventClosed && <p className="field__hint">این ایونت پایان‌یافته است؛ نشست‌ها فقط‌خواندنی‌اند.</p>}
      {sorted.length === 0 && <EmptyState hint="هنوز نشست سفارشی ثبت نشده است." />}

      <ul className="list">
        {sorted.map((session) => {
          const count = data?.peopleBySession.get(session.id)?.size ?? 0;
          return (
            <li key={session.id} className="list-item" onClick={() => navigate(`/events/${eventId}/orders/${session.id}`)}>
              <div className="list-item__main">
                <span className="list-item__title">
                  {session.title}
                  {session.restaurant ? ` · ${session.restaurant}` : ""}
                </span>
                <span className="list-item__subtitle">
                  <JalaliDate date={new Date(session.scheduledAt)} weekday time /> · {toPersianDigits(count)} نفر
                  {session.billTotal !== null ? ` · ${formatAmount(session.billTotal)} ${currency}` : ""}
                </span>
              </div>
              <SessionStatusChip status={session.status} />
            </li>
          );
        })}
      </ul>

      <SessionFormSheet
        open={formOpen}
        eventId={eventId}
        treasurerPersonId={treasurerPersonId}
        treasurerName={treasurerName}
        onClose={() => setFormOpen(false)}
        onRequestSetTreasurer={() => {
          setFormOpen(false);
          onRequestSetTreasurer();
        }}
        onCreated={(id) => {
          setFormOpen(false);
          navigate(`/events/${eventId}/orders/${id}`);
        }}
      />
    </div>
  );
}
