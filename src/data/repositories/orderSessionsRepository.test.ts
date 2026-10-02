import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { eventsRepository } from "./eventsRepository";
import { FinalizeBlockedError, orderSessionsRepository } from "./orderSessionsRepository";

beforeEach(async () => {
  await Promise.all([
    db.events.clear(),
    db.vouchers.clear(),
    db.orderSessions.clear(),
    db.sessionMenuItems.clear(),
    db.orderLines.clear(),
    db.orderPersonTotals.clear(),
    db.sessionExtras.clear(),
    db.operations.clear()
  ]);
});

async function setup(options: { treasurer?: string | null } = {}) {
  const event = await eventsRepository.create({ title: "سفر شمال", treasurerPersonId: options.treasurer === undefined ? "t" : options.treasurer });
  const session = await orderSessionsRepository.create({ eventId: event.id, title: "شام", restaurant: "نایب", scheduledAt: "2025-09-28T18:30:00.000Z" });
  return { event, session };
}

async function openedSession() {
  const ctx = await setup();
  await orderSessionsRepository.transition(ctx.session.id, "open");
  return ctx;
}

describe("orderSessionsRepository.create", () => {
  it("creates a draft session whose admin is the event treasurer, and logs it", async () => {
    const { event, session } = await setup();
    expect(session.status).toBe("draft");
    expect(session.adminPersonId).toBe("t");
    expect(session.deputyPersonId).toBeNull();
    expect(session.voucherId).toBeNull();
    expect(session.eventId).toBe(event.id);
    const ops = await db.operations.where("entityId").equals(session.id).toArray();
    expect(ops.map((o) => [o.entity, o.type])).toEqual([["orderSessions", "create"]]);
  });

  it("requires the event to have a treasurer", async () => {
    const event = await eventsRepository.create({ title: "بدون مسئول", treasurerPersonId: null });
    await expect(orderSessionsRepository.create({ eventId: event.id, title: "شام", scheduledAt: "2025-09-28T18:30:00.000Z" })).rejects.toThrow("مسئول صندوق");
  });

  it("requires a title", async () => {
    const event = await eventsRepository.create({ title: "x", treasurerPersonId: "t" });
    await expect(orderSessionsRepository.create({ eventId: event.id, title: "  ", scheduledAt: "2025-09-28T18:30:00.000Z" })).rejects.toThrow();
  });
});

describe("state machine through the repository", () => {
  it("walks draft → open → locked → open → locked → pricing", async () => {
    const { session } = await setup();
    for (const to of ["open", "locked", "open", "locked", "pricing"] as const) {
      await orderSessionsRepository.transition(session.id, to);
      expect((await db.orderSessions.get(session.id))?.status).toBe(to);
    }
  });

  it("rejects illegal transitions and a cancel without a reason", async () => {
    const { session } = await setup();
    await expect(orderSessionsRepository.transition(session.id, "pricing")).rejects.toThrow();
    await expect(orderSessionsRepository.transition(session.id, "cancelled", "")).rejects.toThrow("دلیل");
    await expect(orderSessionsRepository.transition(session.id, "finalized")).rejects.toThrow();
  });

  it("cancels with a reason and then treats the session as terminal", async () => {
    const { session } = await openedSession();
    await orderSessionsRepository.transition(session.id, "cancelled", "رستوران بسته بود");
    const cancelled = await db.orderSessions.get(session.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.cancelReason).toBe("رستوران بسته بود");
    await expect(orderSessionsRepository.transition(session.id, "open")).rejects.toThrow();
    await expect(orderSessionsRepository.addLine(session.id, { personId: "a", itemName: "x", quantity: 1 })).rejects.toThrow();
    await expect(orderSessionsRepository.update(session.id, { title: "y" })).rejects.toThrow();
    const ops = await db.operations.where("entityId").equals(session.id).toArray();
    expect(ops.some((o) => o.type === "cancel")).toBe(true);
  });
});

