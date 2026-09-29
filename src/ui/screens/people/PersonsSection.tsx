import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { personsRepository } from "@/data/repositories";
import type { Person } from "@/data/types";
import { personFullName } from "@/domain/displayName";
import { Avatar } from "@/ui/components/Avatar";
import { EmptyState } from "@/ui/components/EmptyState";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { Switch } from "@/ui/components/Switch";
import { PersonFormSheet } from "./PersonFormSheet";

export function PersonsSection() {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Person | null>(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<Person | null>(null);
  const [permanentDeleteError, setPermanentDeleteError] = useState<string | null>(null);

  const persons = useLiveQuery(() => db.persons.filter((p) => !p.deleted).toArray(), []);

  const filtered = useMemo(() => {
    if (!persons) return undefined;
    const term = search.trim().toLowerCase();
    return persons
      .filter((person) => showArchived || !person.archived)
      .filter((person) => !term || personFullName(person).toLowerCase().includes(term))
      .sort((a, b) => personFullName(a).localeCompare(personFullName(b), "fa"));
  }, [persons, search, showArchived]);

  const editingReferences = useLiveQuery(async () => {
    if (!editing || !editing.archived) return undefined;
    return personsRepository.referencingEvents(editing.id);
  }, [editing]);

  async function handleArchiveConfirm() {
    if (!archiveTarget) return;
    await personsRepository.setArchived(archiveTarget.id, !archiveTarget.archived);
    setArchiveTarget(null);
    setEditing(null);
  }

  async function handlePermanentDeleteConfirm() {
    if (!permanentDeleteTarget) return;
    setPermanentDeleteError(null);
    try {
      await personsRepository.permanentlyDelete(permanentDeleteTarget.id);
      setPermanentDeleteTarget(null);
      setEditing(null);
    } catch (e) {
      setPermanentDeleteError(e instanceof Error ? e.message : "خطایی رخ داد");
    }
  }

  return (
    <section>
      <div className="screen-header">
        <input
          className="search-input"
          style={{ marginBottom: 0, flex: 1 }}
          type="search"
          placeholder="جستجوی نام..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button" className="icon-button" onClick={() => setCreating(true)} aria-label="افزودن شخص">
          +
        </button>
      </div>

      <Switch checked={showArchived} onChange={setShowArchived} label="نمایش آرشیو شده‌ها" />

      {filtered && filtered.length === 0 && (
        <EmptyState hint={search ? "شخصی با این نام پیدا نشد." : "هنوز شخصی اضافه نشده. با دکمه‌ی + شروع کنید."} />
      )}

      <ul className="list">
        {filtered?.map((person) => (
          <li
            key={person.id}
            className={`list-item${person.archived ? " list-item--archived" : ""}`}
            onClick={() => setEditing(person)}
          >
            <Avatar id={person.id} name={personFullName(person)} photo={person.photo} />
            <div className="list-item__main">
              <span className="list-item__title">{personFullName(person)}</span>
              {person.phone && <span className="list-item__subtitle">{person.phone}</span>}
            </div>
          </li>
        ))}
      </ul>

      <PersonFormSheet
        open={creating}
        existingNames={(persons ?? []).filter((p) => !p.archived).map((p) => ({ firstName: p.firstName, lastName: p.lastName }))}
        onClose={() => setCreating(false)}
        onSubmit={async (input) => {
          await personsRepository.create(input);
          setCreating(false);
        }}
      />

      <PersonFormSheet
        open={editing !== null}
        person={editing ?? undefined}
        existingNames={(persons ?? [])
          .filter((p) => p.id !== editing?.id && !p.archived)
          .map((p) => ({ firstName: p.firstName, lastName: p.lastName }))}
        onClose={() => setEditing(null)}
        onSubmit={async (input) => {
          if (editing) await personsRepository.update(editing.id, input);
          setEditing(null);
        }}
        onArchiveRequest={() => setArchiveTarget(editing)}
        referencingEvents={editingReferences}
        onPermanentDeleteRequest={() => setPermanentDeleteTarget(editing)}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        title={archiveTarget?.archived ? "بازگردانی شخص" : "آرشیو شخص"}
        message={
          archiveTarget?.archived
            ? `«${archiveTarget ? personFullName(archiveTarget) : ""}» از آرشیو خارج شود؟`
            : `«${archiveTarget ? personFullName(archiveTarget) : ""}» آرشیو شود؟ اطلاعات حذف نمی‌شود و می‌توانید بعداً بازگردانید.`
        }
        confirmLabel={archiveTarget?.archived ? "بازگردانی" : "آرشیو"}
        onConfirm={handleArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        open={permanentDeleteTarget !== null}
        title="حذف دائمی شخص"
        message={`«${permanentDeleteTarget ? personFullName(permanentDeleteTarget) : ""}» برای همیشه حذف شود؟ این عملیات قابل بازگشت نیست.${
          permanentDeleteError ? ` — ${permanentDeleteError}` : ""
        }`}
        confirmLabel="حذف دائمی"
        danger
        onConfirm={handlePermanentDeleteConfirm}
        onCancel={() => {
          setPermanentDeleteTarget(null);
          setPermanentDeleteError(null);
        }}
      />
    </section>
  );
}
