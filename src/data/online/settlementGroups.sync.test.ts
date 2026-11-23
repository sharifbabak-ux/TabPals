import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkOp } from "@/domain/onlinePermissions";
import { validateGroups } from "@/domain/settlementUnits";
import { db } from "../db";
import { eventMembersRepository } from "../repositories/eventMembersRepository";
import { eventsRepository } from "../repositories/eventsRepository";
import { personsRepository } from "../repositories/personsRepository";
import { settlementGroupsRepository as repo } from "../repositories/settlementGroupsRepository";
import type { OnlineLink, OnlineRole, ServerOp } from "../types";
import type { RemoteOpEnvelope } from "./apiClient";
import { applyRemoteOperation, readSkippedUnknownOps } from "./applyRemoteOperation";
import { OnlinePermissionError } from "./outboxHook";
import { buildSnapshotOps } from "./onlineService";
import { wipeOnlineEvent } from "./localCleanup";

async function goOnlineAs(eventId: string, roles: OnlineRole[]) {
  const link: OnlineLink = { localEventId: eventId, serverEventId: eventId, memberId: "m1", roles, deviceToken: "t", lastSeq: 0, status: "online", createdAt: "2026-01-01T00:00:00.000Z" };
  await db.onlineLinks.put(link);
}

async function setup() {
  for (const table of db.tables) if (table.name !== "messageTemplates") await table.clear();
  const ids: string[] = [];
  for (const n of ["صندوق", "الف", "ب", "ج"]) ids.push((await personsRepository.create({ firstName: n, lastName: "نمونه" })).id);
  const [t, a, b, c] = ids;
  const event = await eventsRepository.create({ title: "سفر", treasurerPersonId: t });
  await eventMembersRepository.addMembers(event.id, ids);
  return { event, t, a, b, c };
}

let seq = 0;
function env(op: Partial<ServerOp> & Pick<ServerOp, "entity" | "entityId" | "type">, s = ++seq): RemoteOpEnvelope {
  return { seq: s, serverTs: "2026-01-01T00:00:00.000Z", memberId: "t1", deviceId: "other-device", op: { id: `op-${s}`, changes: {}, timestamp: 1_760_000_000_000 + s, deviceId: "other-device", ...op } };
}
const after = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { before: undefined, after: v }]));

beforeEach(() => {
  seq = 0;
});

describe("settlement groups: outbox", () => {
  it("online event: create/update/delete enqueue ops for that event; offline events queue nothing", async () => {
    const { event, a, b, c } = await setup();
    const offline = await eventsRepository.create({ title: "آفلاین" });
    await repo.create({ eventId: event.id, name: "آفلاین‌گروه", memberIds: [a, b], representativeId: a }); // before online: nothing
    expect(await db.outbox.count()).toBe(0);

    await goOnlineAs(event.id, ["admin"]);
    const g = await repo.create({ eventId: event.id, name: "زوج", memberIds: [c], representativeId: c }).catch(() => null);
    expect(g).toBeNull(); // invalid (1 member) → nothing queued
    expect(await db.outbox.count()).toBe(0);

    const created = (await repo.listByEvent(event.id))[0];
    await repo.update(created.id, { memberIds: [a, b, c], representativeId: c });
    await repo.delete(created.id);
    const rows = await db.outbox.toArray();
    expect(rows.map((r) => [r.localEventId, r.op.entity, r.op.type])).toEqual([
      [event.id, "settlementGroups", "update"],
      [event.id, "settlementGroups", "delete"]
    ]);
    expect(rows[0].op.changes.memberIds.after).toEqual([a, b, c]);
    void offline;
  });

  it("create carries the full record", async () => {
    const { event, a, b } = await setup();
    await goOnlineAs(event.id, ["treasurer"]);
    const g = await repo.create({ eventId: event.id, name: "زوج", memberIds: [a, b], representativeId: a });
    const [row] = await db.outbox.toArray();
    expect(row.op).toMatchObject({ entity: "settlementGroups", entityId: g.id, type: "create" });
    expect(row.op.changes.eventId.after).toBe(event.id);
    expect(row.op.changes.name.after).toBe("زوج");
    expect(row.op.changes.representativeId.after).toBe(a);
  });

  it("a plain member's local write is refused with a Persian message and queues nothing; admin/treasurer succeed", async () => {
    const { event, a, b } = await setup();
    await goOnlineAs(event.id, ["member"]);
    const attempt = repo.create({ eventId: event.id, name: "زوج", memberIds: [a, b], representativeId: a });
    await expect(attempt).rejects.toBeInstanceOf(OnlinePermissionError);
    await expect(attempt).rejects.toThrow(/نقش شما/);
    expect(await db.outbox.count()).toBe(0);
    expect(await repo.listByEvent(event.id)).toHaveLength(0);

    await goOnlineAs(event.id, ["treasurer"]);
    await repo.create({ eventId: event.id, name: "زوج", memberIds: [a, b], representativeId: a });
    expect(await db.outbox.count()).toBe(1);
  });

  it("checkOp mirrors the server: admin and treasurer may write, member may not", () => {
    const op = { entity: "settlementGroups", entityId: "G1", type: "create" };
    expect(checkOp({ memberId: "m", roles: ["admin"] }, op).ok).toBe(true);
    expect(checkOp({ memberId: "m", roles: ["treasurer"] }, op).ok).toBe(true);
    expect(checkOp({ memberId: "m", roles: ["member"] }, op).ok).toBe(false);
  });

  it("removing a member syncs the repaired group like any other change", async () => {
    const { event, a, b, c } = await setup();
    const g = await repo.create({ eventId: event.id, name: "سه‌نفره", memberIds: [a, b, c], representativeId: a });
    await goOnlineAs(event.id, ["admin"]);
    await repo.handleMemberRemoved(event.id, c);
    let rows = await db.outbox.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].op).toMatchObject({ entity: "settlementGroups", entityId: g.id, type: "update" });
    expect(rows[0].op.changes.memberIds.after).toEqual([a, b]);
    await repo.handleMemberRemoved(event.id, b); // < 2 left → dissolved
    rows = await db.outbox.toArray();
    expect(rows[1].op).toMatchObject({ entityId: g.id, type: "delete" });
  });
});