describe("order lines", () => {
  it("only accepts lines once the session is open (admin device may also edit while locked)", async () => {
    const { session } = await setup();
    await expect(orderSessionsRepository.addLine(session.id, { personId: "a", itemName: "کوبیده", quantity: 1 })).rejects.toThrow();
    await orderSessionsRepository.transition(session.id, "open");
    await orderSessionsRepository.addLine(session.id, { personId: "a", itemName: "کوبیده", quantity: 1 });
    await orderSessionsRepository.transition(session.id, "locked");
    await expect(orderSessionsRepository.addLine(session.id, { personId: "a", itemName: "دوغ", quantity: 1 })).resolves.toBeDefined();
    // Members (package/online) can no longer submit once locked.
    await expect(orderSessionsRepository.addLine(session.id, { personId: "b", itemName: "دوغ", quantity: 1, source: "online" })).rejects.toThrow();
  });

  it("validates quantity, names and shared participants", async () => {
    const { session } = await openedSession();
    const add = (input: Parameters<typeof orderSessionsRepository.addLine>[1]) => orderSessionsRepository.addLine(session.id, input);
    await expect(add({ personId: "a", itemName: "x", quantity: 0 })).rejects.toThrow();
    await expect(add({ personId: "a", itemName: "x", quantity: 1.5 })).rejects.toThrow();
    await expect(add({ personId: "a", itemName: "  ", quantity: 1 })).rejects.toThrow();
    await expect(add({ personId: null, itemName: "پیتزا", quantity: 1 })).rejects.toThrow();
    await expect(add({ personId: "a", itemName: "x", quantity: 1, unitPrice: -5 })).rejects.toThrow();
    const shared = await add({ personId: null, itemName: "پیتزا", quantity: 1, unitPrice: 100, sharedParticipants: [{ personId: "a", weight: 1 }, { personId: "b", weight: 2 }] });
    expect(shared.sharedParticipants).toHaveLength(2);
    expect(shared.source).toBe("admin-device");
    expect(shared.sourceVersion).toBe(1);
  });

  it("updates and soft-deletes lines with logged operations", async () => {
    const { session } = await openedSession();
    const line = await orderSessionsRepository.addLine(session.id, { personId: "a", itemName: "کوبیده", quantity: 1 });
    await orderSessionsRepository.updateLine(line.id, { quantity: 3, unitPrice: 120 });
    const updated = await db.orderLines.get(line.id);
    expect(updated).toMatchObject({ quantity: 3, unitPrice: 120, version: 2 });
    await orderSessionsRepository.updateLine(line.id, { unitPrice: null });
    expect((await db.orderLines.get(line.id))?.unitPrice).toBeUndefined();
    await orderSessionsRepository.removeLine(line.id);
    expect((await db.orderLines.get(line.id))?.deleted).toBe(true);
    const ops = await db.operations.where("entityId").equals(line.id).toArray();
    expect(ops.map((o) => o.type)).toEqual(["create", "update", "update", "delete"]);
  });

  it("applies a bulk price only to unpriced lines of that normalized item name", async () => {
    const { session } = await openedSession();
    const a = await orderSessionsRepository.addLine(session.id, { personId: "a", itemName: "کوبیده", quantity: 1 });
    const b = await orderSessionsRepository.addLine(session.id, { personId: "b", itemName: "كوبیده", quantity: 2 });
    const c = await orderSessionsRepository.addLine(session.id, { personId: "c", itemName: "کوبیده", quantity: 1, unitPrice: 90 });
    const d = await orderSessionsRepository.addLine(session.id, { personId: "c", itemName: "دوغ", quantity: 1 });
    expect(await orderSessionsRepository.applyBulkPrice(session.id, "کوبیده", 100)).toBe(2);
    expect((await db.orderLines.get(a.id))?.unitPrice).toBe(100);
    expect((await db.orderLines.get(b.id))?.unitPrice).toBe(100);
    expect((await db.orderLines.get(c.id))?.unitPrice).toBe(90);
    expect((await db.orderLines.get(d.id))?.unitPrice).toBeUndefined();
  });
});

describe("menu items, totals and extras", () => {
  it("adds, reorders and removes quick-menu items", async () => {
    const { session } = await setup();
    const a = await orderSessionsRepository.addMenuItem(session.id, { name: "کوبیده", price: 100 });
    const b = await orderSessionsRepository.addMenuItem(session.id, { name: "دوغ" });
    expect([a.sortOrder, b.sortOrder]).toEqual([0, 1]);
    await orderSessionsRepository.reorderMenuItems(session.id, [b.id, a.id]);
    expect((await db.sessionMenuItems.get(b.id))?.sortOrder).toBe(0);
    expect((await db.sessionMenuItems.get(a.id))?.sortOrder).toBe(1);
    await orderSessionsRepository.updateMenuItem(b.id, { price: 25 });
    expect((await db.sessionMenuItems.get(b.id))?.price).toBe(25);
    await orderSessionsRepository.removeMenuItem(a.id);
    expect((await db.sessionMenuItems.get(a.id))?.deleted).toBe(true);
  });

  it("upserts and clears a per-person total", async () => {
    const { session } = await openedSession();
    await orderSessionsRepository.setPersonTotal(session.id, "a", 500);
    await orderSessionsRepository.setPersonTotal(session.id, "a", 700);
    let rows = await db.orderPersonTotals.where("sessionId").equals(session.id).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(700);
    await orderSessionsRepository.setPersonTotal(session.id, "a", null);
    rows = await db.orderPersonTotals.where("sessionId").equals(session.id).filter((r) => !r.deleted).toArray();
    expect(rows).toHaveLength(0);
    await orderSessionsRepository.setPersonTotal(session.id, "a", 300);
    rows = await db.orderPersonTotals.where("sessionId").equals(session.id).filter((r) => !r.deleted).toArray();
    expect(rows.map((r) => r.total)).toEqual([300]);
  });

  it("adds, updates and removes extras, and manages the difference extra", async () => {
    const { session } = await openedSession();
    const vat = await orderSessionsRepository.addExtra(session.id, { kind: "vat", label: "مالیات ۱۰٪", mode: "percent", value: 10, allocation: "proportional" });
    await orderSessionsRepository.updateExtra(vat.id, { value: 9 });
    expect((await db.sessionExtras.get(vat.id))?.value).toBe(9);

    await orderSessionsRepository.setDifferenceExtra(session.id, 50, "equal");
    await orderSessionsRepository.setDifferenceExtra(session.id, 70, "proportional");
    let extras = await db.sessionExtras.where("sessionId").equals(session.id).filter((e) => !e.deleted).toArray();
    expect(extras.filter((e) => e.label === "اختلاف فاکتور")).toHaveLength(1);
    expect(extras.find((e) => e.label === "اختلاف فاکتور")).toMatchObject({ value: 70, allocation: "proportional" });
    await orderSessionsRepository.setDifferenceExtra(session.id, 0, "equal");
    await orderSessionsRepository.removeExtra(vat.id);
    extras = await db.sessionExtras.where("sessionId").equals(session.id).filter((e) => !e.deleted).toArray();
    expect(extras).toHaveLength(0);
  });
});

