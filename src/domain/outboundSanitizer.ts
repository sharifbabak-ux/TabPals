/**
 * The ONE outbound sanitizer (docs/PLAN.md "Online architecture", Stage
 * ONLINE-1B). Until end-to-end encryption arrives (ONLINE-1C) nothing
 * private may leave the device: bank details, phones, photos and any Blob.
 * Every op passes through `sanitizeOutboundOp` before it is queued.
 *
 * Strategy (defence in depth):
 *  1. `persons` and `events` use an ALLOW-list of fields.
 *  2. Everything else is scrubbed recursively: Blob/File values are dropped,
 *     any key that looks like bank/phone/photo data is dropped, and a
 *     `snapshot` string (a statement's canonical JSON) is parsed, scrubbed
 *     and re-serialised.
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
  "deletedAt"
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

/** A statement `snapshot` is canonical JSON text embedding bank details; parse, scrub and re-serialise it. */
function scrubSnapshotString(text: string): string {
  try {
    return JSON.stringify(scrubValue(JSON.parse(text)));
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
    if (FORBIDDEN_KEY_PATTERN.test(field)) continue;
    let before = scrubValue(change?.before);
    let after = scrubValue(change?.after);
    if (field === "snapshot") {
      if (typeof change?.before === "string") before = scrubSnapshotString(change.before);
      if (typeof change?.after === "string") after = scrubSnapshotString(change.after);
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
  return { id: op.id, entity: op.entity, entityId: op.entityId, type, changes, timestamp: op.timestamp, deviceId: op.deviceId };
}
