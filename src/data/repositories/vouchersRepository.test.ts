import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { eventMembersRepository } from "./eventMembersRepository";
import { eventsRepository } from "./eventsRepository";
import { vouchersRepository } from "./vouchersRepository";

beforeEach(async () => {
  await db.events.clear();
  await db.eventMembers.clear();
  await db.vouchers.clear();
  await db.operations.clear();
});

async function createOpenEvent() {
  return eventsRepository.create({ title: "سفر شمال" });
}

async function createOpenEventWithTreasurer(treasurerPersonId = "treasurer") {
  return eventsRepository.create({ title: "سفر شمال", treasurerPersonId });
}

describe("vouchersRepository.createExpense", () => {
  it("creates an expense with an equal-all split among active members and logs a create operation", async () => {
    const event = await createOpenEvent();
    await eventMembersRepository.addMembers(event.id, ["p1", "p2", "p3"]);

    const voucher = await vouchersRepository.createExpense({
      eventId: event.id,
      expenseDate: "2025-09-28",
      description: "شام",
      totalAmount: 100,
      payers: [{ personId: "p1", amount: 100 }],
      split: { mode: "equal_all" }
    });

    expect(voucher.number).toBe(1);
    expect(voucher.shares.reduce((sum, s) => sum + s.share, 0)).toBe(100);
    expect(voucher.participants).toHaveLength(3);
    expect(voucher.splitMode).toBe("equal");

    const ops = await db.operations.where("entityId").equals(voucher.id).toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0].entity).toBe("vouchers");
  });

  it("only splits among selected participants for equal_selected", async () => {
    const event = await createOpenEvent();
    await eventMembersRepository.addMembers(event.id, ["p1", "p2", "p3"]);

    const voucher = await vouchersRepository.createExpense({
      eventId: event.id,
      expenseDate: "2025-09-28",
      description: "تاکسی",
      totalAmount: 60,
      payers: [{ personId: "p1", amount: 60 }],
      split: { mode: "equal_selected", participantPersonIds: ["p1", "p2"] }
    });

    expect(voucher.shares).toEqual(
      expect.arrayContaining([
        { personId: "p1", share: 30 },
        { personId: "p2", share: 30 }
      ])
    );
    expect(voucher.shares).toHaveLength(2);
    expect(voucher.splitMode).toBe("equal");
  });

  it("splits by weight", async () => {
    const event = await createOpenEvent();
    const voucher = await vouchersRepository.createExpense({
      eventId: event.id,
      expenseDate: "2025-09-28",
      description: "هتل",
      totalAmount: 300,
      payers: [{ personId: "p1", amount: 300 }],
      split: {
        mode: "weight",
        weights: [
          { personId: "p1", weight: 1 },
          { personId: "p2", weight: 2 }
        ]
      }
    });

    expect(voucher.shares).toEqual([
      { personId: "p1", share: 100 },
      { personId: "p2", share: 200 }
    ]);
    expect(voucher.splitMode).toBe("weight");
  });

  it("splits by percent and rejects percents that do not total 100", async () => {
    const event = await createOpenEvent();
    const voucher = await vouchersRepository.createExpense({
      eventId: event.id,
      expenseDate: "2025-09-28",
      description: "بلیط",
      totalAmount: 1000,
      payers: [{ personId: "p1", amount: 1000 }],
      split: {
        mode: "percent",
        percents: [
          { personId: "p1", percent: 25 },
          { personId: "p2", percent: 75 }
        ]
      }
    });
    expect(voucher.shares).toEqual([
      { personId: "p1", share: 250 },
      { personId: "p2", share: 750 }
    ]);
    expect(voucher.splitMode).toBe("percent");

    await expect(
      vouchersRepository.createExpense({
        eventId: event.id,
        expenseDate: "2025-09-28",
        description: "بلیط",
        totalAmount: 1000,
        payers: [{ personId: "p1", amount: 1000 }],
        split: { mode: "percent", percents: [{ personId: "p1", percent: 50 }] }
      })
    ).rejects.toThrow();
  });

  it("uses exact amounts as shares and rejects exact amounts that do not sum to the total", async () => {
    const event = await createOpenEvent();
    const voucher = await vouchersRepository.createExpense({
      eventId: event.id,
      expenseDate: "2025-09-28",
      description: "خرید",
      totalAmount: 100,
      payers: [{ personId: "p1", amount: 100 }],
      split: {
        mode: "exact",
        amounts: [
          { personId: "p1", amount: 40 },
          { personId: "p2", amount: 60 }
        ]
      }
    });
    expect(voucher.shares).toEqual([
      { personId: "p1", share: 40 },
      { personId: "p2", share: 60 }
    ]);
    expect(voucher.splitMode).toBe("exact");

    await expect(
      vouchersRepository.createExpense({
        eventId: event.id,
        expenseDate: "2025-09-28",
        description: "خرید",
        totalAmount: 100,
        payers: [{ personId: "p1", amount: 100 }],
        split: { mode: "exact", amounts: [{ personId: "p1", amount: 40 }] }
      })
    ).rejects.toThrow();
  });

  it("rejects when payer amounts do not sum to the total", async () => {
    const event = await createOpenEvent();
    await expect(
      vouchersRepository.createExpense({
        eventId: event.id,
        expenseDate: "2025-09-28",
        description: "شام",
        totalAmount: 100,
        payers: [{ personId: "p1", amount: 40 }],
        split: { mode: "equal_all" }
      })
    ).rejects.toThrow();
  });

  it("assigns sequential, never-reused numbers per event", async () => {
    const event = await createOpenEvent();
    await eventMembersRepository.addMembers(event.id, ["p1"]);

    const v1 = await vouchersRepository.createExpense({
      eventId: event.id,
      expenseDate: "2025-09-28",
      description: "a",
      totalAmount: 10,
      payers: [{ personId: "p1", amount: 10 }],
      split: { mode: "equal_all" }
    });
    const v2 = await vouchersRepository.createExpense({
      eventId: event.id,
      expenseDate: "2025-09-28",
      description: "b",
      totalAmount: 10,
      payers: [{ personId: "p1", amount: 10 }],
      split: { mode: "equal_all" }
    });

    expect(v1.number).toBe(1);
    expect(v2.number).toBe(2);
  });

  it("blocks creating a voucher in a manually closed event", async () => {
    const event = await createOpenEvent();
    await eventMembersRepository.addMembers(event.id, ["p1"]);
    await eventsRepository.close(event.id);

    await expect(
      vouchersRepository.createExpense({
        eventId: event.id,
        expenseDate: "2025-09-28",
        description: "شام",
        totalAmount: 10,
        payers: [{ personId: "p1", amount: 10 }],
        split: { mode: "equal_all" }
      })
    ).rejects.toThrow();
  });
});

