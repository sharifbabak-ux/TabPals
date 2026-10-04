/**
 * End-to-end encryption against the mocked server (docs/API.md): key
 * distribution, link join, wrong keys, member-profile read filtering,
 * statement snapshots, member removal and the "nothing private on the wire"
 * guard. Two devices = two Dexie databases.
 */
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { createMockApi } from "@/test/mockApiServer";
import { parseInviteKey } from "@/domain/inviteLink";
import { db, TabPalDB } from "../db";
import { exportPublicJwk, generateDeviceKeyPair, generateEventKey, isEncrypted, wrapEventKey } from "../crypto";
import { eventMembersRepository } from "../repositories/eventMembersRepository";
import { eventsRepository } from "../repositories/eventsRepository";
import { personsRepository } from "../repositories/personsRepository";
import { statementsRepository } from "../repositories/statementsRepository";
import { vouchersRepository } from "../repositories/vouchersRepository";
import { readOnlineNotice } from "./localCleanup";
import { createOnlineService } from "./onlineService";
import { SyncEngine } from "./syncEngine";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

let mock: ReturnType<typeof createMockApi>;
const engines: SyncEngine[] = [];
let memberDb: TabPalDB;
let thirdDb: TabPalDB;

const CARD = "6037991234567802";
const IBAN = "IR820540102680020817909002";
const PHONE = "09121234567";
const SARA_CARD = "5859831012343728";
const SARA_PHONE = "09351112233";
const BANK = "بانک ملی ایران";

function makeDevice(database: TabPalDB, label: string) {
  const engine = new SyncEngine({ db: database, socketFactory: mock.socketFactory, serveDelayMs: () => 0 });
  engines.push(engine);
  const service = createOnlineService({ db: database, engine, deviceLabel: () => label });
  return { engine, service, db: database };
}

async function until(condition: () => Promise<boolean> | boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("condition not met in time");
}

beforeEach(async () => {
  mock = createMockApi();
  server.resetHandlers(...mock.handlers);
  for (const table of db.tables) if (table.name !== "messageTemplates") await table.clear();
  await Dexie.delete("member-device");
  await Dexie.delete("third-device");
  memberDb = new TabPalDB("member-device");
  thirdDb = new TabPalDB("third-device");
  await memberDb.open();
  await thirdDb.open();
});

afterEach(async () => {
  const stopped = engines.splice(0);
  stopped.forEach((e) => e.stop());
  await Promise.all(stopped.map((e) => e.idle()));
  memberDb.close();
  thirdDb.close();
  await Dexie.delete("member-device");
  await Dexie.delete("third-device");
});

async function seed() {
  const treasurer = await personsRepository.create({ firstName: "علی", lastName: "رضایی", phone: PHONE, cardNumber: CARD, iban: IBAN, bankName: BANK, accountHolder: "حساب مشترک رضایی" });
  const sara = await personsRepository.create({ firstName: "سارا", lastName: "احمدی", cardNumber: SARA_CARD, phone: SARA_PHONE, bankName: "بانک ملت" });
  const reza = await personsRepository.create({ firstName: "رضا", lastName: "کریمی" });
  const event = await eventsRepository.create({ title: "سفر شمال", treasurerPersonId: treasurer.id, treasurerCardNumber: CARD, treasurerBankName: BANK });
  await eventMembersRepository.addMembers(event.id, [treasurer.id, sara.id, reza.id]);
  await vouchersRepository.createExpense({ eventId: event.id, expenseDate: "2026-01-01", description: "شام", totalAmount: 300, payers: [{ personId: treasurer.id, amount: 300 }], split: { mode: "equal_all" } });
  return { treasurer, sara, reza, event };
}

async function goOnline() {
  const seeded = await seed();
  const admin = makeDevice(db, "Android Chrome");
  await admin.engine.start();
  await admin.service.goOnline(seeded.event.id);
  await until(async () => (await db.onlineLinks.get(seeded.event.id))?.status === "online");
  return { ...seeded, admin };
}

