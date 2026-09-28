import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { eventMembersRepository, personsRepository } from "@/data/repositories";
import type { EventMember } from "@/data/types";
import { formatJalaliDate } from "@/domain/format";
import { EmptyState } from "@/ui/components/EmptyState";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { PersonFormSheet } from "./people/PersonFormSheet";
import { AddMembersSheet } from "./events/AddMembersSheet";
import { ImportMembersSheet } from "./events/ImportMembersSheet";
import { AddGroupSheet } from "./events/AddGroupSheet";

type MemberRow = EventMember & { name: string };

export function EventDetailScreen() {
  const { eventId = "" } = useParams();
  const navigate = useNavigate();

  const [showInactive, setShowInactive] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [createPersonOpen, setCreatePersonOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<MemberRow | null>(null);

  const event = useLiveQuery(() => db.events.get(eventId), [eventId]);

  const members = useLiveQuery(async (): Promise<MemberRow[]> => {
    const rows = await db.eventMembers
      .where("eventId")
      .equals(eventId)
      .filter((member) => !member.deleted)
      .toArray();
    const persons = await db.persons.bulkGet(rows.map((row) => row.personId));
    return rows
      .map((row, index) => ({ ...row, name: persons[index]?.name ?? "؟" }))
      .sort((a, b) => a.name.localeCompare(b.name, "fa"));
  }, [eventId]);

  const activePersons = useLiveQuery(() => db.persons.filter((p) => !p.deleted && !p.archived).toArray(), []);

  const activeMemberPersonIds = useMemo(() => (members ?? []).filter((member) => member.active).map((member) => member.personId), [
    members
  ]);

  const visibleMembers = useMemo(() => {
    if (!members) return undefined;
    return members.filter((member) => showInactive || member.active);
  }, [members, showInactive]);

  async function handleDeactivateConfirm() {
    if (!deactivateTarget) return;
    await eventMembersRepository.setActive(deactivateTarget.id, !deactivateTarget.active);
    setDeactivateTarget(null);
  }

  if (event === undefined || members === undefined) {
    return <div className="screen" />;
  }

  if (event === null) {
    return (
      <div className="screen">
        <EmptyState hint="این ایونت پیدا نشد." />
      </div>
    );
  }

  return (
    <div className="screen">
      <button type="button" className="back-link" onClick={() => navigate("/events")}>
        ← بازگشت به ایونت‌ها
      </button>

      <h1>{event.title}</h1>
      {(event.startDate || event.endDate) && (
        <p className="event-detail__dates">
          {event.startDate && formatJalaliDate(new Date(event.startDate))}
          {event.startDate && event.endDate && " تا "}
          {event.endDate && formatJalaliDate(new Date(event.endDate))}
        </p>
      )}

      <div className="action-grid">
        <button type="button" onClick={() => setAddOpen(true)}>
          + افزودن از اشخاص
        </button>
        <button type="button" onClick={() => setCreatePersonOpen(true)}>
          + شخص جدید
        </button>
        <button type="button" onClick={() => setImportOpen(true)}>
          وارد کردن از ایونت قبلی
        </button>
        <button type="button" onClick={() => setGroupOpen(true)}>
          + افزودن گروه
        </button>
      </div>

      <h2 className="section-title">اعضا</h2>
      <label className="toggle-row">
        <span>نمایش غیرفعال‌ها</span>
        <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
      </label>

      {visibleMembers && visibleMembers.length === 0 && <EmptyState hint="هنوز عضوی اضافه نشده است." />}

      <ul className="list">
        {visibleMembers?.map((member) => (
          <li key={member.id} className={`list-item${member.active ? "" : " list-item--archived"}`}>
            <div className="list-item__main">
              <span className="list-item__title">{member.name}</span>
            </div>
            <div className="list-item__meta">
              <button type="button" className="list-item__action" onClick={() => setDeactivateTarget(member)}>
                {member.active ? "غیرفعال کردن" : "فعال کردن"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <AddMembersSheet
        open={addOpen}
        excludePersonIds={activeMemberPersonIds}
        onClose={() => setAddOpen(false)}
        onSubmit={async (personIds) => {
          await eventMembersRepository.addMembers(eventId, personIds);
          setAddOpen(false);
        }}
      />

      <PersonFormSheet
        open={createPersonOpen}
        existingNames={(activePersons ?? []).map((person) => person.name)}
        onClose={() => setCreatePersonOpen(false)}
        onSubmit={async (input) => {
          const person = await personsRepository.create(input);
          await eventMembersRepository.addMember(eventId, person.id);
          setCreatePersonOpen(false);
        }}
      />

      <ImportMembersSheet
        open={importOpen}
        currentEventId={eventId}
        currentMemberPersonIds={members.map((member) => member.personId)}
        onClose={() => setImportOpen(false)}
        onSubmit={async (personIds) => {
          await eventMembersRepository.addMembers(eventId, personIds);
          setImportOpen(false);
        }}
      />

      <AddGroupSheet
        open={groupOpen}
        onClose={() => setGroupOpen(false)}
        onSelect={async (personIds) => {
          await eventMembersRepository.addMembers(eventId, personIds);
          setGroupOpen(false);
        }}
      />

      <ConfirmDialog
        open={deactivateTarget !== null}
        title={deactivateTarget?.active ? "غیرفعال کردن عضو" : "فعال کردن عضو"}
        message={
          deactivateTarget?.active
            ? `«${deactivateTarget?.name}» از این ایونت غیرفعال شود؟ سابقه‌ی او حذف نمی‌شود.`
            : `«${deactivateTarget?.name}» دوباره فعال شود؟`
        }
        confirmLabel={deactivateTarget?.active ? "غیرفعال کردن" : "فعال کردن"}
        onConfirm={handleDeactivateConfirm}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