describe("finalize", () => {
  async function pricedSession(billTotal?: number) {
    const ctx = await openedSession();
    const { session } = ctx;
    await orderSessionsRepository.addLine(session.id, { personId: "a", itemName: "کوبیده", quantity: 2, unitPrice: 100 });
    await orderSessionsRepository.addLine(session.id, { personId: "b", itemName: "جوجه", quantity: 1, unitPrice: 150 });
    await orderSessionsRepository.addExtra(session.id, { kind: "vat", label: "مالیات ۱۰٪", mode: "percent", value: 10, allocation: "proportional" });
    await orderSessionsRepository.transition(session.id, "locked");
    await orderSessionsRepository.transition(session.id, "pricing");
    // subtotals 200 + 150 = 350; VAT 35 → 385
    await orderSessionsRepository.update(session.id, { billTotal: billTotal ?? 385, payers: [{ personId: "t", amount: billTotal ?? 385 }], expenseDate: "2025-09-28" });
    return ctx;
  }

  it("creates one itemized voucher, links it and marks the session finalized", async () => {
    const { event, session } = await pricedSession();
    const voucher = await orderSessionsRepository.finalize(session.id);
    expect(voucher).toMatchObject({ eventId: event.id, number: 1, type: "expense", splitMode: "itemized", totalAmount: 385, description: "شام – نایب", expenseDate: "2025-09-28" });
    expect(voucher.shares).toEqual([
      { personId: "a", share: 220 },
      { personId: "b", share: 165 }
    ]);
    expect(voucher.payers).toEqual([{ personId: "t", amount: 385 }]);
    expect(voucher.itemizedSnapshot?.sessionId).toBe(session.id);
    expect(voucher.itemizedSnapshot?.people[0].items[0]).toMatchObject({ name: "کوبیده", quantity: 2, unitPrice: 100, amount: 200 });
    expect(voucher.itemizedSnapshot?.people[0].extras[0]).toMatchObject({ label: "مالیات ۱۰٪", share: 20 });

    const finalized = await db.orderSessions.get(session.id);
    expect(finalized?.status).toBe("finalized");
    expect(finalized?.voucherId).toBe(voucher.id);
    expect(await db.vouchers.count()).toBe(1);
    const ops = await db.operations.where("entityId").equals(session.id).toArray();
    expect(ops.some((o) => o.type === "finalize")).toBe(true);
  });

  it("refuses to finalize twice and makes the finalized session read-only", async () => {
    const { session } = await pricedSession();
    await orderSessionsRepository.finalize(session.id);
    await expect(orderSessionsRepository.finalize(session.id)).rejects.toBeInstanceOf(FinalizeBlockedError);
    expect(await db.vouchers.count()).toBe(1);
    await expect(orderSessionsRepository.addLine(session.id, { personId: "a", itemName: "x", quantity: 1 })).rejects.toThrow();
    await expect(orderSessionsRepository.transition(session.id, "cancelled", "x")).rejects.toThrow();
  });

  it("blocks finalize while the bill total differs, and works after the difference is allocated", async () => {
    const { session } = await pricedSession(400);
    const error = await orderSessionsRepository.finalize(session.id).catch((e) => e);
    expect(error).toBeInstanceOf(FinalizeBlockedError);
    expect((error as FinalizeBlockedError).reasons.join(" ")).toContain("اختلاف");
    expect(await db.vouchers.count()).toBe(0);
    expect((await db.orderSessions.get(session.id))?.status).toBe("pricing");

    await orderSessionsRepository.setDifferenceExtra(session.id, 15, "equal");
    const voucher = await orderSessionsRepository.finalize(session.id);
    expect(voucher.totalAmount).toBe(400);
    expect(voucher.shares.reduce((s, x) => s + x.share, 0)).toBe(400);
  });

  it("blocks finalize while an item is unpriced", async () => {
    const { session } = await pricedSession();
    await orderSessionsRepository.addLine(session.id, { personId: "a", itemName: "دوغ", quantity: 1 });
    await expect(orderSessionsRepository.finalize(session.id)).rejects.toBeInstanceOf(FinalizeBlockedError);
  });

  it("recomputes multi-payer amounts from the bill total", async () => {
    const { session } = await pricedSession();
    await orderSessionsRepository.update(session.id, {
      payers: [{ personId: "t", amount: 1 }, { personId: "a", amount: 1 }],
      payerSplitMode: "equal"
    });
    const voucher = await orderSessionsRepository.finalize(session.id);
    expect(voucher.payers.map((p) => p.amount)).toEqual([193, 192]);
    expect(voucher.payerSplitMode).toBe("equal");
  });

  it("is blocked when not in the pricing status", async () => {
    const { session } = await openedSession();
    await expect(orderSessionsRepository.finalize(session.id)).rejects.toBeInstanceOf(FinalizeBlockedError);
  });
});