describe("nothing private on the wire", () => {
  it("a full go-online + edit scenario never serializes a plaintext card, IBAN, phone or bank detail", async () => {
    const { event, sara, reza, admin } = await goOnline();
    // edits after going online: member bank info, phone changes, treasurer fields, a new member with bank data, statements, send log
    await personsRepository.update(reza.id, { cardNumber: "6104337812345674", phone: "09124445566", iban: "IR820540102680020817909002", accountHolder: "حساب کریمی‌نژاد" });
    await personsRepository.update(sara.id, { phone: "09350000000" });
    await eventsRepository.update(event.id, { treasurerIban: IBAN, treasurerAccountHolder: "حساب مشترک رضایی" });
    const late = await personsRepository.create({ firstName: "نگار", lastName: "صادقی", cardNumber: "6219861012345673", phone: "09127778899", bankName: "بانک سامان" });
    await eventMembersRepository.addMember(event.id, late.id);
    await eventsRepository.close(event.id);
    const statements = await statementsRepository.issueForAllMembers(event.id);
    await statementsRepository.logSend(statements[0].id, "whatsapp", sara.id);
    await admin.engine.syncNow(event.id);
    await until(async () => (await db.outbox.count()) === 0);

    expect(mock.wire.length).toBeGreaterThan(10);
    const wire = mock.wire.join("\n") + JSON.stringify(mock.log);
    for (const secret of [CARD, IBAN, PHONE, SARA_CARD, SARA_PHONE, "6104337812345674", "09124445566", "09350000000", "6219861012345673", "09127778899", BANK, "بانک ملت", "بانک سامان", "حساب مشترک رضایی", "حساب کریمی‌نژاد"]) {
      expect(wire).not.toContain(secret);
    }
    // patterns, not just known values
    expect(wire).not.toMatch(/(?<![\d])\d{16}(?![\d])/);
    expect(wire).not.toMatch(/IR\d{24}/);
    expect(wire).not.toMatch(/(?<!\d)09\d{9}(?!\d)/);
    expect(wire).not.toMatch(/\d{4} \d{4} \d{4} \d{4}/);
    // and the sensitive ops did go out — encrypted
    const ops = mock.events.get(event.id)!.ops.map((o) => o.op);
    const profiles = ops.filter((o) => o.entity === "memberProfile");
    expect(profiles.length).toBeGreaterThanOrEqual(4);
    for (const op of profiles) for (const change of Object.values(op.changes)) expect(isEncrypted(change.after)).toBe(true);
    const keyCheck = ops.find((o) => o.entity === "events" && o.changes.keyCheck);
    expect(isEncrypted(keyCheck!.changes.keyCheck.after)).toBe(true);
    for (const op of ops.filter((o) => o.entity === "statements" && o.changes.snapshot)) expect(isEncrypted(op.changes.snapshot.after)).toBe(true);
    const logSend = ops.find((o) => o.type === "logSend")!;
    expect(logSend.changes.targetMemberId.after).toBe(sara.id);
    expect(logSend.entityId).toBe(statements[0].id);
    expect(logSend.changes.channel.after).toBe("whatsapp");
    // persons ops never carry the private fields
    for (const op of ops.filter((o) => o.entity === "persons")) expect(Object.keys(op.changes).sort()).toEqual(["archived", "firstName", "lastName"]);
  });
});

