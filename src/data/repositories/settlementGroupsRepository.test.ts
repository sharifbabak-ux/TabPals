import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { wipeOnlineEvent } from "../online/localCleanup";
import { eventMembersRepository } from "./eventMembersRepository";
import { eventsRepository } from "./eventsRepository";
import { groupsRepository } from "./groupsRepository";
import { SettlementGroupValidationError, settlementGroupsRepository as repo } from "./settlementGroupsRepository";

beforeEach(async () => {
  await Promise.all([db.events.clear(), db.eventMembers.clear(), db.groups.clear(), db.settlementGroups.clear(), db.operations.clear()]);
});

async function setup(personIds: string[] = ["t", "a", "b", "c", "d"], treasurer: string | null = "t") {
  const event = await eventsRepository.create({ title: "سفر", treasurerPersonId: treasurer });
  await eventMembersRepository.addMembers(event.id, personIds);
  return event;
}

async function code(p: Promise<unknown>): Promise<string[]> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SettlementGroupValidationError);
    return (e as SettlementGroupValidationError).errors.map((x) => x.code);
  }
  throw new Error("expected rejection");
}

describe("settlementGroupsRepository CRUD", () => {
  it("creates, gets, lists, updates and soft-deletes, scoped per event", async () => {
    const e1 = await setup();
    const e2 = await setup(["a", "b"]);
    const g1 = await repo.create({ eventId: e1.id, name: " خانواده ", memberIds: ["a", "b"], representativeId: "a" });
    const g2 = await repo.create({ eventId: e2.id, name: "دیگر", memberIds: ["a", "b"], representativeId: "b" });
    expect(g1.name).toBe("خانواده");
    expect(g1.deleted).toBe(false);
    expect(g1.version).toBe(1);
    expect(await repo.get(g1.id)).toMatchObject({ eventId: e1.id, memberIds: ["a", "b"], representativeId: "a" });
    expect((await repo.listByEvent(e1.id)).map((g) => g.id)).toEqual([g1.id]);
    expect((await repo.listByEvent(e2.id)).map((g) => g.id)).toEqual([g2.id]);

    const updated = await repo.update(g1.id, { name: "جدید", memberIds: ["a", "b", "c"], representativeId: "c" });
    expect(updated).toMatchObject({ name: "جدید", memberIds: ["a", "b", "c"], representativeId: "c", version: 2 });

    await repo.delete(g1.id);
    expect(await repo.get(g1.id)).toBeUndefined();
    expect(await repo.listByEvent(e1.id)).toEqual([]);
    expect((await db.settlementGroups.get(g1.id))?.deleted).toBe(true);
    expect((await repo.listByEvent(e2.id)).length).toBe(1);
    const ops = await db.operations.where("entityId").equals(g1.id).toArray();
    // Operations created in the same millisecond have random ULIDs, so their stored order is not fixed: compare as a set.
    expect(ops.map((o) => `${o.entity}:${o.type}`).sort()).toEqual(["settlementGroups:create", "settlementGroups:delete", "settlementGroups:update"]);
  });

  it("lists groups with the same creation time in a fixed order (by id)", async () => {
    const e = await setup();
    const base = { eventId: e.id, memberIds: ["a", "b"], representativeId: "a", createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z", deviceId: "d", version: 1, deleted: false };
    await db.settlementGroups.bulkAdd([
      { ...base, id: "01C", name: "ج" },
      { ...base, id: "01A", name: "الف" },
      { ...base, id: "01B", name: "ب" }
    ]);
    expect((await repo.listByEvent(e.id)).map((g) => g.id)).toEqual(["01A", "01B", "01C"]);
  });

  it("allows a person to be re-grouped after their group was deleted", async () => {
    const e = await setup();
    const g = await repo.create({ eventId: e.id, name: "الف", memberIds: ["a", "b"], representativeId: "a" });
    await repo.delete(g.id);
    await expect(repo.create({ eventId: e.id, name: "ب", memberIds: ["a", "c"], representativeId: "a" })).resolves.toBeTruthy();
  });

  it("stores and reads back a 10+ member group", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const e = await setup(ids, "p0");
    const g = await repo.create({ eventId: e.id, name: "بزرگ", memberIds: ids, representativeId: "p0" });
    expect((await repo.get(g.id))?.memberIds).toEqual(ids);
  });
});

describe("settlementGroupsRepository on a finished event (SG-3)", () => {
  it("creates, updates and deletes groups after the event is closed", async () => {
    const e = await setup();
    await eventsRepository.close(e.id);
    const g = await repo.create({ eventId: e.id, name: "الف", memberIds: ["a", "b"], representativeId: "a" });
    const u = await repo.update(g.id, { memberIds: ["a", "b", "c"], representativeId: "c" });
    expect(u.memberIds).toEqual(["a", "b", "c"]);
    await repo.delete(g.id);
    expect(await repo.listByEvent(e.id)).toEqual([]);
  });
});