describe("closed events make sessions read-only", () => {
  it("rejects every write once the event is closed, and allows them again after a reopen", async () => {
    const { event, session } = await openedSession();
    const line = await orderSessionsRepository.addLine(session.id, { personId: "a", itemName: "کوبیده", quantity: 1 });
    const item = await orderSessionsRepository.addMenuItem(session.id, { name: "دوغ" });
    await eventsRepository.close(event.id);

    await expect(orderSessionsRepository.create({ eventId: event.id, title: "ناهار", scheduledAt: "2025-09-29T12:00:00.000Z" })).rejects.toThrow("پایان");
    await expect(orderSessionsRepository.update(session.id, { title: "x" })).rejects.toThrow("پایان");
    await expect(orderSessionsRepository.transition(session.id, "locked")).rejects.toThrow("پایان");
    await expect(orderSessionsRepository.addLine(session.id, { personId: "a", itemName: "x", quantity: 1 })).rejects.toThrow("پایان");
    await expect(orderSessionsRepository.updateLine(line.id, { quantity: 2 })).rejects.toThrow("پایان");
    await expect(orderSessionsRepository.removeLine(line.id)).rejects.toThrow("پایان");
    await expect(orderSessionsRepository.addMenuItem(session.id, { name: "x" })).rejects.toThrow("پایان");
    await expect(orderSessionsRepository.updateMenuItem(item.id, { name: "y" })).rejects.toThrow("پایان");
    await expect(orderSessionsRepository.removeMenuItem(item.id)).rejects.toThrow("پایان");
    await expect(orderSessionsRepository.setPersonTotal(session.id, "a", 5)).rejects.toThrow("پایان");
    await expect(orderSessionsRepository.addExtra(session.id, { kind: "tip", label: "انعام", mode: "amount", value: 5, allocation: "equal" })).rejects.toThrow("پایان");
    await expect(orderSessionsRepository.applyBulkPrice(session.id, "کوبیده", 10)).rejects.toThrow("پایان");
    await expect(orderSessionsRepository.finalize(session.id)).rejects.toThrow();

    await eventsRepository.reopen(event.id, "اصلاح");
    await expect(orderSessionsRepository.update(session.id, { title: "x" })).resolves.toBeUndefined();
  });
});

describe("permanent delete of an event", () => {
  it("removes its sessions and everything under them", async () => {
    const { event, session } = await openedSession();
    await orderSessionsRepository.addLine(session.id, { personId: "a", itemName: "کوبیده", quantity: 1 });
    await orderSessionsRepository.addMenuItem(session.id, { name: "دوغ" });
    await orderSessionsRepository.setPersonTotal(session.id, "a", 5);
    await orderSessionsRepository.addExtra(session.id, { kind: "tip", label: "انعام", mode: "amount", value: 5, allocation: "equal" });
    await eventsRepository.close(event.id);
    await eventsRepository.moveToTrash(event.id);
    await eventsRepository.permanentlyDelete(event.id);
    expect(await db.orderSessions.count()).toBe(0);
    expect(await db.orderLines.count()).toBe(0);
    expect(await db.sessionMenuItems.count()).toBe(0);
    expect(await db.orderPersonTotals.count()).toBe(0);
    expect(await db.sessionExtras.count()).toBe(0);
  });
});
