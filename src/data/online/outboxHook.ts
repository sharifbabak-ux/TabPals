/**
 * Bridge between the repository layer's operation log and online sync.
 * `logOperation` calls `afterLogOperation` inside the writing transaction:
 *  1. route the op to the online event(s) it belongs to,
 *  2. enforce the local permission guard (members are read-only),
 *  3. sanitize the op and append it to the outbox.
 * Throwing here aborts the whole transaction, so a refused write leaves
 * nothing behind.
 */
import { ulid } from "ulid";
import { checkOp } from "@/domain/onlinePermissions";
import { buildProfileOp, isSyncedEntity, sanitizeOutboundOp, toServerOpType, type LocalOpLike } from "@/domain/outboundSanitizer";
import type { TabPalDB } from "../db";
import type { FieldChange, OnlineLink, Operation, ServerOp } from "../types";
import { signalOutboxChanged } from "./syncSignal";

export class OnlinePermissionError extends Error {
  constructor(public readonly reason: string) {
    super("در ایونت آنلاین، نقش شما اجازه‌ی این تغییر را نمی‌دهد (فقط مسئول صندوق یا مدیر می‌تواند ثبت و ویرایش کند).");
    this.name = "OnlinePermissionError";
  }
}

const BASE_FIELDS = new Set(["id", "createdAt", "updatedAt", "deviceId", "version"]);

/** All current field values of a freshly created row as `{before: undefined, after}` — used so a create op always carries the complete record. */
function fullRecordChanges(row: Record<string, unknown>): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const [field, value] of Object.entries(row)) {
    if (BASE_FIELDS.has(field) || value === undefined) continue;
    changes[field] = { before: undefined, after: value };
  }
  return changes;
}

type RowTable = { get(key: string): Promise<Record<string, unknown> | undefined> };

function rowTable(db: TabPalDB, entity: string): RowTable | null {
  switch (entity) {
    case "events":
    case "persons":
    case "eventMembers":
    case "vouchers":
    case "statements":
    case "orderSessions":
    case "sessionMenuItems":
    case "orderLines":
    case "orderPersonTotals":
    case "sessionExtras":
      return db.table(entity) as unknown as RowTable;
    default:
      return null;
  }
}

/** Server event ids a local op belongs to (a person belongs to every event they are a member of). */
export async function eventIdsForOp(db: TabPalDB, entity: string, entityId: string, changes: Record<string, FieldChange>): Promise<string[]> {
  const fromChange = (field: string): string | undefined => {
    const after = changes[field]?.after;
    return typeof after === "string" ? after : undefined;
  };
  switch (entity) {
    case "events":
      return [entityId];
    case "eventMembers":
    case "vouchers":
    case "statements":
    case "orderSessions": {
      const row = await rowTable(db, entity)!.get(entityId);
      const eventId = (row?.eventId as string | undefined) ?? fromChange("eventId");
      return eventId ? [eventId] : [];
    }
    case "sessionMenuItems":
    case "orderLines":
    case "orderPersonTotals":
    case "sessionExtras": {
      const row = await rowTable(db, entity)!.get(entityId);
      const sessionId = (row?.sessionId as string | undefined) ?? fromChange("sessionId");
      if (!sessionId) return [];
      const session = (await db.orderSessions.get(sessionId)) as { eventId?: string } | undefined;
      return session?.eventId ? [session.eventId] : [];
    }
    case "persons": {
      const memberships = await db.eventMembers.where("personId").equals(entityId).toArray();
      return [...new Set(memberships.map((m) => m.eventId))];
    }
    default:
      return [];
  }
}

async function enqueue(db: TabPalDB, link: OnlineLink, op: ServerOp): Promise<void> {
  await db.outbox.add({
    opId: op.id,
    localEventId: link.localEventId,
    op,
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    rejected: null
  });
}

/** Creates are completed from the stored row so the op always carries the full record. */
async function completeOp(db: TabPalDB, op: LocalOpLike): Promise<LocalOpLike> {
  if (op.type !== "create") return op;
  const row = await rowTable(db, op.entity)?.get(op.entityId);
  return row ? { ...op, changes: { ...fullRecordChanges(row), ...op.changes } } : op;
}

/** Builds the sanitized op for one local op; creates are completed from the stored row first. */
export async function buildOutboundOp(db: TabPalDB, op: LocalOpLike): Promise<ServerOp | null> {
  return sanitizeOutboundOp(await completeOp(db, op));
}

/** Synthetic `persons` create op (shareable fields) plus the person's `memberProfile` op (plaintext here, encrypted at push time) — used when someone joins an online event. */
export async function buildPersonCreateOps(db: TabPalDB, personId: string, timestamp: string, deviceId: string): Promise<{ person: ServerOp | null; profile: ServerOp | null }> {
  const row = (await db.persons.get(personId)) as Record<string, unknown> | undefined;
  if (!row) return { person: null, profile: null };
  const local: LocalOpLike = { id: ulid(), entity: "persons", entityId: personId, type: "create", changes: fullRecordChanges(row), timestamp, deviceId };
  return { person: sanitizeOutboundOp(local), profile: buildProfileOp(local) };
}

export async function afterLogOperation(db: TabPalDB, op: Operation): Promise<void> {
  if (!isSyncedEntity(op.entity)) return;
  if ((await db.onlineLinks.count()) === 0) return;

  const eventIds = await eventIdsForOp(db, op.entity, op.entityId, op.changes);
  if (eventIds.length === 0) return;
  const links = ((await db.onlineLinks.bulkGet(eventIds)).filter(Boolean) as OnlineLink[]).filter((link) => link.status !== "revoked");
  if (links.length === 0) return;

  const serverType = toServerOpType(op.type, op.entity, op.changes);
  const source = await completeOp(db, op);
  const outbound = sanitizeOutboundOp(source);
  const profile = buildProfileOp(source);
  // A person edit that only touches sensitive fields is a `memberProfile` write (own profile for any member), not a ledger write.
  const ledgerRelevant = !(op.entity === "persons" && outbound === null && profile !== null);
  for (const link of links) {
    const actor = { memberId: link.memberId, roles: link.roles };
    if (ledgerRelevant) {
      const check = checkOp(actor, { entity: op.entity, entityId: op.entityId, type: serverType });
      if (!check.ok) throw new OnlinePermissionError(check.reason);
    }
    if (profile) {
      const check = checkOp(actor, { entity: profile.entity, entityId: profile.entityId, type: profile.type });
      if (!check.ok) throw new OnlinePermissionError(check.reason);
    }
  }

  for (const link of links) {
    if (op.entity === "eventMembers" && op.type === "create") {
      const personId = op.changes.personId?.after;
      const row = (await db.eventMembers.get(op.entityId)) as { personId?: string } | undefined;
      const id = (typeof personId === "string" ? personId : row?.personId) ?? null;
      if (id) {
        const ops = await buildPersonCreateOps(db, id, op.timestamp, op.deviceId);
        if (ops.person) await enqueue(db, link, ops.person);
        if (ops.profile) await enqueue(db, link, ops.profile);
      }
    }
    if (outbound) await enqueue(db, link, outbound);
    if (profile) await enqueue(db, link, profile);
    signalOutboxChanged(link.localEventId);
  }
}