describe("key distribution", () => {
  it("short-code join: the member receives the event key through an envelope, verifies it and decrypts the treasurer's payment info", async () => {
    const { event, sara, admin } = await goOnline();
    const member = makeDevice(memberDb, "iPhone Safari");
    await member.engine.start();
    const invite = await admin.service.createInvite(event.id, sara.id);
    await member.service.joinWithInvite({ shortCode: invite.shortCode });

    await until(async () => Boolean((await memberDb.eventKeys.get(event.id))?.verified));
    expect(mock.log.some((l) => l.path === "key-envelopes")).toBe(true);
    await until(async () => (await memberDb.events.get(event.id))?.treasurerCardNumber === CARD);
    expect((await memberDb.events.get(event.id))?.treasurerBankName).toBe(BANK);
    // the key itself never crossed the server in the clear
    expect(JSON.stringify(mock.log)).not.toMatch(/"k":/);
    expect((await memberDb.onlineLinks.get(event.id))?.keyError ?? null).toBeNull();
  });

  it("link join: the key from the URL fragment is imported at once and verified after the first catch-up", async () => {
    const { event, sara, admin } = await goOnline();
    const member = makeDevice(memberDb, "iPhone Safari");
    await member.engine.start();
    const invite = await admin.service.createInvite(event.id, sara.id);
    const keyText = parseInviteKey(invite.url.slice(invite.url.indexOf("#") + 1).replace(/^\//, "/"))!;
    expect(keyText).toBeTruthy();
    expect(invite.url).toContain("#/join?t=");

    await member.service.joinWithInvite({ inviteToken: invite.inviteToken, eventKey: keyText });
    // no envelope needed: the key is present and verified straight after joining
    const row = await memberDb.eventKeys.get(event.id);
    expect(row?.verified).toBe(true);
    await until(async () => (await memberDb.events.get(event.id))?.treasurerCardNumber === CARD);
    expect(mock.log.some((l) => l.path === "key-envelopes")).toBe(true); // the admin still answered the key request, harmlessly
  });

  it("a wrong key from a link is rejected after keyCheck and replaced by the real one from an envelope", async () => {
    const { event, sara, admin } = await goOnline();
    const member = makeDevice(memberDb, "iPhone Safari");
    await member.engine.start();
    const invite = await admin.service.createInvite(event.id, sara.id);
    const wrong = parseInviteKey(`/join?t=x&k=${"A".repeat(43)}`)!;
    await member.service.joinWithInvite({ inviteToken: invite.inviteToken, eventKey: wrong });
    // the bogus key never becomes usable ...
    expect((await memberDb.eventKeys.get(event.id))?.verified ?? false).toBe(false);
    // ... and the genuine key arrives by envelope
    await until(async () => Boolean((await memberDb.eventKeys.get(event.id))?.verified));
    await until(async () => (await memberDb.events.get(event.id))?.treasurerCardNumber === CARD);
  });

  it("a device rejects an envelope whose key fails keyCheck", async () => {
    const { event, sara, admin } = await goOnline();
    const member = makeDevice(memberDb, "iPhone Safari");
    await member.engine.start();
    // nobody can hand out the genuine key: only the attacker's envelope will be there
    mock.failures.keyEnvelopes = 1000;
    const invite = await admin.service.createInvite(event.id, sara.id);
    await member.service.joinWithInvite({ inviteToken: invite.inviteToken });
    await until(async () => (await memberDb.events.get(event.id))?.keyCheck !== undefined);
    const serverEvent = mock.events.get(event.id)!;
    const device = serverEvent.devices.find((d) => d.memberId === sara.id)!;
    const attacker = await generateDeviceKeyPair();
    const envelope = await wrapEventKey({
      eventKey: await generateEventKey(),
      senderPrivateKey: attacker.privateKey,
      senderPublicKey: await exportPublicJwk(attacker.publicKey),
      recipientPublicKey: JSON.parse(device.publicKey!),
      serverEventId: event.id
    });
    device.envelope = { fromDeviceId: "evil", wrappedKey: envelope.wrappedKey, meta: envelope.meta, createdAt: new Date().toISOString() };
    await member.engine.receiveKey(event.id);
    expect(await memberDb.eventKeys.get(event.id)).toBeUndefined();
    expect((await memberDb.onlineLinks.get(event.id))?.keyError).toContain("سازگار نیست");
  });

  it("until the key arrives, values stay ciphertext; they decrypt afterwards", async () => {
    const { event, sara, admin } = await goOnline();
    const member = makeDevice(memberDb, "iPhone Safari");
    // nobody can answer yet
    mock.failures.keyEnvelopes = 1000;
    await member.engine.start();
    const invite = await admin.service.createInvite(event.id, sara.id);
    await member.service.joinWithInvite({ inviteToken: invite.inviteToken });
    await until(async () => (await memberDb.events.get(event.id))?.keyCheck !== undefined);
    expect(isEncrypted((await memberDb.events.get(event.id))?.treasurerCardNumber)).toBe(true);
    expect(await memberDb.eventKeys.get(event.id)).toBeUndefined();

    // a holder comes back and answers
    mock.failures.keyEnvelopes = 0;
    const back = makeDevice(db, "Android Chrome again");
    await back.engine.start();
    await until(async () => Boolean((await memberDb.eventKeys.get(event.id))?.verified));
    await until(async () => (await memberDb.events.get(event.id))?.treasurerCardNumber === CARD);
  });
});

describe("member profiles", () => {
  it("a plain member never receives others' memberProfile ops; staff do; own profile round-trips encrypted", async () => {
    const { event, sara, reza, treasurer, admin } = await goOnline();
    const member = makeDevice(memberDb, "iPhone Safari");
    await member.engine.start();
    const invite = await admin.service.createInvite(event.id, sara.id);
    await member.service.joinWithInvite({ inviteToken: invite.inviteToken });
    await until(async () => Boolean((await memberDb.eventKeys.get(event.id))?.verified));

    // sara (a member) receives her own profile only
    await until(async () => (await memberDb.persons.get(sara.id))?.cardNumber === SARA_CARD);
    expect((await memberDb.persons.get(sara.id))?.phone).toBe(SARA_PHONE);
    for (const id of [treasurer.id, reza.id]) {
      const p = (await memberDb.persons.get(id))!;
      expect(p.cardNumber).toBeUndefined();
      expect(p.iban).toBeUndefined();
      expect(p.phone).toBeUndefined();
      expect(p.bankName).toBeUndefined();
    }
    expect(JSON.stringify(await memberDb.appliedRemoteOps.toArray())).not.toContain(CARD);

    // she updates her own bank info; the treasurer's device receives it decrypted ...
    await member.service.saveMyProfile(event.id, { cardNumber: "6104337812345674", bankName: "بانک ملت", phone: "09351112299" });
    await until(async () => (await db.persons.get(sara.id))?.cardNumber === "6104337812345674");
    expect((await db.persons.get(sara.id))?.phone).toBe("09351112299");
    expect(mock.wire.join("\n")).not.toContain("6104337812345674");
    expect(mock.wire.join("\n")).not.toContain("09351112299");

    // ... while another member's device never sees it
    const other = makeDevice(thirdDb, "Pixel Chrome");
    await other.engine.start();
    const inviteReza = await admin.service.createInvite(event.id, reza.id);
    await other.service.joinWithInvite({ inviteToken: inviteReza.inviteToken });
    await until(async () => Boolean((await thirdDb.eventKeys.get(event.id))?.verified));
    await other.engine.syncNow(event.id);
    for (const person of await thirdDb.persons.toArray()) {
      expect(person.cardNumber).toBeUndefined();
      expect(person.phone).toBeUndefined();
    }
    // a member cannot save someone else's profile; invalid input is refused with a Persian message
    await expect(member.service.saveMyProfile(event.id, { cardNumber: "1234" })).rejects.toThrow("شماره کارت");
  });

  it("legacy online events: the creator device generates the key once and backfills encrypted profiles (idempotent)", async () => {
    const { event, treasurer, sara } = await seed();
    // simulate a v0.8.0 online event: link exists, no key, no keyCheck, nothing uploaded with profile data
    const admin = makeDevice(db, "Android Chrome");
    const created = await (await import("./apiClient")).api.createEvent({ eventId: event.id, title: event.title, creator: { memberId: treasurer.id, displayName: "علی رضایی" }, members: [{ memberId: sara.id, displayName: "سارا احمدی" }], deviceLabel: "old" });
    await db.onlineLinks.put({
      localEventId: event.id,
      serverEventId: event.id,
      memberId: treasurer.id,
      roles: ["admin", "treasurer"],
      deviceToken: created.deviceToken,
      deviceId: created.deviceId,
      lastSeq: 0,
      status: "online",
      uploadTotal: 3,
      registeredPersonIds: [treasurer.id, sara.id],
      creatorDevice: true,
      createdAt: new Date().toISOString()
    });
    await admin.engine.start();
    await until(async () => Boolean((await db.eventKeys.get(event.id))?.verified));
    await until(async () => (await db.outbox.count()) === 0);
    const ops = mock.events.get(event.id)!.ops.map((o) => o.op);
    expect(ops.filter((o) => o.entity === "memberProfile").map((o) => o.entityId).sort()).toEqual([treasurer.id, sara.id].sort());
    expect(ops.some((o) => o.entity === "events" && o.changes.treasurerCardNumber && isEncrypted(o.changes.treasurerCardNumber.after))).toBe(true);
    expect(isEncrypted(ops.find((o) => o.changes.keyCheck)!.changes.keyCheck.after)).toBe(true);
    expect(mock.wire.join("")).not.toContain(CARD);

    // a second start does nothing new
    const count = ops.length;
    admin.engine.stop();
    const again = makeDevice(db, "Android Chrome");
    await again.engine.start();
    await again.engine.syncNow(event.id);
    expect(mock.events.get(event.id)!.ops.length).toBe(count);
  });
});

describe("statement snapshots", () => {
  it("contain no non-treasurer bank data, and the member device never sees it", async () => {
    const { event, sara, treasurer, admin } = await goOnline();
    await vouchersRepository.createExpense({ eventId: event.id, expenseDate: "2026-01-02", description: "ناهار", totalAmount: 400, payers: [{ personId: sara.id, amount: 400 }], split: { mode: "equal_all" } });
    await eventsRepository.close(event.id);
    await statementsRepository.issueForAllMembers(event.id);
    await admin.engine.syncNow(event.id);
    await until(async () => (await db.outbox.count()) === 0);

    // the local (treasurer) snapshot may carry creditors' card numbers for display ...
    const local = (await db.statements.where("eventId").equals(event.id).toArray()).find((s) => s.kind === "treasurer")!;
    expect(local.snapshot).toContain("5859 8310 1234 3728");
    // ... the synced one does not (decrypt it with the event key to look inside)
    const member = makeDevice(memberDb, "iPhone Safari");
    await member.engine.start();
    const invite = await admin.service.createInvite(event.id, sara.id);
    await member.service.joinWithInvite({ inviteToken: invite.inviteToken });
    await until(async () => Boolean((await memberDb.eventKeys.get(event.id))?.verified));
    await until(async () => (await memberDb.statements.where("eventId").equals(event.id).count()) > 0);
    for (const s of await memberDb.statements.where("eventId").equals(event.id).toArray()) {
      await until(async () => !isEncrypted((await memberDb.statements.get(s.id))?.snapshot));
      const snapshot = (await memberDb.statements.get(s.id))!.snapshot;
      expect(snapshot).not.toContain("5859");
      expect(snapshot).not.toContain(SARA_PHONE);
      const parsed = JSON.parse(snapshot) as { hubSettlement?: { paysFromTreasurer: Record<string, unknown>[] } | null };
      for (const row of parsed.hubSettlement?.paysFromTreasurer ?? []) expect(Object.keys(row).some((k) => /card|iban|bank|holder/i.test(k))).toBe(false);
    }
    expect(treasurer.id).toBeTruthy();
  });
});

describe("member removal", () => {
  it("wipes the removed member's device (event, persons, key) and keeps history on the admin device; restore works", async () => {
    const { event, sara, admin } = await goOnline();
    const member = makeDevice(memberDb, "iPhone Safari");
    await member.engine.start();
    const invite = await admin.service.createInvite(event.id, sara.id);
    await member.service.joinWithInvite({ inviteToken: invite.inviteToken });
    await until(async () => Boolean((await memberDb.eventKeys.get(event.id))?.verified));

    await admin.service.removeMember(event.id, sara.id);
    await until(async () => (await memberDb.events.get(event.id)) === undefined);
    expect(await memberDb.vouchers.count()).toBe(0);
    expect(await memberDb.persons.count()).toBe(0);
    expect(await memberDb.eventKeys.count()).toBe(0);
    expect(await memberDb.onlineLinks.count()).toBe(0);
    expect((await readOnlineNotice(memberDb))?.message).toContain("قطع شد");

    // the member row and history stay for the admin; the invites list shows the used invite
    const members = await admin.service.listMembers(event.id);
    expect(members.find((m) => m.memberId === sara.id)).toMatchObject({ roles: [], activeDevices: 0 });
    expect(members.find((m) => m.memberId === sara.id)?.removedAt).toBeTruthy();
    expect(await db.vouchers.count()).toBe(1);
    expect((await admin.service.listInvites(event.id)).find((i) => i.memberId === sara.id)?.status).toBe("used");
    await expect(admin.service.createInvite(event.id, sara.id)).rejects.toMatchObject({ code: "member-removed" });

    await admin.service.restoreMember(event.id, sara.id);
    expect((await admin.service.listMembers(event.id)).find((m) => m.memberId === sara.id)?.removedAt).toBeNull();
    await expect(admin.service.createInvite(event.id, sara.id)).resolves.toBeTruthy();
  });

  it("cannot remove the last admin", async () => {
    const { event, treasurer, admin } = await goOnline();
    await expect(admin.service.removeMember(event.id, treasurer.id)).rejects.toMatchObject({ code: "last-admin" });
  });
});

describe("backup key", () => {
  it("round-trips through the service with and without a passphrase and restores a lost key", async () => {
    const { event, sara, admin } = await goOnline();
    const plain = (await admin.service.exportBackupKey(event.id))!;
    const protectedText = (await admin.service.exportBackupKey(event.id, "رمز من"))!;
    expect(plain.startsWith("tpkey1.")).toBe(true);
    expect(protectedText.startsWith("tpkey1p.")).toBe(true);

    const member = makeDevice(memberDb, "iPhone Safari");
    await member.engine.start();
    // nobody can answer
    mock.failures.keyEnvelopes = 1000;
    const invite = await admin.service.createInvite(event.id, sara.id);
    await member.service.joinWithInvite({ inviteToken: invite.inviteToken });
    await until(async () => (await memberDb.events.get(event.id))?.keyCheck !== undefined);
    expect(await memberDb.eventKeys.get(event.id)).toBeUndefined();

    await expect(member.service.restoreBackupKey(event.id, protectedText)).rejects.toThrow("گذرواژه");
    await expect(member.service.restoreBackupKey(event.id, protectedText, "اشتباه")).rejects.toThrow();
    await expect(member.service.restoreBackupKey(event.id, "garbage")).rejects.toThrow("معتبر نیست");
    await member.service.restoreBackupKey(event.id, protectedText, "رمز من");
    expect((await memberDb.eventKeys.get(event.id))?.verified).toBe(true);
    await until(async () => (await memberDb.events.get(event.id))?.treasurerCardNumber === CARD);
  });
});
