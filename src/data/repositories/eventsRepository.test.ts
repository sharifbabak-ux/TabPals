import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { eventMembersRepository } from "./eventMembersRepository";
import { eventsRepository, TreasurerChangeBlockedError } from "./eventsRepository";
import { personsRepository } from "./personsRepository";
import { settlementGroupsRepository } from "./settlementGroupsRepository";

beforeEach(async () => {
  await db.events.clear();
  await db.eventMembers.clear();
  await db.vouchers.clear();
  await db.statements.clear();
  await db.operations.clear();
});

describe("eventsRepository", () => {
  it("creates an event with default currency and no close/reopen state", async () => {
    const event = await eventsRepository.create({ title: "سفر شمال" });
    expect(event.currency).toBe("تومان");
    expect(event.treasurerPersonId).toBeNull();
    expect(event.closedAt).toBeNull();
    expect(event.reopenedAt).toBeNull();
    expect(event.reopenReason).toBeNull();
  });

  it("accepts ریال as the currency", async () => {
    const event = await eventsRepository.create({ title: "سفر", currency: "ریال" });
    expect(event.currency).toBe("ریال");
  });

  it("falls back to تومان for an invalid currency value", async () => {
    const event = await eventsRepository.create({ title: "سفر", currency: "دلار" as never });
    expect(event.currency).toBe("تومان");
  });

  it("sets the treasurer and logs the change", async () => {
    const event = await eventsRepository.create({ title: "سفر", treasurerPersonId: "p1" });
    expect(event.treasurerPersonId).toBe("p1");

    await eventsRepository.update(event.id, { treasurerPersonId: "p2" });
    const updated = await db.events.get(event.id);
    expect(updated?.treasurerPersonId).toBe("p2");

    const ops = await db.operations
      .where("entityId")
      .equals(event.id)
      .filter((o) => o.type === "update" && "treasurerPersonId" in o.changes)
      .toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0].changes.treasurerPersonId).toEqual({ before: "p1", after: "p2" });
  });

  it("rejects an invalid treasurer card number or IBAN", async () => {
    await expect(eventsRepository.create({ title: "سفر", treasurerCardNumber: "12345" })).rejects.toThrow();
    await expect(eventsRepository.create({ title: "سفر", treasurerIban: "IR123" })).rejects.toThrow();
  });

  it("blocks changing the treasurer on a closed event", async () => {
    const event = await eventsRepository.create({ title: "سفر", treasurerPersonId: "p1" });
    await eventsRepository.close(event.id);
    await expect(eventsRepository.update(event.id, { treasurerPersonId: "p2" })).rejects.toThrow();
  });

  it("still allows setting a treasurer for the first time on a closed event (docs/PLAN.md Stage 3B)", async () => {
    const event = await eventsRepository.create({ title: "سفر" });
    await eventsRepository.close(event.id);
    await expect(eventsRepository.update(event.id, { treasurerPersonId: "p1" })).resolves.toBeUndefined();
    expect((await db.events.get(event.id))?.treasurerPersonId).toBe("p1");
  });

  it("still allows editing the title on a closed event", async () => {
    const event = await eventsRepository.create({ title: "سفر" });
    await eventsRepository.close(event.id);
    await expect(eventsRepository.update(event.id, { title: "سفر ۲" })).resolves.toBeUndefined();
  });

  it("closes an event and logs a close operation", async () => {
    const event = await eventsRepository.create({ title: "سفر" });
    await eventsRepository.close(event.id);

    const closed = await db.events.get(event.id);
    expect(closed?.closedAt).toBeTruthy();

    const ops = await db.operations.where("entityId").equals(event.id).filter((o) => o.type === "close").toArray();
    expect(ops).toHaveLength(1);
  });

  it("is a no-op when closing an already-closed event", async () => {
    const event = await eventsRepository.create({ title: "سفر" });
    await eventsRepository.close(event.id);
    await eventsRepository.close(event.id);

    const ops = await db.operations.where("entityId").equals(event.id).filter((o) => o.type === "close").toArray();
    expect(ops).toHaveLength(1);
  });

  it("reopens a closed event with a reason and logs a reopen operation", async () => {
    const event = await eventsRepository.create({ title: "سفر" });
    await eventsRepository.close(event.id);
    await eventsRepository.reopen(event.id, "اشتباه بسته شد");

    const reopened = await db.events.get(event.id);
    expect(reopened?.closedAt).toBeNull();
    expect(reopened?.reopenedAt).toBeTruthy();
    expect(reopened?.reopenReason).toBe("اشتباه بسته شد");

    const ops = await db.operations.where("entityId").equals(event.id).filter((o) => o.type === "reopen").toArray();
    expect(ops).toHaveLength(1);
  });

  it("rejects reopening without a reason", async () => {
    const event = await eventsRepository.create({ title: "سفر" });
    await eventsRepository.close(event.id);
    await expect(eventsRepository.reopen(event.id, "  ")).rejects.toThrow();
  });

  it("blocks moving an open event to trash", async () => {
    const event = await eventsRepository.create({ title: "سفر" });
    await expect(eventsRepository.moveToTrash(event.id)).rejects.toThrow();
  });

  it("moves a closed event to trash and logs a trash operation", async () => {
    const event = await eventsRepository.create({ title: "سفر" });
    await eventsRepository.close(event.id);
    await eventsRepository.moveToTrash(event.id);

    const trashed = await db.events.get(event.id);
    expect(trashed?.deletedAt).toBeTruthy();

    const ops = await db.operations.where("entityId").equals(event.id).filter((o) => o.type === "trash").toArray();
    expect(ops).toHaveLength(1);
  });

  it("restores a trashed event, clearing deletedAt", async () => {
    const event = await eventsRepository.create({ title: "سفر" });
    await eventsRepository.close(event.id);
    await eventsRepository.moveToTrash(event.id);
    await eventsRepository.restoreFromTrash(event.id);

    expect((await db.events.get(event.id))?.deletedAt).toBeNull();
    const ops = await db.operations.where("entityId").equals(event.id).filter((o) => o.type === "restore").toArray();
    expect(ops).toHaveLength(1);
  });

  it("blocks permanently deleting an event that is not in trash", async () => {
    const event = await eventsRepository.create({ title: "سفر" });
    await eventsRepository.close(event.id);
    await expect(eventsRepository.permanentlyDelete(event.id)).rejects.toThrow();
  });

  it("permanently deletes a trashed event and everything belonging to it, writing a purge tombstone", async () => {
    const event = await eventsRepository.create({ title: "سفر" });
    await db.eventMembers.add({
      id: "m1",
      eventId: event.id,
      personId: "p1",
      defaultWeight: 1,
      active: true,
      sortOrder: 0,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
      deviceId: "device-1",
      version: 1,
      deleted: false
    });
    await eventsRepository.close(event.id);
    await eventsRepository.moveToTrash(event.id);
    await eventsRepository.permanentlyDelete(event.id);

    expect(await db.events.get(event.id)).toBeUndefined();
    expect(await db.eventMembers.get("m1")).toBeUndefined();
    const ops = await db.operations.where("entityId").equals(event.id).filter((o) => o.type === "purge").toArray();
    expect(ops).toHaveLength(1);
  });
});

