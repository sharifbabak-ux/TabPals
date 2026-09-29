import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { db } from "@/data/db";
import { eventMembersRepository, eventsRepository, personsRepository } from "@/data/repositories";
import type { EventMember } from "@/data/types";
import { canTrashEvent } from "@/domain/deletionGuards";
import { displayName } from "@/domain/displayName";
import { isEventClosed } from "@/domain/eventStatus";
import { JalaliDate } from "@/ui/components/JalaliDate";
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
import { MemberRow } from "./events/MemberRow";
import { VouchersSection } from "./events/VouchersSection";
import { BalancesPanel } from "./events/BalancesPanel";
import { StatementsSection } from "./events/StatementsSection";

type MemberRowData = EventMember & { name: string; firstName: string; lastName: string; photo?: Blob };
type EventTab = "members" | "vouchers" | "statements";

/** Merges a new order for the visible subset back into the full member list, keeping hidden rows in their original slots. */
function mergeReorderedIds(allIds: string[], visibleIdsInNewOrder: string[]): string[] {
  const visibleSet = new Set(visibleIdsInNewOrder);
  let cursor = 0;
  return allIds.map((id) => (visibleSet.has(id) ? visibleIdsInNewOrder[cursor++] : id));
}

export function EventDetailScreen() {
  const { eventId = "" } = useParams();
  const navigate = useNavigate();

  const [tab, setTab] = useState<EventTab>("members");
  const [showInactive, setShowInactive] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [createPersonOpen, setCreatePersonOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<MemberRowData | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState(false);
  const [trashConfirmOpen, setTrashConfirmOpen] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );

  const event = useLiveQuery(() => db.events.get(eventId), [eventId]);

  const members = useLiveQuery(async (): Promise<MemberRowData[]> => {
    const rows = await db.eventMembers
      .where("eventId")
      .equals(eventId)
      .filter((member) => !member.deleted)
      .toArray();
    const persons = await db.persons.bulkGet(rows.map((row) => row.personId));
    // displayName disambiguates by first name among ALL members of the event, active or inactive (docs/PLAN.md Stage 3B.1).
    const nameParts = rows.map((row, index) => ({
      personId: row.personId,
      firstName: persons[index]?.firstName ?? "؟",
      lastName: persons[index]?.lastName ?? ""
    }));
    return rows
      .map((row, index) => {
        const parts = nameParts[index];
        return { ...row, name: displayName(parts, nameParts), firstName: parts.firstName, lastName: parts.lastName, photo: persons[index]?.photo };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [eventId]);

  const activePersons = useLiveQuery(() => db.persons.filter((p) => !p.deleted && !p.archived).toArray(), []);

  const memberPersonRecords = useLiveQuery(async () => {
    if (!members || members.length === 0) return [];
    const records = await db.persons.bulkGet(members.map((m) => m.personId));
    return records.filter((p): p is NonNullable<typeof p> => Boolean(p));
  }, [members]);

  const activeMemberOptions = useMemo(
    () =>
      (members ?? [])
        .filter((member) => member.active)
        .map((member) => ({ personId: member.personId, name: member.name, photo: member.photo })),
    [members]
  );

  const treasurerName = useMemo(
    () => (event ? members?.find((m) => m.personId === event.treasurerPersonId)?.name ?? null : null),
    [members, event]
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

  async function handleTrashConfirm() {
    setTrashError(null);
    try {
      await eventsRepository.moveToTrash(eventId);
      setTrashConfirmOpen(false);
      navigate("/events");
    } catch (e) {
      setTrashError(e instanceof Error ? e.message : "خطایی رخ داد");
    }
  }

  async function handleDragEnd(dragEvent: DragEndEvent) {
    if (!members || !visibleMembers) return;
    const { active, over } = dragEvent;
    if (!over || active.id === over.id) return;

    const visibleIds = visibleMembers.map((m) => m.id);
    const oldIndex = visibleIds.indexOf(String(active.id));
    const newIndex = visibleIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const reorderedVisible = [...visibleIds];
    reorderedVisible.splice(oldIndex, 1);
    reorderedVisible.splice(newIndex, 0, String(active.id));

    const allIds = members.map((m) => m.id);
    await eventMembersRepository.reorder(eventId, mergeReorderedIds(allIds, reorderedVisible));
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
          {event.startDate && <JalaliDate date={new Date(event.startDate)} />}
          {event.startDate && event.endDate && " تا "}
          {event.endDate && <JalaliDate date={new Date(event.endDate)} />}
        </p>
      )}

      <div className="event-status-bar">
        {closed && <span className="badge badge--closed">پایان‌یافته</span>}
        <EventStatusControls eventId={eventId} closed={closed} />
        {canTrashEvent(event).allowed && (
          <button type="button" className="sheet__archive-button" onClick={() => setTrashConfirmOpen(true)}>
            حذف ایونت
          </button>
        )}
      </div>
      {trashError && <p className="field__error">{trashError}</p>}

      <Tabs
        options={[
          { value: "members", label: "اعضا" },
          { value: "vouchers", label: "اسناد" },
          { value: "statements", label: "صورت‌حساب‌ها" }
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "members" ? (
        <>
          {closed && <p className="field__hint event-detail__closed-note">این ایونت پایان‌یافته است؛ برای تغییر، ابتدا آن را بازگشایی کنید.</p>}

          <div className={`action-grid${closed ? " action-grid--disabled" : ""}`}>
            <button type="button" disabled={closed} onClick={() => setAddOpen(true)}>
              + افزودن از اشخاص
            </button>
            <button type="button" disabled={closed} onClick={() => setCreatePersonOpen(true)}>
              + شخص جدید
            </button>
            <button type="button" disabled={closed} onClick={() => setImportOpen(true)}>
              وارد کردن از ایونت قبلی
            </button>
            <button type="button" disabled={closed} onClick={() => setGroupOpen(true)}>
              + افزودن گروه
            </button>
          </div>

          <h2 className="section-title">اعضا</h2>
          <Switch checked={showInactive} onChange={setShowInactive} label="نمایش غیرفعال‌ها" />

          {visibleMembers && visibleMembers.length === 0 && <EmptyState hint="هنوز عضوی اضافه نشده است." />}

          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext items={(visibleMembers ?? []).map((m) => m.id)} strategy={verticalListSortingStrategy}>
              <ul className="list">
                {visibleMembers?.map((member) => (
                  <MemberRow
                    key={member.id}
                    id={member.id}
                    personId={member.personId}
                    name={member.name}
                    photo={member.photo}
                    active={member.active}
                    isTreasurer={member.personId === event.treasurerPersonId}
                    disabled={closed}
                    onToggleActive={() => setDeactivateTarget(member)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>

          <BalancesPanel eventId={eventId} members={activeMemberOptions} currency={event.currency} />
        </>
      ) : tab === "vouchers" ? (
        <VouchersSection
          eventId={eventId}
          currency={event.currency}
          activeMembers={activeMemberOptions}
          eventClosed={closed}
          treasurerPersonId={event.treasurerPersonId}
          treasurerName={treasurerName}
        />
      ) : (
        <StatementsSection
          eventId={eventId}
          eventClosed={closed}
          treasurerPersonId={event.treasurerPersonId}
          activeMembers={activeMemberOptions}
          onRequestSetTreasurer={() => setEditOpen(true)}
        />
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
        existingNames={(activePersons ?? []).map((person) => ({ firstName: person.firstName, lastName: person.lastName }))}
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
        closed={closed}
        treasurerOptions={members.map((m) => {
          const person = memberPersonRecords?.find((p) => p.id === m.personId);
          return {
            id: m.personId,
            name: m.name,
            cardNumber: person?.cardNumber,
            iban: person?.iban,
            bankName: person?.bankName,
            accountHolder: person?.accountHolder
          };
        })}
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

      <ConfirmDialog
        open={trashConfirmOpen}
        title="حذف ایونت"
        message={`«${event.title}» به سطل بازیافت منتقل شود؟ از سطل بازیافت (در تنظیمات) می‌توانید آن را بازگردانید یا برای همیشه حذف کنید.`}
        confirmLabel="انتقال به سطل بازیافت"
        danger
        onConfirm={handleTrashConfirm}
        onCancel={() => setTrashConfirmOpen(false)}
      />
    </div>
  );
}
