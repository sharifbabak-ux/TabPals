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
  /** Square avatar image, max 256x256, WebP or JPEG ~0.75 quality (see src/platform image service). */
  photo?: Blob;
}

/** The two currencies TabPals events can be tracked in. */
export type EventCurrency = "تومان" | "ریال";

/** A gathering/trip whose expenses are tracked together. */
export interface Event extends BaseRecord {
  title: string;
  /** ISO date string (no time component required). */
  startDate?: string;
  /** ISO date string (no time component required). */
  endDate?: string;
  description?: string;
  archived: boolean;
  currency: EventCurrency;
  /** Person id of the treasurer holding contributed funds. Required for new events; null on events created before Stage 3A until set. */
  treasurerPersonId: string | null;
  /** Normalized 16-digit card number, optional. */
  treasurerCardNumber?: string;
  /** Normalized "IR" + 24-digit IBAN, optional. */
  treasurerIban?: string;
  /** ISO timestamp of the last manual close, or null if not manually closed. */
  closedAt: string | null;
  /** ISO timestamp of the last manual reopen, or null if never reopened. */
  reopenedAt: string | null;
  /** Reason given for the last reopen, or null if never reopened. */
  reopenReason: string | null;
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
  /** Position in the manually-ordered members list (drag-and-drop, Stage 3A). Lower sorts first. */
  sortOrder: number;
}

/** A saved, reusable set of persons (e.g. "family") for one-tap add to an event. */
export interface Group extends BaseRecord {
  name: string;
  personIds: string[];
  archived: boolean;
}

/** One person's contribution toward a voucher's total amount. */
export interface VoucherPayer {
  personId: string;
  amount: number;
}

/** One participant sharing in an expense, weighted for the split engine. */
export interface VoucherParticipant {
  personId: string;
  weight: number;
}

/** A participant's computed share of an expense, stored at save time. */
export interface VoucherShare {
  personId: string;
  share: number;
}

export type VoucherType = "expense" | "contribution" | "settlement";
export type VoucherStatus = "active";

/**
 * An accounting voucher (docs/PLAN.md #2 and #4). Expenses carry payers,
 * participants, and computed shares; contributions and settlements are
 * simple transfers between two people and leave payers/participants
 * empty. `number` is sequential per event and never reused (see
 * CLAUDE.md — never hard-delete accounting records).
 */
export interface Voucher extends BaseRecord {
  eventId: string;
  number: number;
  type: VoucherType;
  /** ISO timestamp set once at creation; never edited afterward. */
  recordedAt: string;
  /** Editable ISO date ("YYYY-MM-DD"), defaults to today at creation. */
  expenseDate: string;
  description: string;
  totalAmount: number;
  /** Expense only; empty for contribution/settlement. Sum must equal totalAmount. */
  payers: VoucherPayer[];
  /** Expense only; empty for contribution/settlement. */
  participants: VoucherParticipant[];
  /** Contribution/settlement only. */
  fromPersonId?: string;
  /** Contribution/settlement only. */
  toPersonId?: string;
  /** Expense only; empty for contribution/settlement. Always sums to totalAmount. */
  shares: VoucherShare[];
  status: VoucherStatus;
}

export type OperationEntity = "persons" | "events" | "eventMembers" | "groups" | "vouchers";
export type OperationType = "create" | "update" | "archive" | "close" | "reopen";

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
