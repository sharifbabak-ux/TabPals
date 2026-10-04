import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { eventMembersRepository } from "../repositories/eventMembersRepository";
import { eventsRepository } from "../repositories/eventsRepository";
import { groupsRepository } from "../repositories/groupsRepository";
import { personsRepository } from "../repositories/personsRepository";
import { statementsRepository } from "../repositories/statementsRepository";
import { vouchersRepository } from "../repositories/vouchersRepository";
import type { OnlineLink, OnlineRole } from "../types";
import { OnlinePermissionError } from "./outboxHook";

const CARD = "6037-9912-3456-7802";
const SECRETS = ["6037991234567802", "09121234567", "بانک ملی ایران", "IR"];
const PLAIN_SECRETS = ["6037991234567802", "09121234567", "بانک ملی ایران"];

async function resetAll() {
  for (const table of db.tables) if (table.name !== "messageTemplates") await table.clear();
}

async function goOnlineAs(eventId: string, roles: OnlineRole[], status: OnlineLink["status"] = "online") {
  await db.onlineLinks.put({ localEventId: eventId, serverEventId: eventId, memberId: "t1", roles, deviceToken: "tok", lastSeq: 0, status, createdAt: new Date().toISOString() });
}

beforeEach(resetAll);

async function setup() {
  const treasurer = await personsRepository.create({ firstName: "علی", lastName: "رضایی", phone: "09121234567", cardNumber: CARD, bankName: "بانک ملی ایران" });
  const sara = await personsRepository.create({ firstName: "سارا", lastName: "احمدی" });
  const event = await eventsRepository.create({ title: "سفر شمال", treasurerPersonId: treasurer.id });
  await eventMembersRepository.addMembers(event.id, [treasurer.id, sara.id]);
  return { treasurer, sara, event };
}

describe("outbox: local writes in an online event", () => {
  it("queues sanitized ops (no bank/phone data) and never queues anything for offline events", async () => {
    const { treasurer, sara, event } = await setup();
    const other = await eventsRepository.create({ title: "آفلاین" });
    expect(await db.outbox.count()).toBe(0);

    await goOnlineAs(event.id, ["admin", "treasurer"]);
    await vouchersRepository.createExpense({ eventId: event.id, expenseDate: "2026-01-01", description: "شام", totalAmount: 100, payers: [{ personId: treasurer.id, amount: 100 }], split: { mode: "equal_all" } });
    await eventsRepository.update(other.id, { title: "هنوز آفلاین" });

    const rows = await db.outbox.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].localEventId).toBe(event.id);
    expect(rows[0].op.entity).toBe("vouchers");
    expect(rows[0].op.type).toBe("create");
    // create ops carry the complete record (incl. fields not in the audit-log diff)
    expect(rows[0].op.changes.recordedAt?.after).toBeTruthy();
    expect(rows[0].op.changes.eventId.after).toBe(event.id);

    // adding a member also ships that person (sanitized) and their memberProfile before the membership
    const newcomer = await personsRepository.create({ firstName: "رضا", lastName: "کریمی", phone: "09121234567", cardNumber: CARD, bankName: "بانک ملی ایران" });
    await eventMembersRepository.addMember(event.id, newcomer.id);
    const after = (await db.outbox.toArray()).slice(1);
    expect(after.map((r) => r.op.entity)).toEqual(["persons", "memberProfile", "eventMembers"]);
    expect(Object.keys(after[0].op.changes).sort()).toEqual(["archived", "firstName", "lastName"]);
    expect(after[1].op.entityId).toBe(newcomer.id);
    expect(Object.keys(after[1].op.changes).sort()).toEqual(["bankName", "cardNumber", "phone"]);

    // editing only a private person field is a memberProfile op (never a persons op)
    const before = await db.outbox.count();
    await personsRepository.update(sara.id, { phone: "09123334444" });
    const edit = (await db.outbox.toArray()).slice(before);
    expect(edit.map((r) => r.op.entity)).toEqual(["memberProfile"]);
    expect(edit[0].op.entityId).toBe(sara.id);
    // renaming is a persons op
    await personsRepository.update(sara.id, { firstName: "ساراجان" });
    expect((await db.outbox.toArray()).slice(before + 1).map((r) => r.op.entity)).toEqual(["persons"]);

    // groups are device-local
    const size = await db.outbox.count();
    await groupsRepository.create({ name: "خانواده", personIds: [sara.id] });
    expect(await db.outbox.count()).toBe(size);

    // persons ops (and every non-profile op) never hold private data; profile ops are encrypted when pushed
    const rowsNow = await db.outbox.toArray();
    for (const row of rowsNow.filter((r) => r.op.entity !== "memberProfile")) {
      for (const secret of PLAIN_SECRETS) expect(JSON.stringify(row.op)).not.toContain(secret);
    }
  });

  it("treasurer bank fields are queued on the events entity (encrypted when pushed); photos and notes never are", async () => {
    const { event } = await setup();
    await goOnlineAs(event.id, ["admin"]);
    await eventsRepository.update(event.id, { treasurerCardNumber: CARD, treasurerBankName: "بانک ملی ایران", description: "توضیح" });
    const rows = await db.outbox.toArray();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0].op.changes).sort()).toEqual(["description", "treasurerBankName", "treasurerCardNumber"]);
    await eventsRepository.update(event.id, { treasurerBankName: "بانک دیگر" });
    expect(await db.outbox.count()).toBe(2);
  });

  it("a member may write only their OWN member profile", async () => {
    const { event, sara, treasurer } = await setup();
    await db.onlineLinks.put({ localEventId: event.id, serverEventId: event.id, memberId: sara.id, roles: ["member"], deviceToken: "tok", lastSeq: 0, status: "online", createdAt: new Date().toISOString() });
    await personsRepository.update(sara.id, { cardNumber: CARD, iban: "IR820540102680020817909002" });
    const rows = await db.outbox.toArray();
    expect(rows.map((r) => [r.op.entity, r.op.entityId])).toEqual([["memberProfile", sara.id]]);
    // someone else's profile, or a ledger field of their own person, is refused and writes nothing
    await expect(personsRepository.update(treasurer.id, { phone: "09120000000" })).rejects.toBeInstanceOf(OnlinePermissionError);
    await expect(personsRepository.update(sara.id, { firstName: "هک" })).rejects.toBeInstanceOf(OnlinePermissionError);
    expect(await db.outbox.count()).toBe(1);
  });

  it("statement ops carry a scrubbed snapshot", async () => {
    const { event, treasurer, sara } = await setup();
    await eventsRepository.update(event.id, { treasurerCardNumber: CARD });
    await vouchersRepository.createExpense({ eventId: event.id, expenseDate: "2026-01-01", description: "شام", totalAmount: 100, payers: [{ personId: treasurer.id, amount: 100 }], split: { mode: "equal_all" } });
    await eventsRepository.close(event.id);
    await goOnlineAs(event.id, ["admin", "treasurer"]);
    await statementsRepository.issueForMember(event.id, sara.id);
    const stmt = (await db.outbox.toArray()).find((r) => r.op.entity === "statements" && r.op.type === "create")!;
    const snapshot = stmt.op.changes.snapshot.after as string;
    expect(JSON.parse(snapshot).member.personId).toBe(sara.id);
    for (const secret of SECRETS) expect(JSON.stringify(stmt.op)).not.toContain(secret);
    // creditors' bank details are not part of the outbound snapshot; the treasurer's own payment info is (the whole snapshot is encrypted when pushed)
    expect(snapshot).not.toMatch(/"(cardNumberGrouped|ibanGrouped|bankName|accountHolder)"/);
    expect(JSON.parse(snapshot).treasurerCardNumberGrouped).toBeTruthy();
  });
});

