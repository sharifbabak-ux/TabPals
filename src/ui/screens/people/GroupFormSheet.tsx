import { useEffect, useState, type FormEvent } from "react";
import { BottomSheet } from "@/ui/components/BottomSheet";
import type { Group, Person } from "@/data/types";
import type { GroupInput } from "@/data/repositories/groupsRepository";

interface GroupFormSheetProps {
  open: boolean;
  group?: Group;
  /** Active persons available to add to the group. */
  persons: Person[];
  onClose: () => void;
  onSubmit: (input: GroupInput) => Promise<void>;
}

export function GroupFormSheet({ open, group, persons, onClose, onSubmit }: GroupFormSheetProps) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(group?.name ?? "");
      setSelected(new Set(group?.personIds ?? []));
    }
  }, [open, group]);

  const trimmedName = name.trim();
  const valid = trimmedName.length > 0 && selected.size > 0;

  function toggle(personId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ name: trimmedName, personIds: Array.from(selected) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet open={open} title={group ? "ویرایش گروه" : "گروه جدید"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="group-name">نام گروه</label>
          <input id="group-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </div>

        <div className="section-title">اعضا</div>
        {persons.length === 0 ? (
          <p className="field__hint">ابتدا از بخش اشخاص، شخصی اضافه کنید.</p>
        ) : (
          <ul className="checklist">
            {persons.map((person) => (
              <li key={person.id} className="checklist-item">
                <input
                  type="checkbox"
                  id={`group-person-${person.id}`}
                  checked={selected.has(person.id)}
                  onChange={() => toggle(person.id)}
                />
                <label htmlFor={`group-person-${person.id}`}>{person.name}</label>
              </li>
            ))}
          </ul>
        )}

        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={onClose}>
            انصراف
          </button>
          <button type="submit" className="form-actions__primary" disabled={!valid || submitting}>
            ذخیره
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
