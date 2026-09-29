import { useEffect, useState, type FormEvent } from "react";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { personFullName } from "@/domain/displayName";
import { validateGroupName } from "@/domain/groupValidation";
import type { Group, Person } from "@/data/types";
import type { GroupInput } from "@/data/repositories/groupsRepository";

interface GroupFormSheetProps {
  open: boolean;
  group?: Group;
  /** Active persons available to add to the group. */
  persons: Person[];
  /** Names of other active groups, used for the duplicate-name block. */
  existingNames: string[];
  onClose: () => void;
  onSubmit: (input: GroupInput) => Promise<void>;
  /** Present only when editing — opens the archive/restore confirmation. */
  onArchiveRequest?: () => void;
  /** Present only when editing an archived group — opens the permanent-delete confirmation. */
  onPermanentDeleteRequest?: () => void;
}

export function GroupFormSheet({
  open,
  group,
  persons,
  existingNames,
  onClose,
  onSubmit,
  onArchiveRequest,
  onPermanentDeleteRequest
}: GroupFormSheetProps) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(group?.name ?? "");
      setSelected(new Set(group?.personIds ?? []));
      setSubmitError(null);
    }
  }, [open, group]);

  const nameValidation = validateGroupName(name, existingNames);
  const valid = nameValidation.valid && selected.size > 0;

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
    setSubmitError(null);
    try {
      await onSubmit({ name: name.trim(), personIds: Array.from(selected) });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "خطایی رخ داد");
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
          {nameValidation.error && <span className="field__error">{nameValidation.error}</span>}
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
                <label htmlFor={`group-person-${person.id}`}>{personFullName(person)}</label>
              </li>
            ))}
          </ul>
        )}

        {submitError && <p className="field__error">{submitError}</p>}
        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={onClose}>
            انصراف
          </button>
          <button type="submit" className="form-actions__primary" disabled={!valid || submitting}>
            ذخیره
          </button>
        </div>

        {group && onArchiveRequest && (
          <div className="sheet__danger-zone">
            <button type="button" className="sheet__archive-button" onClick={onArchiveRequest}>
              {group.archived ? "بازگردانی از آرشیو" : "آرشیو کردن این گروه"}
            </button>
            {group.archived && onPermanentDeleteRequest && (
              <button type="button" className="sheet__archive-button sheet__archive-button--danger" onClick={onPermanentDeleteRequest}>
                حذف دائمی
              </button>
            )}
          </div>
        )}
      </form>
    </BottomSheet>
  );
}
