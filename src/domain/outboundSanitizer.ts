/**
 * The ONE outbound sanitizer (docs/PLAN.md "Online architecture" and
 * "Encryption design"). Every op passes through `sanitizeOutboundOp` before
 * it is queued; the sync engine then encrypts the fields that may only
 * travel as `enc:v1:` ciphertext (`encryptOutboundOp`) and refuses to send
 * anything that still holds plaintext private data.
 *
 * Strategy (defence in depth):
 *  1. `persons` and `events` use an ALLOW-list of fields. Persons NEVER
 *     carry bank/phone fields — those travel as `memberProfile` ops
 *     (`buildProfileOp`). The treasurer's bank fields are allowed on
 *     `events` and are encrypted at push time.
 *  2. Everything else is scrubbed recursively: Blob/File values are dropped,
 *     any key that looks like bank/phone/photo data is dropped, and a
 *     `snapshot` string (a statement's canonical JSON) is parsed, scrubbed
 *     (creditor members' bank details removed; the treasurer's payment info
 *     kept — the whole snapshot is encrypted at push time) and re-serialised.
 *  3. Entities that are device-local (groups, messageTemplates) or unknown
 *     are never synced (`null`).
 */
import type { FieldChange, OperationType, ServerOp, ServerOpType } from "@/data/types";

/** Entities that are synced (event-scoped only). */
export const SYNCED_ENTITIES = [
  "events",
  "persons",
  "eventMembers",
  "vouchers",
  "statements",
  "orderSessions",
  "sessionMenuItems",
  "orderLines",
  "orderPersonTotals",
  "sessionExtras"
] as const;

export function isSyncedEntity(entity: string): boolean {
  return (SYNCED_ENTITIES as readonly string[]).includes(entity);
}

const PERSON_ALLOWED_FIELDS = new Set(["firstName", "lastName", "archived"]);

/** Sensitive member fields: stored locally on the person, synced only as encrypted `memberProfile` ops. */
export const PROFILE_FIELDS = ["cardNumber", "iban", "bankName", "accountHolder", "phone"] as const;
export const PROFILE_ENTITY_NAME = "memberProfile";

/** Fields of the `events` entity that only ever travel encrypted (the treasurer's payment info and the key check). */
export const EVENT_ENCRYPTED_FIELDS = ["treasurerCardNumber", "treasurerIban", "treasurerBankName", "treasurerAccountHolder", "keyCheck"] as const;

/** Top-level snapshot keys carrying the treasurer's payment info (kept in an outbound snapshot, which is encrypted as a whole). */
const SNAPSHOT_TREASURER_KEYS = new Set(["treasurerCardNumberGrouped", "treasurerIbanGrouped", "treasurerBankName", "treasurerAccountHolder"]);
/** Bank details of other members inside a settlement row — never leave the device. */
const SETTLEMENT_ROW_PRIVATE_KEYS = ["cardNumberGrouped", "ibanGrouped", "bankName", "accountHolder"];

const EVENT_ALLOWED_FIELDS = new Set([
  "title",
  "startDate",
  "endDate",
  "description",
  "currency",
  "treasurerPersonId",
  "archived",
  "closedAt",
  "reopenedAt",
  "reopenReason",
  "deletedAt",
  ...EVENT_ENCRYPTED_FIELDS
]);

/** Key names (case-insensitive substring match) that always mean private data. */
const FORBIDDEN_KEY_PATTERN = /card|iban|bankname|accountholder|phone|photo|avatar/i;

function isBinary(value: unknown): boolean {
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  if (typeof ArrayBuffer !== "undefined" && (value instanceof ArrayBuffer || ArrayBuffer.isView(value))) return true;
  return false;
}

/** Recursively drops binary values and forbidden keys; returns `undefined` for a binary value itself. */
export function scrubValue(value: unknown): unknown {
  if (isBinary(value)) return undefined;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_PATTERN.test(key)) continue;
      const scrubbed = scrubValue(inner);
      if (scrubbed !== undefined) out[key] = scrubbed;
    }
    return out;
  }
  return value;
}

/** Removes the creditors' bank details from a parsed snapshot's settlement rows (they are filled in at render time from local member profiles). */
function stripSettlementPrivateData(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(stripSettlementPrivateData);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const hub = record.hubSettlement as { paysFromTreasurer?: unknown } | null | undefined;
  if (hub && Array.isArray(hub.paysFromTreasurer)) {
    for (const row of hub.paysFromTreasurer) {
      if (row && typeof row === "object") for (const key of SETTLEMENT_ROW_PRIVATE_KEYS) delete (row as Record<string, unknown>)[key];
    }
  }
}

/** A statement `snapshot` is canonical JSON text embedding bank details; parse, scrub and re-serialise it. Only the treasurer's own payment info survives. */
function scrubSnapshotString(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    stripSettlementPrivateData(parsed);
    const kept: Record<string, unknown> = {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (SNAPSHOT_TREASURER_KEYS.has(key)) kept[key] = value;
      }
    }
    const scrubbed = scrubValue(parsed);
    return JSON.stringify(scrubbed && typeof scrubbed === "object" && !Array.isArray(scrubbed) ? { ...(scrubbed as Record<string, unknown>), ...kept } : scrubbed);
  } catch {
    // Not JSON — never ship something we cannot inspect.
    return "";
  }
}

