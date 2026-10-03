import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import type { OnlineLink, ServerOp } from "../types";
import type { RemoteOpEnvelope } from "./apiClient";
import { applyRemoteOperation } from "./applyRemoteOperation";

const EV = "EV1";

beforeEach(async () => {
  for (const table of db.tables) if (table.name !== "messageTemplates") await table.clear();
  const link: OnlineLink = { localEventId: EV, serverEventId: EV, memberId: "m1", roles: ["member"], deviceToken: "t", lastSeq: 0, status: "online", createdAt: "2026-01-01T00:00:00.000Z" };
  await db.onlineLinks.put(link);
});

let seq = 0;
function env(op: Partial<ServerOp> & Pick<ServerOp, "entity" | "entityId" | "type">, s = ++seq): RemoteOpEnvelope {
  return {
    seq: s,
    serverTs: "2026-01-01T00:00:00.000Z",
    memberId: "t1",
    deviceId: "other-device",
    op: { id: `op-${s}`, changes: {}, timestamp: 1_760_000_000_000, deviceId: "other-device", ...op }
  };
}
const after = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { before: undefined, after: v }]));

describe("applyRemoteOperation", () => {
  it("creates, updates, soft-deletes and restores using the after values", async () => {
    await applyRemoteOperation(EV, env({ entity: "events", entityId: EV, type: "create", changes: after({ title: "سفر", currency: "تومان" }) }));
    await applyRemoteOperation(EV, env({ entity: "vouchers", entityId: "V1", type: "create", changes: after({ eventId: EV, number: 1, type: "expense", totalAmount: 100, description: "شام", recordedAt: "2026-01-01T10:00:00.000Z", payers: [], participants: [], shares: [] }) }));
    let v = (await db.vouchers.get("V1"))!;
    expect(v).toMatchObject({ id: "V1", eventId: EV, number: 1, totalAmount: 100, deleted: false, version: 1, deviceId: "other-device" });
    expect(v.createdAt).toBe(new Date(1_760_000_000_000).toISOString());

    await applyRemoteOperation(EV, env({ entity: "vouchers", entityId: "V1", type: "update", changes: { totalAmount: { before: 100, after: 150 } } }));
    v = (await db.vouchers.get("V1"))!;
    expect(v.totalAmount).toBe(150);
    expect(v.version).toBe(2);

    await applyRemoteOperation(EV, env({ entity: "vouchers", entityId: "V1", type: "delete", changes: {} }));
    expect((await db.vouchers.get("V1"))!.deleted).toBe(true);
    await applyRemoteOperation(EV, env({ entity: "vouchers", entityId: "V1", type: "restore", changes: { deleted: { before: true, after: false } } }));
    expect((await db.vouchers.get("V1"))!.deleted).toBe(false);

    await applyRemoteOperation(EV, env({ entity: "orderLines", entityId: "L1", type: "create", changes: after({ sessionId: "S1", itemName: "کباب", quantity: 2, category: "main", personId: "p1" }) }));
    await applyRemoteOperation(EV, env({ entity: "orderLines", entityId: "L1", type: "archive", changes: { deleted: { before: false, after: true } } }));
    expect((await db.orderLines.get("L1"))!.deleted).toBe(true);
    await applyRemoteOperation(EV, env({ entity: "orderLines", entityId: "L1", type: "purge", changes: {} }));
    expect(await db.orderLines.get("L1")).toBeUndefined();

    await applyRemoteOperation(EV, env({ entity: "statements", entityId: "ST1", type: "create", changes: after({ eventId: EV, kind: "member", number: 1, snapshot: "{}" }) }));
    await applyRemoteOperation(EV, env({ entity: "statements", entityId: "ST1", type: "logSend", changes: { sendLog: { before: [], after: [{ channel: "share", at: "x", target: "p1" }] } } }));
    expect((await db.statements.get("ST1"))!.sendLog).toHaveLength(1);
  });

  it("is idempotent: applying the same op twice changes nothing", async () => {
    const e = env({ entity: "vouchers", entityId: "V1", type: "create", changes: after({ eventId: EV, number: 1, totalAmount: 100 }) });
    expect(await applyRemoteOperation(EV, e)).toBe("applied");
    const update = env({ entity: "vouchers", entityId: "V1", type: "update", changes: { totalAmount: { before: 100, after: 200 } } });
    expect(await applyRemoteOperation(EV, update)).toBe("applied");
    const snapshot = JSON.stringify(await db.vouchers.get("V1"));

    // replaying (socket echo, repeated catch-up, out-of-order redelivery of the create) must not revert or bump anything
    expect(await applyRemoteOperation(EV, e)).toBe("duplicate");
    expect(await applyRemoteOperation(EV, update)).toBe("duplicate");
    expect(JSON.stringify(await db.vouchers.get("V1"))).toBe(snapshot);
    expect(await db.vouchers.count()).toBe(1);
    expect(await db.appliedRemoteOps.count()).toBe(2);
  });

  it("never writes to the outbox or the local operation log", async () => {
    await applyRemoteOperation(EV, env({ entity: "events", entityId: EV, type: "create", changes: after({ title: "x" }) }));
    await applyRemoteOperation(EV, env({ entity: "vouchers", entityId: "V1", type: "create", changes: after({ eventId: EV, number: 1 }) }));
    await applyRemoteOperation(EV, env({ entity: "vouchers", entityId: "V1", type: "update", changes: { number: { before: 1, after: 1 } } }));
    expect(await db.outbox.count()).toBe(0);
    expect(await db.operations.count()).toBe(0);
  });

  it("tracks lastSeq, and skips ops still pending in our own outbox", async () => {
    await applyRemoteOperation(EV, env({ entity: "vouchers", entityId: "V1", type: "create", changes: after({ eventId: EV, number: 1 }) }, 7));
    expect((await db.onlineLinks.get(EV))!.lastSeq).toBe(7);
    await applyRemoteOperation(EV, env({ entity: "vouchers", entityId: "V1", type: "update", changes: { number: { before: 1, after: 2 } } }, 5));
    expect((await db.onlineLinks.get(EV))!.lastSeq).toBe(7);

    const own = env({ entity: "vouchers", entityId: "V9", type: "create", changes: after({ eventId: EV, number: 9 }) }, 8);
    await db.outbox.add({ opId: own.op.id, localEventId: EV, op: own.op, attempts: 0, lastError: null, createdAt: "x" });
    expect(await applyRemoteOperation(EV, own)).toBe("duplicate");
    expect(await db.vouchers.get("V9")).toBeUndefined();
    expect((await db.onlineLinks.get(EV))!.lastSeq).toBe(8);
  });

  it("never accepts private fields from the wire", async () => {
    await applyRemoteOperation(EV, env({ entity: "persons", entityId: "P1", type: "create", changes: after({ firstName: "علی", lastName: "ر", phone: "0912", cardNumber: "6037", photo: "x" }) }));
    const p = (await db.persons.get("P1"))!;
    expect(p.firstName).toBe("علی");
    expect(p.phone).toBeUndefined();
    expect(p.cardNumber).toBeUndefined();
    expect(p.photo).toBeUndefined();
  });

  it("keeps a local person's own private fields when a remote rename arrives", async () => {
    await db.persons.put({ id: "P1", firstName: "ع", lastName: "ر", phone: "0912", archived: false, createdAt: "a", updatedAt: "a", deviceId: "d", version: 1, deleted: false });
    await applyRemoteOperation(EV, env({ entity: "persons", entityId: "P1", type: "update", changes: { firstName: { before: "ع", after: "علی" } } }));
    expect(await db.persons.get("P1")).toMatchObject({ firstName: "علی", phone: "0912" });
  });

  it("an update for an unknown record is dropped; duplicate membership/numbers do not crash", async () => {
    expect(await applyRemoteOperation(EV, env({ entity: "vouchers", entityId: "NOPE", type: "update", changes: { number: { before: 1, after: 2 } } }))).toBe("applied");
    expect(await db.vouchers.get("NOPE")).toBeUndefined();

    await applyRemoteOperation(EV, env({ entity: "eventMembers", entityId: "M1", type: "create", changes: after({ eventId: EV, personId: "p1", active: true }) }));
    await applyRemoteOperation(EV, env({ entity: "eventMembers", entityId: "M2", type: "create", changes: after({ eventId: EV, personId: "p1", active: true }) }));
    expect(await db.eventMembers.count()).toBe(1);

    await applyRemoteOperation(EV, env({ entity: "vouchers", entityId: "V1", type: "create", changes: after({ eventId: EV, number: 1 }) }));
    await applyRemoteOperation(EV, env({ entity: "vouchers", entityId: "V2", type: "create", changes: after({ eventId: EV, number: 1 }) }));
    expect((await db.vouchers.get("V2"))!.number).toBe(2);
  });

  it("reports a remote purge of the event itself", async () => {
    expect(await applyRemoteOperation(EV, env({ entity: "events", entityId: EV, type: "purge" }))).toBe("purged");
  });
});
