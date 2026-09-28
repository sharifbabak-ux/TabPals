/**
 * Base fields that every persisted entity (people, events, vouchers, ...)
 * must extend. Keeping these on every record is what makes multi-user
 * sync (Stage 7), the audit trail (Stage 4), and the dormant online
 * layer (Stage 8) possible without a schema rewrite later.
 */
export interface BaseRecord {
  /** Globally unique, time-sortable ULID. Never reused, never reassigned. */
  id: string;
  /** ISO 8601 timestamp of when the record was first created. */
  createdAt: string;
  /** ISO 8601 timestamp of the most recent write to this record. */
  updatedAt: string;
  /** ULID of the device that produced this write; identifies "who" in the operation log. */
  deviceId: string;
  /** Monotonically increasing per-record revision, used to detect conflicting concurrent edits when merging sync packages. */
  version: number;
  /**
   * Soft-delete flag. Accounting records (vouchers, revisions, ...) are
   * never hard-deleted — see docs/PLAN.md #3 and CLAUDE.md. Deleting a
   * record means setting this to true and bumping version/updatedAt.
   */
  deleted: boolean;
}