function sanitizeChanges(entity: string, changes: Record<string, FieldChange>): Record<string, FieldChange> {
  const out: Record<string, FieldChange> = {};
  for (const [field, change] of Object.entries(changes ?? {})) {
    if (entity === "persons" && !PERSON_ALLOWED_FIELDS.has(field)) continue;
    if (entity === "events" && !EVENT_ALLOWED_FIELDS.has(field)) continue;
    const eventEncrypted = entity === "events" && (EVENT_ENCRYPTED_FIELDS as readonly string[]).includes(field);
    if (!eventEncrypted && FORBIDDEN_KEY_PATTERN.test(field)) continue;
    let before = eventEncrypted ? change?.before : scrubValue(change?.before);
    let after = eventEncrypted ? change?.after : scrubValue(change?.after);
    if (field === "snapshot") {
      // An already-encrypted snapshot (inbound, or waiting for the key) is opaque and passes untouched.
      if (typeof change?.before === "string") before = change.before.startsWith("enc:v1:") ? change.before : scrubSnapshotString(change.before);
      if (typeof change?.after === "string") after = change.after.startsWith("enc:v1:") ? change.after : scrubSnapshotString(change.after);
    }
    if (before === undefined && after === undefined) continue;
    out[field] = { before, after };
  }
  return out;
}

/** Maps a local operation type to one of the server's allowed types. */
export function toServerOpType(type: OperationType, entity: string, changes: Record<string, FieldChange>): ServerOpType {
  // A statement whose only change is its send log is the dedicated `logSend` op.
  if (entity === "statements" && (type === "update" || type === "outdate") && Object.keys(changes).length === 1 && "sendLog" in changes) return "logSend";
  switch (type) {
    case "create":
    case "update":
    case "delete":
    case "archive":
    case "restore":
    case "purge":
      return type;
    default:
      // close / reopen / outdate / trash / cancel / finalize are state updates.
      return "update";
  }
}

/** The encrypted-member-profile op for a `persons` op that touches sensitive fields (plaintext here; encrypted at push time). Null when none is touched. */
export function buildProfileOp(op: LocalOpLike): ServerOp | null {
  if (op.entity !== "persons") return null;
  if (op.type !== "create" && op.type !== "update") return null;
  const changes: Record<string, FieldChange> = {};
  for (const field of PROFILE_FIELDS) {
    const change = op.changes?.[field];
    if (!change) continue;
    const after = change.after;
    // On create, an absent value carries nothing; on update, clearing is a real change (encrypted "").
    if (op.type === "create" && (after === undefined || after === null || after === "")) continue;
    if (typeof after !== "string" && after !== undefined && after !== null) continue;
    changes[field] = { before: undefined, after: after ?? "" };
  }
  if (Object.keys(changes).length === 0) return null;
  return { id: `${op.id}.mp`, entity: PROFILE_ENTITY_NAME, entityId: op.entityId, type: "update", changes, timestamp: op.timestamp, deviceId: op.deviceId };
}

export interface LocalOpLike {
  id: string;
  entity: string;
  entityId: string;
  type: OperationType;
  changes: Record<string, FieldChange>;
  timestamp: string;
  deviceId: string;
}

/**
 * Returns the op that may leave the device, or `null` when the op must not
 * be synced at all (device-local entity, or nothing shareable left).
 */
export function sanitizeOutboundOp(op: LocalOpLike): ServerOp | null {
  if (!isSyncedEntity(op.entity)) return null;
  const type = toServerOpType(op.type, op.entity, op.changes);
  const changes = sanitizeChanges(op.entity, op.changes);
  // A pure-private edit (e.g. changing only a phone number) leaves nothing to send.
  // Lifecycle ops (create/delete/archive/restore/purge) mean something even without fields.
  if ((type === "update" || type === "logSend") && Object.keys(changes).length === 0) return null;
  if (type === "logSend") return { id: op.id, entity: op.entity, entityId: op.entityId, type, changes: logSendChanges(op), timestamp: op.timestamp, deviceId: op.deviceId };
  return { id: op.id, entity: op.entity, entityId: op.entityId, type, changes, timestamp: op.timestamp, deviceId: op.deviceId };
}

/** A `logSend` op carries `targetMemberId` and `channel` (docs/API.md audit), taken from the newest send-log entry. */
function logSendChanges(op: LocalOpLike): Record<string, FieldChange> {
  const after = op.changes.sendLog?.after;
  const before = op.changes.sendLog?.before;
  const last = Array.isArray(after) && after.length > 0 ? (after[after.length - 1] as Record<string, unknown>) : null;
  const channel = typeof last?.channel === "string" ? last.channel : "other";
  const target = typeof last?.target === "string" ? last.target : "";
  const out: Record<string, FieldChange> = {};
  if (target) out.targetMemberId = { before: undefined, after: target };
  out.channel = { before: undefined, after: channel };
  // The full log is kept for the receiving devices.
  out.sendLog = { before: scrubValue(before), after: scrubValue(after) };
  return out;
}
