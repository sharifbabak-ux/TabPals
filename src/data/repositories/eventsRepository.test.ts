import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { eventsRepository } from "./eventsRepository";

beforeEach(async () => {
  await db.events.clear();
  await db.operations.clear();
});

describe("eventsRepository", () => {
  it("creates an event with default currencyLabel and no close/reopen state", async () => {
    const event = await eventsRepository.create({ title: "سفر شمال" });
    expect(event.currencyLabel).toBe("تومان");
    expect(event.closedAt).toBeNull();
    expect(event.reopenedAt).toBeNull();
    expect(event.reopenReason).toBeNull();
  });

  it("accepts a custom currency label", async () => {
    const event = await eventsRepository.create({ title: "سفر", currencyLabel: "دلار" });
    expect(event.currencyLabel).toBe("دلار");
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