describe("settlementGroupsRepository validation", () => {
  it("rejects every invalid shape with a typed error and stores nothing", async () => {
    const e = await setup();
    const base = { eventId: e.id, name: "گ", memberIds: ["a", "b"], representativeId: "a" };
    await repo.create(base);
    expect(await code(repo.create({ ...base, memberIds: ["b", "c"], representativeId: "c" }))).toContain("person-in-multiple-groups");
    expect(await code(repo.create({ ...base, memberIds: ["c"], representativeId: "c" }))).toContain("too-few-members");
    expect(await code(repo.create({ ...base, memberIds: ["c", "d"], representativeId: "a" }))).toContain("representative-not-member");
    expect(await code(repo.create({ ...base, memberIds: ["c", "d"], representativeId: "c", name: "  " }))).toContain("empty-name");
    expect(await code(repo.create({ ...base, memberIds: ["c", "zzz"], representativeId: "c" }))).toContain("unknown-person");
    expect(await code(repo.create({ ...base, memberIds: ["t", "c"], representativeId: "c" }))).toContain("treasurer-must-represent");
    expect(await repo.listByEvent(e.id)).toHaveLength(1);
  });

  it("validates on update too and leaves the stored group unchanged", async () => {
    const e = await setup();
    const g1 = await repo.create({ eventId: e.id, name: "1", memberIds: ["a", "b"], representativeId: "a" });
    await repo.create({ eventId: e.id, name: "2", memberIds: ["c", "d"], representativeId: "c" });
    expect(await code(repo.update(g1.id, { memberIds: ["a", "c"] }))).toContain("person-in-multiple-groups");
    expect(await code(repo.update(g1.id, { memberIds: ["a", "t"] }))).toContain("treasurer-must-represent");
    expect((await repo.get(g1.id))?.memberIds).toEqual(["a", "b"]);
  });

  it("accepts a treasurer inside a group when they represent it", async () => {
    const e = await setup();
    await expect(repo.create({ eventId: e.id, name: "گ", memberIds: ["t", "a"], representativeId: "t" })).resolves.toBeTruthy();
  });
});

describe("settlementGroupsRepository.handleMemberRemoved", () => {
  it("falls back to the first remaining member when the representative leaves", async () => {
    const e = await setup();
    const g = await repo.create({ eventId: e.id, name: "گ", memberIds: ["a", "b", "c"], representativeId: "a" });
    const out = await repo.handleMemberRemoved(e.id, "a");
    expect(out).toMatchObject({ groupId: g.id, notice: "representative-fallback" });
    expect(await repo.get(g.id)).toMatchObject({ memberIds: ["b", "c"], representativeId: "b" });
  });

  it("dissolves a group that drops below 2 members and leaves other groups alone", async () => {
    const e = await setup(["t", "a", "b", "c", "d", "x"]);
    const g1 = await repo.create({ eventId: e.id, name: "1", memberIds: ["a", "b"], representativeId: "a" });
    const g2 = await repo.create({ eventId: e.id, name: "2", memberIds: ["c", "d", "x"], representativeId: "c" });
    const before = await db.settlementGroups.get(g2.id);
    const out = await repo.handleMemberRemoved(e.id, "b");
    expect(out?.notice).toBe("dissolved");
    expect(await repo.get(g1.id)).toBeUndefined();
    expect(await db.settlementGroups.get(g2.id)).toEqual(before);
  });

  it("returns null for a person in no group", async () => {
    const e = await setup();
    await repo.create({ eventId: e.id, name: "1", memberIds: ["a", "b"], representativeId: "a" });
    expect(await repo.handleMemberRemoved(e.id, "d")).toBeNull();
  });

  it("returns the typed error and stores nothing when the repair would break the treasurer rule", async () => {
    const e = await setup();
    // Group with representative "a" (treasurer not inside), then the treasurer is
    // changed to "b" who is inside: the stored set is now invalid by the treasurer rule
    // only if the representative is not b. Removing "c" leaves a still-invalid group.
    const g = await repo.create({ eventId: e.id, name: "1", memberIds: ["a", "b", "c"], representativeId: "a" });
    await db.events.update(e.id, { treasurerPersonId: "b" });
    const before = await db.settlementGroups.get(g.id);
    const opsBefore = await db.operations.count();
    await expect(repo.handleMemberRemoved(e.id, "c")).rejects.toBeInstanceOf(SettlementGroupValidationError);
    expect(await db.settlementGroups.get(g.id)).toEqual(before);
    expect(await db.operations.count()).toBe(opsBefore);
  });
});

describe("event purge and the device-level groups table", () => {
  it("permanent delete removes that event's settlement groups only", async () => {
    const e1 = await setup();
    const e2 = await setup();
    await repo.create({ eventId: e1.id, name: "1", memberIds: ["a", "b"], representativeId: "a" });
    const keep = await repo.create({ eventId: e2.id, name: "2", memberIds: ["a", "b"], representativeId: "a" });
    await eventsRepository.close(e1.id);
    await eventsRepository.moveToTrash(e1.id);
    await eventsRepository.permanentlyDelete(e1.id);
    expect(await db.settlementGroups.where("eventId").equals(e1.id).count()).toBe(0);
    expect((await db.settlementGroups.toArray()).map((g) => g.id)).toEqual([keep.id]);
  });

  it("wiping an online event's local data removes its settlement groups too", async () => {
    const e1 = await setup();
    const e2 = await setup();
    await repo.create({ eventId: e1.id, name: "1", memberIds: ["a", "b"], representativeId: "a" });
    const keep = await repo.create({ eventId: e2.id, name: "2", memberIds: ["a", "b"], representativeId: "a" });
    await wipeOnlineEvent(e1.id);
    expect((await db.settlementGroups.toArray()).map((g) => g.id)).toEqual([keep.id]);
  });

  it("does not touch the saved-people `groups` table", async () => {
    const saved = await groupsRepository.create({ name: "خانواده", personIds: ["p1", "p2"] });
    const e = await setup();
    await repo.create({ eventId: e.id, name: "1", memberIds: ["a", "b"], representativeId: "a" });
    expect(await db.groups.toArray()).toHaveLength(1);
    expect((await db.groups.get(saved.id))?.personIds).toEqual(["p1", "p2"]);
  });
});