describe("settlement groups: initial upload", () => {
  it("includes live groups, not deleted ones", async () => {
    const { event, a, b, c, t } = await setup();
    const keep = await repo.create({ eventId: event.id, name: "زوج", memberIds: [a, b], representativeId: a });
    const gone = await repo.create({ eventId: event.id, name: "حذف‌شده", memberIds: [t, c], representativeId: t });
    await repo.delete(gone.id);
    const ops = (await buildSnapshotOps(db, event.id)).filter((o) => o.entity === "settlementGroups");
    expect(ops.map((o) => o.entityId)).toEqual([keep.id]);
    expect(ops[0].type).toBe("create");
    expect(ops[0].changes.memberIds.after).toEqual([a, b]);
  });
});

describe("settlement groups: apply remote", () => {
  const EV = "EV1";
  beforeEach(async () => {
    for (const table of db.tables) if (table.name !== "messageTemplates") await table.clear();
    await goOnlineAs(EV, ["member"]);
    await db.onlineLinks.update(EV, { localEventId: EV });
  });
  const create = (id: string, extra: Record<string, unknown> = {}) =>
    env({ entity: "settlementGroups", entityId: id, type: "create", changes: after({ eventId: EV, name: "زوج", memberIds: ["a", "b"], representativeId: "a", ...extra }) });

  it("create / update (memberIds replaced as a whole) / delete / restore", async () => {
    await applyRemoteOperation(EV, create("G1"));
    expect(await db.settlementGroups.get("G1")).toMatchObject({ eventId: EV, name: "زوج", memberIds: ["a", "b"], deleted: false, version: 1 });
    await applyRemoteOperation(EV, env({ entity: "settlementGroups", entityId: "G1", type: "update", changes: { memberIds: { before: ["a", "b"], after: ["c"] } } }));
    expect((await db.settlementGroups.get("G1"))!.memberIds).toEqual(["c"]); // not merged element-wise
    await applyRemoteOperation(EV, env({ entity: "settlementGroups", entityId: "G1", type: "delete" }));
    expect((await db.settlementGroups.get("G1"))!.deleted).toBe(true);
    await applyRemoteOperation(EV, env({ entity: "settlementGroups", entityId: "G1", type: "restore", changes: { deleted: { before: true, after: false } } }));
    expect((await db.settlementGroups.get("G1"))!.deleted).toBe(false);
    // applying never queues anything
    expect(await db.outbox.count()).toBe(0);
  });

  it("applies in seq order, ignores duplicates and advances lastSeq", async () => {
    const c = create("G1");
    const u = env({ entity: "settlementGroups", entityId: "G1", type: "update", changes: { name: { before: "زوج", after: "خانواده" } } });
    expect(await applyRemoteOperation(EV, c)).toBe("applied");
    expect(await applyRemoteOperation(EV, u)).toBe("applied");
    expect(await applyRemoteOperation(EV, c)).toBe("duplicate");
    expect(await applyRemoteOperation(EV, u)).toBe("duplicate");
    const g = (await db.settlementGroups.get("G1"))!;
    expect(g.name).toBe("خانواده");
    expect(g.version).toBe(2);
    expect((await db.onlineLinks.get(EV))!.lastSeq).toBe(u.seq);
  });

  it("purge removes the group; wiping the event removes all its groups", async () => {
    await applyRemoteOperation(EV, create("G1"));
    await applyRemoteOperation(EV, create("G2", { name: "دیگر", memberIds: ["c", "d"], representativeId: "c" }));
    await applyRemoteOperation(EV, env({ entity: "settlementGroups", entityId: "G1", type: "purge" }));
    expect(await db.settlementGroups.get("G1")).toBeUndefined();
    await wipeOnlineEvent(EV);
    expect(await db.settlementGroups.count()).toBe(0);
  });

  it("unknown entity (newer app version) is skipped, counted, and lastSeq still advances", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unknown = env({ entity: "orderSubmissions", entityId: "X1", type: "create", changes: after({ eventId: EV, foo: 1 }) });
    expect(await applyRemoteOperation(EV, unknown)).toBe("ignored");
    expect((await db.onlineLinks.get(EV))!.lastSeq).toBe(unknown.seq);
    expect(await readSkippedUnknownOps()).toBe(1);
    // a later known op still applies
    expect(await applyRemoteOperation(EV, create("G1"))).toBe("applied");
    expect(await readSkippedUnknownOps()).toBe(1);
    warn.mockRestore();
  });

  it("concurrent edits: one person in two groups is applied as-is and reported invalid", async () => {
    await applyRemoteOperation(EV, create("G1", { memberIds: ["a", "b"], representativeId: "a" })); // device 1
    await applyRemoteOperation(EV, create("G2", { name: "دیگر", memberIds: ["b", "c"], representativeId: "b" })); // device 2, same time
    const live = await db.settlementGroups.where("eventId").equals(EV).toArray();
    expect(live).toHaveLength(2);
    const errors = validateGroups(live.map((g) => ({ id: g.id, name: g.name, memberIds: g.memberIds, representativeId: g.representativeId })), { knownPersonIds: ["a", "b", "c", "t"], treasurerId: "t" });
    expect(errors.map((e) => e.code)).toContain("person-in-multiple-groups");
  });
});
