import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { eventMembersRepository, eventsRepository, personsRepository } from "@/data/repositories";
import type { EventMember } from "@/data/types";
import { isEventClosed } from "@/domain/eventStatus";
import { formatJalaliDate } from "@/domain/format";
import { Avatar } from "@/ui/components/Avatar";
import { EmptyState } from "@/ui/components/EmptyState";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { Switch } from "@/ui/components/Switch";
import { Tabs } from "@/ui/components/Tabs";
import { PersonFormSheet } from "./people/PersonFormSheet";
import { AddMembersSheet } from "./events/AddMembersSheet";
import { ImportMembersSheet } from "./events/ImportMembersSheet";
import { AddGroupSheet } from "./events/AddGroupSheet";
import { EventFormSheet } from "./events/EventFormSheet";
import { EventStatusControls } from "./events/EventStatusControls";
import { VouchersSection } from "./events/VouchersSection";
import { BalancesPanel } from "./events/BalancesPanel";

type MemberRow = EventMember & { name: string };
type EventTab = "members" | "vouchers";

export function EventDetailScreen() {
  const { eventId = "" } = useParams();
  const navigate = useNavigate();

  const [tab, setTab] = useState<EventTab>("members");
  const [showInactive, setShowInactive] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [createPersonOpen, setCreatePersonOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<MemberRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(false);

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

  const activeMemberOptions = useMemo(
    () => (members ?? []).filter((member) => member.active).map((member) => ({ personId: member.personId, name: member.name })),
    [members]
  );

  const visibleMembers = useMemo(() => {
    if (!members) return undefined;
    return members.filter((member) => showInactive || member.active);
  }, [members, showInactive]);

  async function handleDeactivateConfirm() {
    if (!deactivateTarget) return;
    await eventMembersRepository.setActive(deactivateTarget.id, !deactivateTarget.active);
    setDeactivateTarget(null);
  }

  async function handleArchiveConfirm() {
    if (!event) return;
    await eventsRepository.setArchived(eventId, !event.archived);
    setArchiveTarget(false);
    setEditOpen(false);
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

  const closed = isEventClosed(event, new Date());

  return (
    <div className="screen">
      <button type="button" className="back-link" onClick={() => navigate("/events")}>
        ← بازگشت به ایونت‌ها
      </button>

      <div className="screen-header">
        <h1>{event.title}</h1>
        <button
          type="button"
          className="icon-button icon-button--ghost icon-button--label"
          onClick={() => setEditOpen(true)}
          aria-label="ویرایش ایونت"
        >
          ویرایش
        </button>
      </div>

      {(event.startDate || event.endDate) && (
        <p className="event-detail__dates">
          {event.startDate && formatJalaliDate(new Date(event.startDate))}
          {event.startDate && event.endDate && " تا "}
          {event.endDate && formatJalaliDate(new Date(event.endDate))}
        </p>
      )}

      <div className="event-status-bar">
        {closed && <span className="badge badge--closed">پایان‌یافته</span>}
        <EventStatusControls eventId={eventId} closed={closed} />
      </div>

      <Tabs
        options={[
          { value: "members", label: "اعضا" },
          { value: "vouchers", label: "اسناد" }
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "members" ? (
        <>
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
          <Switch checked={showInactive} onChange={setShowInactive} label="نمایش غیرفعال‌ها" />

          {visibleMembers && visibleMembers.length === 0 && <EmptyState hint="هنوز عضوی اضافه نشده است." />}

          <ul className="list">
            {visibleMembers?.map((member) => (
              <li key={member.id} className={`list-item${member.active ? "" : " list-item--archived"}`}>
                <Avatar id={member.personId} name={member.name} />
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

          <BalancesPanel eventId={eventId} members={activeMemberOptions} currencyLabel={event.currencyLabel} />
        </>
      ) : (
        <VouchersSection eventId={eventId} currencyLabel={event.currencyLabel} activeMembers={activeMemberOptions} eventClosed={closed} />
      )}

      <AddMembersSheet
        open={addOpen}
        excludePersonIds={activeMemberOptions.map((m) => m.personId)}
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

      <EventFormSheet
        open={editOpen}
        event={event}
        onClose={() => setEditOpen(false)}
        onSubmit={async (input) => {
          await eventsRepository.update(eventId, input);
          setEditOpen(false);
        }}
        onArchiveRequest={() => setArchiveTarget(true)}
      />

      <ConfirmDialog
        open={archiveTarget}
        title={event.archived ? "بازگردانی ایونت" : "آرشیو ایونت"}
        message={event.archived ? `«${event.title}» از آرشیو خارج شود؟` : `«${event.title}» آرشیو شود؟ اطلاعات حذف نمی‌شود.`}
        confirmLabel={event.archived ? "بازگردانی" : "آرشیو"}
        onConfirm={handleArchiveConfirm}
        onCancel={() => setArchiveTarget(false)}
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
