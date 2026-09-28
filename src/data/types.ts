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

/**
 * Global people directory entry (Stage 1 — see docs/PLAN.md #1). Persons
 * are archived, never deleted, so past events keep referring to a
 * meaningful name.
 */
export interface Person extends BaseRecord {
  name: string;
  phone?: string;
  note?: string;
  archived: boolean;
}

/** A gathering/trip whose expenses are tracked together. */
export interface Event extends BaseRecord {
  title: string;
  /** ISO date string (no time component required). */
  startDate?: string;
  /** ISO date string (no time component required). */
  endDate?: string;
  description?: string;
  archived: boolean;
}

/**
 * A person's membership in one event. A person can be in a given event
 * only once (enforced by the repository via the `[eventId+personId]`
 * index). `defaultWeight` seeds expense-share calculations in Stage 2.
 */
export interface EventMember extends BaseRecord {
  eventId: string;
  personId: string;
  defaultWeight: number;
  active: boolean;
}

/** A saved, reusable set of persons (e.g. "family") for one-tap add to an event. */
export interface Group extends BaseRecord {
  name: string;
  personIds: string[];
  archived: boolean;
}

export type OperationEntity = "persons" | "events" | "eventMembers" | "groups";
export type OperationType = "create" | "update" | "archive";

/** Field-level before/after values recorded for one changed field. */
export interface FieldChange {
  before: unknown;
  after: unknown;
}

/**
 * Append-only audit/sync log entry. Every create/update/archive on the
 * tables above writes exactly one of these from inside the repository
 * layer — UI code never writes operations directly. Powers multi-device
 * sync in Stage 7.
 */
export interface Operation {
  id: string;
  entity: OperationEntity;
  entityId: string;
  type: OperationType;
  changes: Record<string, FieldChange>;
  timestamp: string;
  deviceId: string;
}
