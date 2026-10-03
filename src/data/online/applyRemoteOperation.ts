/**
 * Inbound side of sync: applies ONE remote operation to local data.
 *
 * - Idempotent: an op already applied (or still waiting in our own outbox)
 *   is skipped, so socket echoes and repeated catch-ups are harmless.
 * - Writes tables directly, never through a repository, so applying a
 *   remote op neither re-queues it in the outbox nor trips the local
 *   permission guard.
 * - Only the `after` values are applied, and they are passed through the
 *   same sanitizer as outbound ops (private fields are never accepted).
 */
import { mergeRemoteChanges, buildRecordFromCreate } from "@/domain/remoteOps";
import { isSyncedEntity, sanitizeOutboundOp } from "@/domain/outboundSanitizer";
import { db as defaultDb, type TabPalDB } from "../db";
import type { OperationType, ServerOp } from "../types";
import type { RemoteOpEnvelope } from "./apiClient";

export type ApplyResult = "applied" | "duplicate" | "ignored" | "purged";

type AnyRow = Record<string, unknown> & { id: string };
type AnyTable = {
  get(key: string): Promise<AnyRow | undefined>;
  put(row: AnyRow): Promise<unknown>;
  delete(key: string): Promise<void>;
  where(index: string): { equals(value: unknown): { first(): Promise<AnyRow | undefined>; toArray(): Promise<AnyRow[]> } };
};

function tableOf(db: TabPalDB, entity: string): AnyTable {
  return db.table(entity) as unknown as AnyTable;
}

/** Next free `number` for vouchers/statements of an event (two treasurers could have picked the same one concurrently). */
async function nextFreeNumber(table: AnyTable, eventId: string): Promise<number> {
  const rows = await table.where("eventId").equals(eventId).toArray();
  return rows.reduce((max, row) => Math.max(max, (row.number as number) ?? 0), 0) + 1;
}

async function applyOp(db: TabPalDB, op: ServerOp): Promise<void> {
  const table = tableOf(db, op.entity);
  const existing = await table.get(op.entityId);

  if (op.type === "purge") {
    if (existing) await table.delete(op.entityId);
    return;
  }

  if (!existing) {
    // Only a create (or an op that carries a full record) can bring a row into existence; a stray update for an unknown row is dropped.
    if (op.type !== "create") return;
    const record = buildRecordFromCreate(op) as AnyRow;
    if (op.entity === "eventMembers") {
      const sameMembership = await table.where("[eventId+personId]").equals([record.eventId, record.personId]).first();
      if (sameMembership) {
        await table.put({ ...mergeRemoteChanges(sameMembership, op), id: sameMembership.id } as AnyRow);
        return;
      }
    }
    if ((op.entity === "vouchers" || op.entity === "statements") && typeof record.eventId === "string") {
      const clash = await table.where("[eventId+number]").equals([record.eventId, record.number]).first();
      if (clash) record.number = await nextFreeNumber(table, record.eventId);
    }
    await table.put(record);
    return;
  }

  const merged = mergeRemoteChanges(existing, op) as AnyRow;
  // A renumbering change must not collide either.
  if ((op.entity === "vouchers" || op.entity === "statements") && merged.number !== existing.number) {
    const clash = await table.where("[eventId+number]").equals([merged.eventId, merged.number]).first();
    if (clash && clash.id !== existing.id) merged.number = existing.number;
  }
  await table.put(merged);
}

/**
 * Applies one envelope from `GET ops` / the socket `ops` event for the
 * online event `localEventId`. `purged` is returned for a remote purge of
 * the event itself — the caller must then wipe the local copy.
 */
export async function applyRemoteOperation(localEventId: string, envelope: RemoteOpEnvelope, db: TabPalDB = defaultDb): Promise<ApplyResult> {
  const { op: rawOp, seq } = envelope;

  return db.transaction(
    "rw",
    [
      db.events,
      db.persons,
      db.eventMembers,
      db.vouchers,
      db.statements,
      db.orderSessions,
      db.sessionMenuItems,
      db.orderLines,
      db.orderPersonTotals,
      db.sessionExtras,
      db.outbox,
      db.appliedRemoteOps,
      db.onlineLinks
    ],
    async (): Promise<ApplyResult> => {
      const advance = async () => {
        const link = await db.onlineLinks.get(localEventId);
        if (link && seq > link.lastSeq) await db.onlineLinks.update(localEventId, { lastSeq: seq });
      };

      if (await db.appliedRemoteOps.get([localEventId, rawOp.id])) {
        await advance();
        return "duplicate";
      }
      // Our own op that the server has not acknowledged yet: already applied locally.
      if (await db.outbox.where("[localEventId+opId]").equals([localEventId, rawOp.id]).first()) {
        await advance();
        return "duplicate";
      }

      let result: ApplyResult = "applied";
      if (!isSyncedEntity(rawOp.entity)) {
        result = "ignored";
      } else if (rawOp.type === "purge" && rawOp.entity === "events") {
        result = "purged";
      } else {
        // Same filter as outbound: private fields are never accepted from the wire.
        const safe = rawOp.type === "purge" ? rawOp : sanitizeOutboundOp({ ...rawOp, type: rawOp.type as OperationType, timestamp: String(rawOp.timestamp) });
        if (!safe) {
          result = "ignored";
        } else {
          await applyOp(db, { ...safe, timestamp: rawOp.timestamp });
        }
      }

      await db.appliedRemoteOps.put({ localEventId, opId: rawOp.id, seq, appliedAt: new Date().toISOString() });
      await advance();
      return result;
    }
  );
}
