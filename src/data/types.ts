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
  firstName: string;
  /** Required for persons created after Stage 3B.1; may be empty on a migrated person until reviewed (see `needsNameReview`). */
  lastName: string;
  phone?: string;
  note?: string;
  archived: boolean;
  /** Square avatar image, max 256x256, WebP or JPEG ~0.75 quality (see src/platform image service). */
  photo?: Blob;
  /** Normalized 16-digit card number, optional (see docs/PLAN.md Stage 3B.1). */
  cardNumber?: string;
  /** Normalized "IR" + 24-digit IBAN, optional. */
  iban?: string;
  /** Free-text bank name; auto-suggested from card/IBAN but never overwritten once the user has typed one. */
  bankName?: string;
  /** Defaults to the person's full name in the UI, editable, stored only if the user confirms/edits it. */
  accountHolder?: string;
  /** True on a person created by the v6 name-split migration until confirmed on the "بررسی نام‌ها" screen. */
  needsNameReview?: boolean;
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
  /** Prefilled from the treasurer's saved bank details when first chosen; editable per event afterward. */
  treasurerBankName?: string;
  treasurerAccountHolder?: string;
  /** ISO timestamp of the last manual close, or null if not manually closed. */
  closedAt: string | null;
  /** ISO timestamp of the last manual reopen, or null if never reopened. */
  reopenedAt: string | null;
  /** Reason given for the last reopen, or null if never reopened. */
  reopenReason: string | null;
  /** ISO timestamp when this CLOSED event was moved to trash, or null. Only settable/clearable via the trash UI (see CLAUDE.md). */
  deletedAt: string | null;
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

/** One person's contribution toward a voucher's total amount. `weight` is the raw input (weight or percent) used to compute `amount` when `payerSplitMode` is "weight"/"percent"; omitted for "equal"/"exact". */
export interface VoucherPayer {
  personId: string;
  amount: number;
  weight?: number;
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
 * The expense-split mode actually used to compute a voucher's shares
 * (docs/PLAN.md Stage 3B). Only meaningful for `type: "expense"`.
 * Percent/exact inputs aren't stored separately: `participants[].weight`
 * already holds the percent (0-100) or exact amount used, so it stays
 * available for statement display as-is.
 */
export type SplitMode = "equal" | "weight" | "percent" | "exact" | "itemized";

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
  /** Expense only; undefined for contribution/settlement. */
  splitMode?: SplitMode;
  /** Only meaningful when `payers.length > 1`; how the payer amounts were derived from the total (docs/PLAN.md Stage 3B.1). Existing multi-payer vouchers were migrated to "exact". */
  payerSplitMode?: SplitMode;
  /** Only for `splitMode: "itemized"` (Group Order, docs/PLAN.md): per-person items and extra shares, written once at finalize. */
  itemizedSnapshot?: ItemizedSnapshot;
}

/** One line item of a person's order as frozen into an itemized voucher. */
export interface ItemizedItemSnapshot {
  name: string;
  quantity: number;
  /** Null when the person's amount came from their per-person total instead of item prices. */
  unitPrice: number | null;
  amount: number;
}

/** A shared item's share for one person (the item's name/quantity and this person's weighted part of its amount). */
export interface ItemizedSharedItemSnapshot {
  name: string;
  quantity: number;
  amount: number;
}

export interface ItemizedExtraShareSnapshot {
  extraId: string;
  kind: SessionExtraKind;
  label: string;
  share: number;
}

export interface ItemizedPersonSnapshot {
  personId: string;
  items: ItemizedItemSnapshot[];
  /** Set when the person's items subtotal came from their per-person total ("جمع سفارش این نفر"). */
  personTotal: number | null;
  sharedItems: ItemizedSharedItemSnapshot[];
  /** Own items + shared-item shares, before extras. */
  itemsSubtotal: number;
  extras: ItemizedExtraShareSnapshot[];
  finalTotal: number;
}

export interface ItemizedExtraSnapshot {
  extraId: string;
  kind: SessionExtraKind;
  label: string;
  mode: SessionExtraMode;
  value: number;
  allocation: ExtraAllocation;
  /** The extra's total amount (negative for discounts). */
  amount: number;
}

/** Everything about a group-order bill needed to re-render a member's itemized breakdown forever (docs/PLAN.md Group Order). */
export interface ItemizedSnapshot {
  sessionId: string;
  sessionTitle: string;
  restaurant?: string;
  billTotal: number;
  extras: ItemizedExtraSnapshot[];
  people: ItemizedPersonSnapshot[];
}

/** "member" statements are per-person; "comprehensive" covers the whole event (personId is null). */
export type StatementKind = "member" | "treasurer" | "comprehensive";
export type StatementStatus = "current" | "outdated";

/**
 * An issued statement/report (docs/PLAN.md Stage 3B). `snapshot` is the
 * complete canonical JSON of every value used to render the statement, so
 * it re-renders identically forever regardless of later edits to the
 * underlying data. Reopening an event marks all its "current" statements
 * "outdated" (never edited or deleted otherwise).
 */
