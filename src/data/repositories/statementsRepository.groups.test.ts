import { beforeEach, describe, expect, it } from "vitest";
import type { GroupStatementData } from "@/domain/groupStatement";
import { db } from "../db";
import { eventMembersRepository } from "./eventMembersRepository";
import { eventsRepository } from "./eventsRepository";
import { personsRepository } from "./personsRepository";
import { settlementGroupsRepository } from "./settlementGroupsRepository";
import { statementsRepository } from "./statementsRepository";
import { vouchersRepository } from "./vouchersRepository";

beforeEach(async () => {
  // messageTemplates are seeded defaults the statements need, so they are not cleared.
  for (const table of db.tables) if (table.name !== "messageTemplates") await table.clear();
});

/** Adds a payment to a finished event: reopen, record, close again. */
async function recordAfterClose(eventId: string, from: string, to: string, totalAmount: number) {
  await eventsRepository.reopen(eventId, "تست");
  await vouchersRepository.createSettlement({ eventId, expenseDate: "2025-01-02", description: "نمونه", totalAmount, fromPersonId: from, toPersonId: to });
  await eventsRepository.close(eventId);
}

/** Closed event: treasurer ت (+50), الف (+400), ب (−450), ج (0), with a group {الف, ب}. Fake data only. */
async function setup() {
  const ids: Record<string, string> = {};
  for (const n of ["ت", "الف", "ب", "ج"]) ids[n] = (await personsRepository.create({ firstName: n, lastName: "نمونه", phone: n === "ب" ? "09120000000" : undefined })).id;
  const event = await eventsRepository.create({ title: "سفر نمونه", treasurerPersonId: ids["ت"] });
  await eventMembersRepository.addMembers(event.id, Object.values(ids));
  const pay = (from: string, to: string, totalAmount: number) =>
    vouchersRepository.createSettlement({ eventId: event.id, expenseDate: "2025-01-01", description: "نمونه", totalAmount, fromPersonId: ids[from], toPersonId: ids[to] });
  await pay("الف", "ب", 400);
  await pay("ت", "ب", 50);
  const group = await settlementGroupsRepository.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["ب"] });
  await eventsRepository.close(event.id);
  return { event, ids, group };
}

const parse = (snapshot: string) => JSON.parse(snapshot) as GroupStatementData;

