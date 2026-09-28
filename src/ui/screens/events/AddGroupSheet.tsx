import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { EmptyState } from "@/ui/components/EmptyState";
import { toPersianDigits } from "@/domain/format";

interface AddGroupSheetProps {
  open: boolean;
  onClose: () => void;
  onSelect: (personIds: string[]) => Promise<void>;
}

/** Action 4 — tap a saved group to add all of its members at once. */
export function AddGroupSheet({ open, onClose, onSelect }: AddGroupSheetProps) {
  const groups = useLiveQuery(() => db.groups.filter((group) => !group.deleted && !group.archived).toArray(), []);

  return (
    <BottomSheet open={open} title="افزودن گروه" onClose={onClose}>
      {groups && groups.length === 0 && <EmptyState hint="گروهی ساخته نشده. از بخش اشخاص گروه بسازید." />}
      <ul className="list">
        {groups?.map((group) => (
          <li key={group.id} className="list-item" onClick={() => onSelect(group.personIds)}>
            <div className="list-item__main">
              <span className="list-item__title">{group.name}</span>
              <span className="list-item__subtitle">{toPersianDigits(group.personIds.length)} عضو</span>
            </div>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