export interface Statement extends BaseRecord {
  eventId: string;
  kind: StatementKind;
  /** null for comprehensive report statements. */
  personId: string | null;
  /** Sequential per event across all statements of any kind, never reused. */
  number: number;
  /** Issue count for this exact person+kind pair; starts at 1 and increments on re-issue. */
  issueVersion: number;
  issuedAt: string;
  /** Canonical JSON string of everything used to render this statement. */
  snapshot: string;
  /** Template chosen at issue time; null for the comprehensive report, which has no closing message. */
  templateId: string | null;
  /** The closing message, already rendered with placeholders filled in; stored so it never changes on re-render. */
  closingText: string;
  /** 8 uppercase hex chars in two groups, e.g. "A3F9-2C71". SHA-256 of `snapshot`. */
  verificationCode: string;
  status: StatementStatus;
  /** History of sends for this exact statement issue (docs/PLAN.md Stage 3C); a re-issue starts a fresh, empty log. */
  sendLog: SendLogEntry[];
}

/** How a statement was handed to a member (docs/PLAN.md Stage 3C). "print" logs a desktop "چاپ / ذخیره PDF" action. */
export type SendChannel = "share" | "whatsapp" | "telegram" | "sms" | "print";

/** One record of a statement being sent, appended to `Statement.sendLog`. */
export interface SendLogEntry {
  channel: SendChannel;
  at: string;
  /** Person id of the recipient, or "group" for a "همه در یک گفتگو" bulk share. */
  target: string;
}

export type MessageTemplateCategory = "debtor" | "creditor" | "settled" | "treasurer";

/**
 * A closing-message template for statements (docs/PLAN.md Stage 3B).
 * Seeded with defaults (`isDefault: true`) on first run/migration;
 * "بازگردانی متن‌های پیش‌فرض" in Settings restores exactly those.
 */
export interface MessageTemplate extends BaseRecord {
  category: MessageTemplateCategory;
  text: string;
  enabled: boolean;
  isDefault: boolean;
}

export type OperationEntity =
  | "persons"
  | "events"
  | "eventMembers"
  | "groups"
  | "vouchers"
  | "statements"
  | "messageTemplates"
  | "orderSessions"
  | "sessionMenuItems"
  | "orderLines"
  | "orderPersonTotals"
  | "sessionExtras";
export type OperationType = "create" | "update" | "archive" | "close" | "reopen" | "outdate" | "trash" | "restore" | "purge" | "delete" | "cancel" | "finalize";

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

// --- Group Order (docs/PLAN.md "Group Order", Stage GO-1) -----------------

export type OrderSessionStatus = "draft" | "open" | "locked" | "pricing" | "finalized" | "cancelled";

/** One meal's group order inside an event. Read-only once the event is closed (enforced in the repository). */
export interface OrderSession extends BaseRecord {
  eventId: string;
  title: string;
  restaurant?: string;
  /** ISO timestamp of the meal. */
  scheduledAt: string;
  status: OrderSessionStatus;
  cancelReason?: string;
  /** Compressed image of the printed menu. */
  menuPhoto?: Blob;
  /** The event's treasurer at creation; only they finalize. */
  adminPersonId: string;
  /** Can manage the session in the admin's absence (GO-3); finalize still happens on the treasurer's device. */
  deputyPersonId: string | null;
  /** The restaurant's bill total, entered during pricing. */
  billTotal: number | null;
  /** Editable ISO date ("YYYY-MM-DD") copied onto the voucher. */
  expenseDate: string;
  payers: VoucherPayer[];
  payerSplitMode?: SplitMode;
  /** Set when finalized. */
  voucherId: string | null;
}

/** A "منوی سریع" chip. */
export interface SessionMenuItem extends BaseRecord {
  sessionId: string;
  name: string;
  price?: number;
  sortOrder: number;
}

export type OrderLineSource = "admin-device" | "package" | "online";

export interface SharedParticipant {
  personId: string;
  weight: number;
}

export interface OrderLine extends BaseRecord {
  sessionId: string;
  /** Null for shared lines. */
  personId: string | null;
  /** Shared lines only. */
  sharedParticipants?: SharedParticipant[];
  menuItemId?: string;
  itemName: string;
  /** Integer ≥ 1. */
  quantity: number;
  unitPrice?: number;
  note?: string;
  source: OrderLineSource;
  /** Bumped by package/online submissions so a newer version replaces an older one from the same person (GO-2/GO-3). */
  sourceVersion: number;
}

/** Optional per-person total used when that person's lines have no item prices. */
export interface OrderPersonTotal extends BaseRecord {
  sessionId: string;
  personId: string;
  total: number;
}

export type SessionExtraKind = "vat" | "service" | "tip" | "discount" | "other";
export type SessionExtraMode = "percent" | "amount";
export type ExtraAllocation = "proportional" | "equal" | "weight";

export interface SessionExtra extends BaseRecord {
  sessionId: string;
  kind: SessionExtraKind;
  label: string;
  mode: SessionExtraMode;
  value: number;
  allocation: ExtraAllocation;
  /** Used when allocation = "weight". */
  weights?: { personId: string; weight: number }[];
}
