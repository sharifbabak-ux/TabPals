/**
 * Pure permanent-deletion/trash guards (docs/PLAN.md Stage 3B.1). The
 * repository layer is the actual enforcement point (see CLAUDE.md — every
 * deletion writes a tombstone operation), but the rules themselves live
 * here so the UI can show the same reasoning before offering the action.
 */

export interface DeletionCheck {
  allowed: boolean;
  reason: string | null;
}

export interface PersonForDeletion {
  archived: boolean;
}

export interface PersonReferences {
  /** True if the person is a member of, or a voucher party in, ANY event — including events currently in trash. */
  referencedByAnyEvent: boolean;
}

/** Permanent person delete: only an archived person with no references anywhere, ever. */
export function canDeletePerson(person: PersonForDeletion, references: PersonReferences): DeletionCheck {
  if (!person.archived) {
    return { allowed: false, reason: "این شخص آرشیو نشده است." };
  }
  if (references.referencedByAnyEvent) {
    return { allowed: false, reason: "این شخص در یک یا چند ایونت (به‌عنوان عضو یا در سند) استفاده شده و قابل حذف دائمی نیست." };
  }
  return { allowed: true, reason: null };
}

export interface GroupForDeletion {
  archived: boolean;
}

/** Permanent group delete: only an archived group. */
export function canDeleteGroup(group: GroupForDeletion): DeletionCheck {
  if (!group.archived) {
    return { allowed: false, reason: "این گروه آرشیو نشده است." };
  }
  return { allowed: true, reason: null };
}

export interface EventForTrash {
  closedAt: string | null;
  deletedAt?: string | null;
}

/** Moving an event to trash ("حذف ایونت"): only a CLOSED event that isn't already in trash. */
export function canTrashEvent(event: EventForTrash): DeletionCheck {
  if (event.deletedAt) {
    return { allowed: false, reason: "این ایونت از قبل در سطل بازیافت است." };
  }
  if (!event.closedAt) {
    return { allowed: false, reason: "فقط ایونت پایان‌یافته قابل انتقال به سطل بازیافت است." };
  }
  return { allowed: true, reason: null };
}

/** Permanent event delete: only an event already in trash. */
export function canDeleteEvent(event: EventForTrash): DeletionCheck {
  if (!event.deletedAt) {
    return { allowed: false, reason: "این ایونت در سطل بازیافت نیست." };
  }
  return { allowed: true, reason: null };
}