describe("vouchersRepository.createContribution / createSettlement", () => {
  it("creates a contribution voucher to the event's treasurer, with no payers/participants", async () => {
    const event = await createOpenEventWithTreasurer("treasurer");
    const voucher = await vouchersRepository.createContribution({
      eventId: event.id,
      expenseDate: "2025-09-28",
      description: "واریز به خزانه‌دار",
      totalAmount: 500,
      fromPersonId: "p1"
    });

    expect(voucher.type).toBe("contribution");
    expect(voucher.fromPersonId).toBe("p1");
    expect(voucher.toPersonId).toBe("treasurer");
    expect(voucher.payers).toEqual([]);
    expect(voucher.participants).toEqual([]);
  });

  it("rejects a contribution when the event has no treasurer set", async () => {
    const event = await createOpenEvent();
    await expect(
      vouchersRepository.createContribution({
        eventId: event.id,
        expenseDate: "2025-09-28",
        description: "واریز",
        totalAmount: 100,
        fromPersonId: "p1"
      })
    ).rejects.toThrow();
  });

  it("creates a settlement voucher", async () => {
    const event = await createOpenEvent();
    const voucher = await vouchersRepository.createSettlement({
      eventId: event.id,
      expenseDate: "2025-09-28",
      description: "تسویه",
      totalAmount: 100,
      fromPersonId: "a",
      toPersonId: "b"
    });
    expect(voucher.type).toBe("settlement");
  });

  it("rejects a transfer to oneself", async () => {
    const event = await createOpenEvent();
    await expect(
      vouchersRepository.createSettlement({
        eventId: event.id,
        expenseDate: "2025-09-28",
        description: "تسویه",
        totalAmount: 100,
        fromPersonId: "a",
        toPersonId: "a"
      })
    ).rejects.toThrow();
  });

  it("blocks creating a transfer voucher in a closed event", async () => {
    const event = await createOpenEventWithTreasurer("b");
    await eventsRepository.close(event.id);
    await expect(
      vouchersRepository.createContribution({
        eventId: event.id,
        expenseDate: "2025-09-28",
        description: "واریز",
        totalAmount: 100,
        fromPersonId: "a"
      })
    ).rejects.toThrow();
  });

  it("shares numbering with expense vouchers in the same event", async () => {
    const event = await createOpenEvent();
    await eventMembersRepository.addMembers(event.id, ["p1"]);
    const expense = await vouchersRepository.createExpense({
      eventId: event.id,
      expenseDate: "2025-09-28",
      description: "a",
      totalAmount: 10,
      payers: [{ personId: "p1", amount: 10 }],
      split: { mode: "equal_all" }
    });
    const settlement = await vouchersRepository.createSettlement({
      eventId: event.id,
      expenseDate: "2025-09-28",
      description: "تسویه",
      totalAmount: 10,
      fromPersonId: "a",
      toPersonId: "b"
    });
    expect(settlement.number).toBe(expense.number + 1);
  });
});
