import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { eventsRepository } from "./eventsRepository";

beforeEach(async () => {
  await db.events.clear();
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
});
