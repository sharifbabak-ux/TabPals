import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { db } from "@/data/db";
import { eventsRepository } from "@/data/repositories";
import { isEventClosed } from "@/domain/eventStatus";
import { formatJalaliDate, toPersianDigits } from "@/domain/format";
import { EmptyState } from "@/ui/components/EmptyState";
import { Switch } from "@/ui/components/Switch";
import { EventFormSheet } from "./events/EventFormSheet";

export function EventsScreen() {
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  const events = useLiveQuery(() => db.events.filter((event) => !event.deleted).toArray(), []);

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
      <div className="screen-header">
        <h1>ایونت‌ها</h1>
        <button type="button" className="icon-button" onClick={() => setCreating(true)} aria-label="ایونت جدید">
          +
        </button>
      </div>

      <Switch checked={showArchived} onChange={setShowArchived} label="نمایش آرشیو شده‌ها" />

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
              {event.startDate && <span className="list-item__subtitle">{formatJalaliDate(new Date(event.startDate))}</span>}
            </div>
            <div className="list-item__meta">
              {isEventClosed(event, new Date()) && <span className="badge badge--closed">پایان‌یافته</span>}
              <span className="badge">{toPersianDigits(memberCounts?.get(event.id) ?? 0)} نفر</span>
            </div>
          </li>
        ))}
      </ul>

      <EventFormSheet
        open={creating}
        onClose={() => setCreating(false)}
        onSubmit={async (input) => {
          const event = await eventsRepository.create(input);
          setCreating(false);
          navigate(`/events/${event.id}`);
        }}
      />
    </div>
  );
}
