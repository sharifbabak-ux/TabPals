import { beforeEach, describe, expect, it } from "vitest";
import { computeVerificationCode } from "@/domain/verificationCode";
import { db } from "../db";
import { eventMembersRepository } from "./eventMembersRepository";
import { eventsRepository } from "./eventsRepository";
import { personsRepository } from "./personsRepository";
import { statementsRepository } from "./statementsRepository";
import { vouchersRepository } from "./vouchersRepository";

beforeEach(async () => {
  await db.events.clear();
  await db.eventMembers.clear();
  await db.persons.clear();
  await db.vouchers.clear();
  await db.statements.clear();
  await db.operations.clear();
});

async function createClosedEventWithData() {
  const treasurer = await personsRepository.create({ name: "ترانه" });
  const a = await personsRepository.create({ name: "آرش" });
  const b = await personsRepository.create({ name: "بهار" });
  const event = await eventsRepository.create({ title: "سفر شمال", treasurerPersonId: treasurer.id });
  await eventMembersRepository.addMembers(event.id, [treasurer.id, a.id, b.id]);
  await vouchersRepository.createExpense({
    eventId: event.id,
    expenseDate: "2025-01-01",
    description: "شام",
    totalAmount: 3000,
    payers: [{ personId: treasurer.id, amount: 3000 }],
    split: { mode: "equal_all" }
  });
  await eventsRepository.close(event.id);
  return { event, treasurer, a, b };
}

describe("statementsRepository — issue guards", () => {
  it("refuses to issue on an open event", async () => {
    const treasurer = await personsRepository.create({ name: "ترانه" });
    const event = await eventsRepository.create({ title: "سفر", treasurerPersonId: treasurer.id });
    await eventMembersRepository.addMember(event.id, treasurer.id);
    await expect(statementsRepository.issueForMember(event.id, treasurer.id)).rejects.toThrow();
  });

  it("refuses to issue on a closed event with no treasurer", async () => {
    const event = await eventsRepository.create({ title: "سفر" });
    await eventMembersRepository.addMember(event.id, "p1");
    await eventsRepository.close(event.id);
    await expect(statementsRepository.issueForMember(event.id, "p1")).rejects.toThrow();
  });
});

describe("statementsRepository.issueForMember", () => {
  it("issues a treasurer-kind statement for the treasurer and a member-kind statement for everyone else", async () => {
    const { event, treasurer, a } = await createClosedEventWithData();

    const treasurerStatement = await statementsRepository.issueForMember(event.id, treasurer.id);
    expect(treasurerStatement.kind).toBe("treasurer");
    expect(treasurerStatement.personId).toBe(treasurer.id);
    expect(treasurerStatement.status).toBe("current");
    expect(treasurerStatement.issueVersion).toBe(1);
    expect(treasurerStatement.templateId).not.toBeNull();
    expect(treasurerStatement.closingText.length).toBeGreaterThan(0);

    const memberStatement = await statementsRepository.issueForMember(event.id, a.id);
    expect(memberStatement.kind).toBe("member");
    expect(memberStatement.number).toBe(2);
  });

  it("assigns sequential, never-reused numbers across all statement kinds in the event", async () => {
    const { event, treasurer, a, b } = await createClosedEventWithData();
    const s1 = await statementsRepository.issueForMember(event.id, treasurer.id);
    const s2 = await statementsRepository.issueForMember(event.id, a.id);
    const s3 = await statementsRepository.issueComprehensiveReport(event.id);
    const s4 = await statementsRepository.issueForMember(event.id, b.id);
    expect([s1.number, s2.number, s3.number, s4.number]).toEqual([1, 2, 3, 4]);
  });

  it("re-issuing marks the prior current statement outdated and bumps issueVersion", async () => {
    const { event, a } = await createClosedEventWithData();
    const v1 = await statementsRepository.issueForMember(event.id, a.id);
    const v2 = await statementsRepository.issueForMember(event.id, a.id);

    expect(v2.issueVersion).toBe(2);
    const reloadedV1 = await db.statements.get(v1.id);
    expect(reloadedV1?.status).toBe("outdated");
    expect(v2.status).toBe("current");
  });

  it("stores a verification code that matches recomputing from the stored snapshot", async () => {
    const { event, a } = await createClosedEventWithData();
    const statement = await statementsRepository.issueForMember(event.id, a.id);
    const recomputed = await computeVerificationCode(statement.snapshot);
    expect(recomputed).toBe(statement.verificationCode);
    expect(statement.verificationCode).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
  });
});

describe("statementsRepository.issueForAllMembers", () => {
  it("issues one statement per active member", async () => {
    const { event, treasurer, a, b } = await createClosedEventWithData();
    const statements = await statementsRepository.issueForAllMembers(event.id);
    expect(statements).toHaveLength(3);
    expect(statements.map((s) => s.personId).sort()).toEqual([a.id, b.id, treasurer.id].sort());
    expect(statements.find((s) => s.personId === treasurer.id)?.kind).toBe("treasurer");
  });
});

describe("statementsRepository.issueComprehensiveReport", () => {
  it("issues a comprehensive statement with no personId/template/closing text", async () => {
    const { event } = await createClosedEventWithData();
    const statement = await statementsRepository.issueComprehensiveReport(event.id);
    expect(statement.kind).toBe("comprehensive");
    expect(statement.personId).toBeNull();
    expect(statement.templateId).toBeNull();
    expect(statement.closingText).toBe("");
  });
});

describe("eventsRepository.reopen marks statements outdated", () => {
  it("flips every current statement of the event to outdated", async () => {
    const { event, treasurer, a } = await createClosedEventWithData();
    const s1 = await statementsRepository.issueForMember(event.id, treasurer.id);
    const s2 = await statementsRepository.issueForMember(event.id, a.id);

    await eventsRepository.reopen(event.id, "اصلاح یک هزینه");

    expect((await db.statements.get(s1.id))?.status).toBe("outdated");
    expect((await db.statements.get(s2.id))?.status).toBe("outdated");
  });
});