describe("eventsRepository.update — treasurer change vs settlement groups (SG-4)", () => {
  async function seed() {
    await db.persons.clear();
    await db.settlementGroups.clear();
    const ids: Record<string, string> = {};
    for (const n of ["صندوق", "الف", "ب", "ج"]) ids[n] = (await personsRepository.create({ firstName: n, lastName: "نمونه" })).id;
    const event = await eventsRepository.create({ title: "سفر", treasurerPersonId: ids["صندوق"] });
    await eventMembersRepository.addMembers(event.id, Object.values(ids));
    return { event, ids };
  }

  it("blocks a change that makes a group invalid, names the group, and saves nothing", async () => {
    const { event, ids } = await seed();
    await settlementGroupsRepository.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["الف"] });
    const opsBefore = await db.operations.count();
    const err = await eventsRepository.update(event.id, { treasurerPersonId: ids["ب"] }).catch((e) => e);
    expect(err).toBeInstanceOf(TreasurerChangeBlockedError);
    expect(err.message).toContain("«خانواده»");
    expect(err.message).toContain("ابتدا نمایندهٔ گروه");
    expect((await db.events.get(event.id))!.treasurerPersonId).toBe(ids["صندوق"]);
    expect(await db.operations.count()).toBe(opsBefore);
  });

  it("allows the change when the new treasurer is the representative of their group", async () => {
    const { event, ids } = await seed();
    await settlementGroupsRepository.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["ب"] });
    await eventsRepository.update(event.id, { treasurerPersonId: ids["ب"] });
    expect((await db.events.get(event.id))!.treasurerPersonId).toBe(ids["ب"]);
  });

  it("allows the change when the new treasurer is in no group", async () => {
    const { event, ids } = await seed();
    await settlementGroupsRepository.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["الف"] });
    await eventsRepository.update(event.id, { treasurerPersonId: ids["ج"] });
    expect((await db.events.get(event.id))!.treasurerPersonId).toBe(ids["ج"]);
  });

  it("allows the change when the event has no groups, and ignores deleted groups", async () => {
    const { event, ids } = await seed();
    await eventsRepository.update(event.id, { treasurerPersonId: ids["الف"] });
    expect((await db.events.get(event.id))!.treasurerPersonId).toBe(ids["الف"]);
    const g = await settlementGroupsRepository.create({ eventId: event.id, name: "خانواده", memberIds: [ids["ب"], ids["ج"]], representativeId: ids["ب"] });
    await settlementGroupsRepository.delete(g.id);
    await eventsRepository.update(event.id, { treasurerPersonId: ids["ج"] });
    expect((await db.events.get(event.id))!.treasurerPersonId).toBe(ids["ج"]);
  });

  it("does not check groups when the treasurer is unchanged (e.g. a title edit)", async () => {
    const { event, ids } = await seed();
    await settlementGroupsRepository.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["الف"] });
    await eventsRepository.update(event.id, { title: "سفر جدید", treasurerPersonId: ids["صندوق"] });
    expect((await db.events.get(event.id))!.title).toBe("سفر جدید");
  });
});