describe("statementsRepository — group statements (SG-5)", () => {
  it("issues a group statement keyed by the group id, with version, short code and the right numbers", async () => {
    const { event, group } = await setup();
    const st = await statementsRepository.issueForGroup(event.id, group.id);
    expect(st).toMatchObject({ kind: "group", personId: group.id, issueVersion: 1, status: "current", number: 1 });
    expect(st.verificationCode).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    const data = parse(st.snapshot);
    expect(data.groupBalance).toBe(-450 + 400);
    expect(data.internalCancelled).toBe(400);
    expect(st.closingText).toBe(data.closingText);

    const again = await statementsRepository.issueForGroup(event.id, group.id);
    expect(again.issueVersion).toBe(2);
    expect(again.number).toBe(2);
    expect((await statementsRepository.get(st.id))?.status).toBe("outdated");
  });

  it("includes archived members in the sum", async () => {
    const { event, ids, group } = await setup();
    await db.eventMembers.where("eventId").equals(event.id).filter((m) => m.personId === ids["ب"]).modify({ active: false });
    const st = await statementsRepository.issueForGroup(event.id, group.id);
    expect(parse(st.snapshot).groupBalance).toBe(-50);
    expect(parse(st.snapshot).members.find((m) => m.personId === ids["ب"])?.active).toBe(false);
  });

  it("issueForAllGroups issues every valid group; individual statements are unaffected", async () => {
    const { event, ids } = await setup();
    await settlementGroupsRepository.create({ eventId: event.id, name: "دیگر", memberIds: [ids["ج"], ids["ت"]], representativeId: ids["ت"] });
    const all = await statementsRepository.issueForAllGroups(event.id);
    expect(all.map((s) => s.kind)).toEqual(["group", "group"]);
    const member = await statementsRepository.issueForMember(event.id, ids["الف"]);
    expect(member.kind).toBe("member");
    expect(member.personId).toBe(ids["الف"]);
    expect(member.issueVersion).toBe(1);
  });

  it("refuses an open event, and no valid groups", async () => {
    const { event, group } = await setup();
    await eventsRepository.reopen(event.id, "تست");
    await expect(statementsRepository.issueForGroup(event.id, group.id)).rejects.toThrow();
    await eventsRepository.close(event.id);
    await settlementGroupsRepository.delete(group.id);
    await expect(statementsRepository.issueForAllGroups(event.id)).rejects.toThrow();
  });

  it("refuses an invalid group with a Persian reason (stored data forced invalid)", async () => {
    const { event, group } = await setup();
    await db.settlementGroups.update(group.id, { name: "" });
    const candidates = await statementsRepository.listGroupCandidates(event.id);
    expect(candidates.valid).toEqual([]);
    expect(candidates.invalid[0].reasons).toEqual(["empty-name"]);
    await expect(statementsRepository.issueForGroup(event.id, group.id)).rejects.toThrow(/نام گروه/);
    expect(await db.statements.count()).toBe(0);
  });

  it("stale detection: balance, membership, representative, name and treasurer changes", async () => {
    const { event, ids, group } = await setup();
    const st = await statementsRepository.issueForGroup(event.id, group.id);
    const stale = () => statementsRepository.staleGroupStatementIds(event.id);
    expect(await stale()).toEqual([]);

    // an unrelated person's balance does not matter
    await recordAfterClose(event.id, ids["ج"], ids["ت"], 10);
    expect(await stale()).toEqual([]);

    // reopening already marks it outdated in storage (the old rule); the stale check below covers changes that do not reopen
    await recordAfterClose(event.id, ids["ج"], ids["الف"], 10);
    expect((await statementsRepository.get(st.id))?.status).toBe("outdated");
    expect(await stale()).toEqual([]);

    // a member's balance changed behind a current statement: stale
    const current = await statementsRepository.issueForGroup(event.id, group.id);
    expect(await stale()).toEqual([]);
    const payment = (await db.vouchers.where("eventId").equals(event.id).toArray()).find((v) => v.fromPersonId === ids["الف"] && v.toPersonId === ids["ب"])!;
    await db.vouchers.update(payment.id, { totalAmount: payment.totalAmount + 5 });
    expect(await stale()).toEqual([current.id]);
    await db.vouchers.update(payment.id, { totalAmount: payment.totalAmount });
    expect(await stale()).toEqual([]);

    const fresh = current;
    await settlementGroupsRepository.update(group.id, { name: "نام جدید" });
    expect(await stale()).toEqual([fresh.id]);

    const fresh2 = await statementsRepository.issueForGroup(event.id, group.id);
    await settlementGroupsRepository.update(group.id, { representativeId: ids["الف"] });
    expect(await stale()).toEqual([fresh2.id]);

    const fresh3 = await statementsRepository.issueForGroup(event.id, group.id);
    await settlementGroupsRepository.update(group.id, { memberIds: [ids["الف"], ids["ب"], ids["ج"]] });
    expect(await stale()).toEqual([fresh3.id]);

    const fresh4 = await statementsRepository.issueForGroup(event.id, group.id);
    await db.events.update(event.id, { treasurerPersonId: ids["ج"] });
    expect(await stale()).toEqual([fresh4.id]);

    // group deleted → stale as well
    await db.events.update(event.id, { treasurerPersonId: ids["ت"] });
    const fresh5 = await statementsRepository.issueForGroup(event.id, group.id);
    expect(await stale()).toEqual([]);
    await settlementGroupsRepository.delete(group.id);
    expect(await stale()).toEqual([fresh5.id]);
  });

  it("an event without group statements has nothing stale", async () => {
    const { event } = await setup();
    expect(await statementsRepository.staleGroupStatementIds(event.id)).toEqual([]);
  });
});