describe("local permission guard", () => {
  it("members are read-only for every ledger write and nothing is written", async () => {
    const { event, treasurer, sara } = await setup();
    await goOnlineAs(event.id, ["member"]);
    const opsBefore = await db.operations.count();
    const vouchersBefore = await db.vouchers.count();

    await expect(
      vouchersRepository.createExpense({ eventId: event.id, expenseDate: "2026-01-01", description: "x", totalAmount: 10, payers: [{ personId: treasurer.id, amount: 10 }], split: { mode: "equal_all" } })
    ).rejects.toBeInstanceOf(OnlinePermissionError);
    await expect(eventsRepository.update(event.id, { title: "هک" })).rejects.toBeInstanceOf(OnlinePermissionError);
    await expect(eventsRepository.close(event.id)).rejects.toBeInstanceOf(OnlinePermissionError);
    await expect(eventMembersRepository.addMember(event.id, "someone")).rejects.toBeInstanceOf(OnlinePermissionError);
    await expect(personsRepository.update(sara.id, { firstName: "هک" })).rejects.toBeInstanceOf(OnlinePermissionError);

    expect(await db.vouchers.count()).toBe(vouchersBefore);
    expect(await db.operations.count()).toBe(opsBefore);
    expect((await db.events.get(event.id))?.title).toBe("سفر شمال");
    expect((await db.persons.get(sara.id))?.firstName).toBe("سارا");
    expect(await db.outbox.count()).toBe(0);
  });

  it("device-local data (groups, templates) stays writable for members", async () => {
    const { event, sara } = await setup();
    await goOnlineAs(event.id, ["member"]);
    await expect(groupsRepository.create({ name: "گروه", personIds: [sara.id] })).resolves.toBeTruthy();
  });

  it("a role change takes effect immediately; treasurer role may write", async () => {
    const { event, treasurer } = await setup();
    await goOnlineAs(event.id, ["member"]);
    await expect(eventsRepository.update(event.id, { title: "الف" })).rejects.toBeInstanceOf(OnlinePermissionError);
    await db.onlineLinks.update(event.id, { roles: ["treasurer"] });
    await expect(eventsRepository.update(event.id, { title: "الف" })).resolves.toBeUndefined();
    expect(treasurer.id).toBeTruthy();
  });

  it("an online event cannot be permanently deleted locally; a revoked link no longer blocks or guards", async () => {
    const { event } = await setup();
    await eventsRepository.close(event.id);
    await eventsRepository.moveToTrash(event.id);
    await goOnlineAs(event.id, ["admin"]);
    await expect(eventsRepository.permanentlyDelete(event.id)).rejects.toThrow("آنلاین");
    expect(await db.events.get(event.id)).toBeTruthy();
    await db.onlineLinks.update(event.id, { status: "revoked" });
    await expect(eventsRepository.permanentlyDelete(event.id)).resolves.toBeUndefined();
  });
});
