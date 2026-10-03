/**
 * Pure helpers for applying a remote operation to local data
 * (docs/PLAN.md "Online architecture"). A remote op carries field-level
 * `{before, after}` pairs; only the `after` values are ever applied.
 */
import type { FieldChange, ServerOp } from "@/data/types";

const BASE_FIELDS = new Set(["id", "createdAt", "updatedAt", "deviceId", "version"]);

/** ISO string for an op timestamp that may be epoch-ms or ISO. */
export function opTimestampIso(timestamp: string | number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

/** The `after` values of a change set, as a plain patch (base fields are never patched from the wire). */
export function afterValues(changes: Record<string, FieldChange>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [field, change] of Object.entries(changes ?? {})) {
    if (BASE_FIELDS.has(field)) continue;
    if (change && "after" in change) patch[field] = change.after;
  }
  return patch;
}

/** Defaults for the required fields a `create` op may legitimately omit (the sanitizer strips private ones). */
function entityDefaults(entity: string): Record<string, unknown> {
  switch (entity) {
    case "events":
      return { title: "", currency: "تومان", archived: false, treasurerPersonId: null, closedAt: null, reopenedAt: null, reopenReason: null, deletedAt: null };
    case "persons":
      return { firstName: "", lastName: "", archived: false, fromSync: true };
    case "eventMembers":
      return { defaultWeight: 1, active: true, sortOrder: 0 };
    case "vouchers":
      return { status: "active", payers: [], participants: [], shares: [] };
    case "statements":
      return { status: "current", sendLog: [], templateId: null, closingText: "" };
    case "orderLines":
      return { source: "online", sourceVersion: 1 };
    default:
      return {};
  }
}

/** Builds a brand-new local record from a `create` op. */
export function buildRecordFromCreate(op: ServerOp): Record<string, unknown> {
  const iso = opTimestampIso(op.timestamp);
  return {
    ...entityDefaults(op.entity),
    ...afterValues(op.changes),
    id: op.entityId,
    createdAt: iso,
    updatedAt: iso,
    deviceId: op.deviceId,
    version: 1,
    deleted: false,
    ...(op.changes?.deleted && "after" in op.changes.deleted ? { deleted: Boolean(op.changes.deleted.after) } : {})
  };
}

/** Applies an op's `after` values on top of an existing record (type-specific implied fields included). */
export function mergeRemoteChanges(existing: Record<string, unknown>, op: ServerOp): Record<string, unknown> {
  const patch = afterValues(op.changes);
  if (op.type === "delete" && !("deleted" in patch)) patch.deleted = true;
  if (op.type === "archive" && !("archived" in patch) && !("active" in patch) && !("deleted" in patch)) patch.archived = true;
  return {
    ...existing,
    ...patch,
    id: existing.id,
    updatedAt: opTimestampIso(op.timestamp),
    deviceId: op.deviceId,
    version: (typeof existing.version === "number" ? existing.version : 0) + 1
  };
}

/** Strips fields that must stay device-local when a remote `persons`/`events` record is merged into a local one. */
export function localOnlyFieldsPreserved<T extends Record<string, unknown>>(existing: T, merged: T, fields: string[]): T {
  const out = { ...merged } as Record<string, unknown>;
  for (const field of fields) {
    if (field in existing) out[field] = existing[field];
    else delete out[field];
  }
  return out as T;
}
