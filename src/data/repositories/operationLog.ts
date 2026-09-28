import { ulid } from "ulid";
import { getDeviceId } from "../deviceId";
import type { TabPalDB } from "../db";
import type { BaseRecord, FieldChange, Operation, OperationEntity, OperationType } from "../types";

/**
 * Field-level diff between two versions of a record, used to build an
 * operation's `changes`. Only fields whose value actually changed are
 * included.
 */
export function diffFields<T>(before: T | undefined, after: T, fields: (keyof T)[]): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const field of fields) {
    const beforeValue = before ? before[field] : undefined;
    const afterValue = after[field];
    if (beforeValue !== afterValue) {
      changes[field as string] = { before: beforeValue, after: afterValue };
    }
  }
  return changes;
}

/** Appends one entry to the operation log. Always called inside the same transaction as the entity write. */
export async function logOperation(
  db: TabPalDB,
  entity: OperationEntity,
  entityId: string,
  type: OperationType,
  changes: Record<string, FieldChange>
): Promise<void> {
  const operation: Operation = {
    id: ulid(),
    entity,
    entityId,
    type,
    changes,
    timestamp: new Date().toISOString(),
    deviceId: getDeviceId()
  };
  await db.operations.add(operation);
}

/** Fresh base fields for a brand-new record. */
export function newBaseFields(): BaseRecord {
  const now = new Date().toISOString();
  return {
    id: ulid(),
    createdAt: now,
    updatedAt: now,
    deviceId: getDeviceId(),
    version: 1,
    deleted: false
  };
}

/** Bumped base fields for an updated record. */
export function touchBaseFields<T extends BaseRecord>(existing: T): Pick<BaseRecord, "updatedAt" | "deviceId" | "version"> {
  return {
    updatedAt: new Date().toISOString(),
    deviceId: getDeviceId(),
    version: existing.version + 1
  };
}
