import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { ONLINE_ENABLED } from "@/config/app";
import { db } from "@/data/db";
import { eventMembersRepository, eventsRepository } from "@/data/repositories";
import { personFullName } from "@/domain/displayName";
import { isEventClosed } from "@/domain/eventStatus";
import { toPersianDigits } from "@/domain/format";
import { EmptyState } from "@/ui/components/EmptyState";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { Logo } from "@/ui/components/Logo";
import { Switch } from "@/ui/components/Switch";
import "./online/online.css";
import { EventFormSheet } from "./events/EventFormSheet";
import { JoinWithInviteSheet } from "./online/JoinWithInviteSheet";

export function EventsScreen() {
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const onlineIds = useLiveQuery(async () => new Set((await db.onlineLinks.toArray()).filter((l) => l.status !== "revoked").map((l) => l.localEventId)), []);

  const events = useLiveQuery(() => db.events.filter((event) => !event.deleted && !event.deletedAt).toArray(), []);
  const persons = useLiveQuery(() => db.persons.filter((p) => !p.deleted && !p.archived).toArray(), []);

  const memberCounts = useLiveQuery(async () => {
    const members = await db.eventMembers.filter((member) => !member.deleted && member.active).toArray();
    const counts = new Map<string, number>();
    for (const member of members) {
      counts.set(member.eventId, (counts.get(member.eventId) ?? 0) + 1);
    }
    return counts;
  }, []);

  const filtered = useMemo(() => {
    if (!events) return undefined;
    return events
      .filter((event) => showArchived || !event.archived)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [events, showArchived]);

  return (
    <div className="screen">
      <div className="screen-header screen-header--brand">
        <Logo showTagline />
        <button type="button" className="icon-button" onClick={() => setCreating(true)} aria-label="ایونت جدید">
          +
        </button>
      </div>

      <Switch checked={showArchived} onChange={setShowArchived} label="نمایش آرشیو شده‌ها" />
      {ONLINE_ENABLED && (
        <div className="action-grid">
          <button type="button" onClick={() => setJoinOpen(true)}>
            پیوستن با دعوت
          </button>
        </div>
      )}

      {filtered && filtered.length === 0 && <EmptyState hint="هنوز ایونتی نساخته‌اید. با دکمه‌ی + شروع کنید." />}

      <ul className="list">
        {filtered?.map((event) => (
          <li
            key={event.id}
            className={`list-item${event.archived ? " list-item--archived" : ""}`}
            onClick={() => navigate(`/events/${event.id}`)}
          >
            <div className="list-item__main">
              <span className="list-item__title">{event.title}</span>
              {event.startDate && (
                <span className="list-item__subtitle">
                  <JalaliDate date={new Date(event.startDate)} />
                </span>
              )}
            </div>
            <div className="list-item__meta">
              {onlineIds?.has(event.id) && <span className="badge badge--online">آنلاین</span>}
              {isEventClosed(event, new Date()) && <span className="badge badge--closed">پایان‌یافته</span>}
              <span className="badge">{toPersianDigits(memberCounts?.get(event.id) ?? 0)} نفر</span>
            </div>
          </li>
        ))}
      </ul>

      <JoinWithInviteSheet open={joinOpen} onClose={() => setJoinOpen(false)} />

      <EventFormSheet
        open={creating}
        treasurerOptions={(persons ?? []).map((p) => ({
          id: p.id,
          name: personFullName(p),
          cardNumber: p.cardNumber,
          iban: p.iban,
          bankName: p.bankName,
          accountHolder: p.accountHolder
        }))}
        onClose={() => setCreating(false)}
        onSubmit={async (input) => {
          const event = await eventsRepository.create(input);
          if (input.treasurerPersonId) {
            await eventMembersRepository.addMember(event.id, input.treasurerPersonId);
          }
          setCreating(false);
          navigate(`/events/${event.id}`);
        }}
      />
    </div>
  );
}
