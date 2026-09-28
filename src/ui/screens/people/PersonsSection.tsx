import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { personsRepository } from "@/data/repositories";
import type { Person } from "@/data/types";
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

  const persons = useLiveQuery(() => db.persons.filter((p) => !p.deleted).toArray(), []);

  const filtered = useMemo(() => {
    if (!persons) return undefined;
    const term = search.trim().toLowerCase();
    return persons
      .filter((person) => showArchived || !person.archived)
      .filter((person) => !term || person.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name, "fa"));
  }, [persons, search, showArchived]);

  async function handleArchiveConfirm() {
    if (!archiveTarget) return;
    await personsRepository.setArchived(archiveTarget.id, !archiveTarget.archived);
    setArchiveTarget(null);
    setEditing(null);
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
            <div className="list-item__main">
              <span className="list-item__title">{person.name}</span>
              {person.phone && <span className="list-item__subtitle">{person.phone}</span>}
            </div>
          </li>
        ))}
      </ul>

      <PersonFormSheet
        open={creating}
        existingNames={(persons ?? []).filter((p) => !p.archived).map((p) => p.name)}
        onClose={() => setCreating(false)}
        onSubmit={async (input) => {
          await personsRepository.create(input);
          setCreating(false);
        }}
      />

      <PersonFormSheet
        open={editing !== null}
        person={editing ?? undefined}
        existingNames={(persons ?? []).filter((p) => p.id !== editing?.id && !p.archived).map((p) => p.name)}
        onClose={() => setEditing(null)}
        onSubmit={async (input) => {
          if (editing) await personsRepository.update(editing.id, input);
          setEditing(null);
        }}
        onArchiveRequest={() => setArchiveTarget(editing)}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        title={archiveTarget?.archived ? "بازگردانی شخص" : "آرشیو شخص"}
        message={
          archiveTarget?.archived
            ? `«${archiveTarget?.name}» از آرشیو خارج شود؟`
            : `«${archiveTarget?.name}» آرشیو شود؟ اطلاعات حذف نمی‌شود و می‌توانید بعداً بازگردانید.`
        }
        confirmLabel={archiveTarget?.archived ? "بازگردانی" : "آرشیو"}
        onConfirm={handleArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
      />
    </section>
  );
}
