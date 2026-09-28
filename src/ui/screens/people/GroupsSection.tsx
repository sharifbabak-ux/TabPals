import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { groupsRepository } from "@/data/repositories";
import type { Group } from "@/data/types";
import { toPersianDigits } from "@/domain/format";
import { EmptyState } from "@/ui/components/EmptyState";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { GroupFormSheet } from "./GroupFormSheet";

export function GroupsSection() {
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Group | null>(null);

  const groups = useLiveQuery(() => db.groups.filter((g) => !g.deleted).toArray(), []);
  const persons = useLiveQuery(() => db.persons.filter((p) => !p.deleted && !p.archived).toArray(), []);

  const filteredGroups = useMemo(() => {
    if (!groups) return undefined;
    return groups.filter((group) => showArchived || !group.archived).sort((a, b) => a.name.localeCompare(b.name, "fa"));
  }, [groups, showArchived]);

  async function handleArchiveConfirm() {
    if (!archiveTarget) return;
    await groupsRepository.setArchived(archiveTarget.id, !archiveTarget.archived);
    setArchiveTarget(null);
  }

  return (
    <section>
      <div className="screen-header">
        <h2 className="section-title" style={{ margin: 0 }}>
          گروه‌ها
        </h2>
        <button type="button" className="icon-button" onClick={() => setCreating(true)} aria-label="گروه جدید">
          +
        </button>
      </div>

      <label className="toggle-row">
        <span>نمایش گروه‌های آرشیو شده</span>
        <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
      </label>

      {filteredGroups && filteredGroups.length === 0 && <EmptyState hint="هنوز گروهی نساخته‌اید." />}

      <ul className="list">
        {filteredGroups?.map((group) => (
          <li
            key={group.id}
            className={`list-item${group.archived ? " list-item--archived" : ""}`}
            onClick={() => setEditing(group)}
          >
            <div className="list-item__main">
              <span className="list-item__title">{group.name}</span>
              <span className="list-item__subtitle">{toPersianDigits(group.personIds.length)} عضو</span>
            </div>
            <div className="list-item__meta">
              <button
                type="button"
                className="list-item__action"
                onClick={(event) => {
                  event.stopPropagation();
                  setArchiveTarget(group);
                }}
              >
                {group.archived ? "بازگردانی" : "آرشیو"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <GroupFormSheet
        open={creating}
        persons={persons ?? []}
        onClose={() => setCreating(false)}
        onSubmit={async (input) => {
          await groupsRepository.create(input);
          setCreating(false);
        }}
      />

      <GroupFormSheet
        open={editing !== null}
        group={editing ?? undefined}
        persons={persons ?? []}
        onClose={() => setEditing(null)}
        onSubmit={async (input) => {
          if (editing) await groupsRepository.update(editing.id, input);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        title={archiveTarget?.archived ? "بازگردانی گروه" : "آرشیو گروه"}
        message={archiveTarget?.archived ? `«${archiveTarget?.name}» از آرشیو خارج شود؟` : `«${archiveTarget?.name}» آرشیو شود؟`}
        confirmLabel={archiveTarget?.archived ? "بازگردانی" : "آرشیو"}
        onConfirm={handleArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
      />
    </section>
  );
}
