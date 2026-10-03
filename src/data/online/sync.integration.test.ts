/**
 * Integration tests: the real sync engine + services + repositories against
 * an in-memory server that follows Tabpals-Live docs/API.md (MSW) and a mock
 * Socket.IO hub. Two devices = two Dexie databases.
 */
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { createMockApi, type MockSocket } from "@/test/mockApiServer";
import { db, TabPalDB } from "../db";
import { eventMembersRepository } from "../repositories/eventMembersRepository";
import { eventsRepository } from "../repositories/eventsRepository";
import { personsRepository } from "../repositories/personsRepository";
import { vouchersRepository } from "../repositories/vouchersRepository";
import { OnlinePermissionError } from "./outboxHook";
import { clearOnlineNotice, readOnlineNotice } from "./localCleanup";
import { createOnlineService, buildSnapshotOps } from "./onlineService";
import { SyncEngine } from "./syncEngine";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

let mock: ReturnType<typeof createMockApi>;
const engines: SyncEngine[] = [];
let memberDb: TabPalDB;

function makeDevice(database: TabPalDB, label: string) {
  const engine = new SyncEngine({ db: database, socketFactory: mock.socketFactory });
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
  memberDb = new TabPalDB("member-device");
  await memberDb.open();
});

afterEach(async () => {
  const stopped = engines.splice(0);
  stopped.forEach((e) => e.stop());
  await Promise.all(stopped.map((e) => e.idle()));
  memberDb.close();
  await Dexie.delete("member-device");
});

async function seedEvent(voucherCount = 1) {
  const treasurer = await personsRepository.create({ firstName: "علی", lastName: "رضایی", phone: "09121234567", cardNumber: "6037-9912-3456-7802", bankName: "بانک ملی ایران" });
  const sara = await personsRepository.create({ firstName: "سارا", lastName: "احمدی" });
  const event = await eventsRepository.create({ title: "سفر شمال", treasurerPersonId: treasurer.id, treasurerCardNumber: "6037-9912-3456-7802" });
  await eventMembersRepository.addMembers(event.id, [treasurer.id, sara.id]);
  for (let i = 0; i < voucherCount; i++) {
    await vouchersRepository.createExpense({ eventId: event.id, expenseDate: "2026-01-01", description: `شام ${i}`, totalAmount: 100, payers: [{ personId: treasurer.id, amount: 100 }], split: { mode: "equal_all" } });
  }
  return { treasurer, sara, event };
}

describe("go online", () => {
  it("creates the event (creator = treasurer), uploads sanitized history in ≤500-op chunks and ends online", async () => {
    const { treasurer, sara, event } = await seedEvent(3);
    // bulk-add vouchers straight into the table to exceed one chunk without 1000 repository round-trips
    const template = (await db.vouchers.toArray())[0];
    await db.vouchers.bulkAdd(Array.from({ length: 1100 }, (_, i) => ({ ...template, id: `BULK${i}`, number: 100 + i })));
    const treasurerDevice = makeDevice(db, "Android Chrome");
    await treasurerDevice.engine.start();

    await treasurerDevice.service.goOnline(event.id);
    await until(async () => (await db.onlineLinks.get(event.id))?.status === "online");

    const created = mock.log.find((l) => l.path === "/v1/events")!.body as { creator: { memberId: string }; members: { memberId: string }[]; deviceLabel: string };
    expect(created.creator.memberId).toBe(treasurer.id);
    expect(created.members.map((m) => m.memberId)).toEqual([sara.id]);
    expect(created.deviceLabel).toBe("Android Chrome");

    expect(mock.opBatchSizes.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...mock.opBatchSizes)).toBeLessThanOrEqual(500);
    expect(await db.outbox.count()).toBe(0);

    const serverEvent = mock.events.get(event.id)!;
    expect(serverEvent.ops.filter((o) => o.op.entity === "vouchers")).toHaveLength(1103);
    // security rule: nothing private reached the server
    const wire = JSON.stringify(serverEvent.ops) + JSON.stringify(mock.log);
    for (const secret of ["6037991234567802", "09121234567", "بانک ملی ایران"]) expect(wire).not.toContain(secret);
    expect(serverEvent.ops.find((o) => o.op.entity === "persons" && o.op.entityId === treasurer.id)!.op.changes.firstName.after).toBe("علی");
    expect(serverEvent.ops.find((o) => o.op.entity === "events")!.op.changes.treasurerPersonId.after).toBe(treasurer.id);
  });

  it("requires a treasurer", async () => {
    const event = await eventsRepository.create({ title: "بدون مسئول" });
    const d = makeDevice(db, "x");
    await expect(d.service.goOnline(event.id)).rejects.toThrow("مسئول صندوق");
  });

  it("is resumable: an interrupted upload continues after restart without duplicating ops", async () => {
    const { event } = await seedEvent(2);
    const template = (await db.vouchers.toArray())[0];
    await db.vouchers.bulkAdd(Array.from({ length: 700 }, (_, i) => ({ ...template, id: `BULK${i}`, number: 100 + i })));
    const total = (await buildSnapshotOps(db, event.id)).length;

    mock.failures.pushOps = 1_000; // network dies on every push
    const first = makeDevice(db, "x");
    await first.engine.start();
    await first.service.goOnline(event.id);
    await until(() => mock.opBatchSizes.length >= 1);
    first.engine.stop();
    await first.engine.idle();

    const link = await db.onlineLinks.get(event.id);
    expect(link?.status).toBe("uploading");
    expect(link?.uploadTotal).toBe(total);
    expect(await db.outbox.count()).toBe(total);
    expect(mock.events.get(event.id)!.ops).toHaveLength(0);

    // "app restart": a fresh engine reads the persisted link + outbox and finishes the job
    mock.failures.pushOps = 0;
    const second = makeDevice(db, "x");
    await second.engine.start();
    await until(async () => (await db.onlineLinks.get(event.id))?.status === "online");
    expect(await db.outbox.count()).toBe(0);
    expect(mock.events.get(event.id)!.ops).toHaveLength(total);

    // a partially delivered upload (batch 1 accepted, then failure) resumes from batch 2 and stays duplicate-free
    const ids = mock.events.get(event.id)!.ops.map((o) => o.op.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("queues later edits and sends them (online event keeps syncing)", async () => {
    const { event } = await seedEvent(1);
    const d = makeDevice(db, "x");
    await d.engine.start();
    await d.service.goOnline(event.id);
    await until(async () => (await db.onlineLinks.get(event.id))?.status === "online");
    const before = mock.events.get(event.id)!.ops.length;
    await eventsRepository.update(event.id, { title: "عنوان جدید" });
    await until(() => mock.events.get(event.id)!.ops.length === before + 1);
    expect(mock.events.get(event.id)!.ops.at(-1)!.op.changes.title.after).toBe("عنوان جدید");
    expect(await db.outbox.count()).toBe(0);
  });

  it("keeps ops the server rejects, with the server's reason, and retries on demand", async () => {
    const { event } = await seedEvent(1);
    const d = makeDevice(db, "x");
    await d.engine.start();
    await d.service.goOnline(event.id);
    await until(async () => (await db.onlineLinks.get(event.id))?.status === "online");
    // the server demotes this device's member to plain member behind our back
    mock.events.get(event.id)!.members.get((await db.onlineLinks.get(event.id))!.memberId)!.roles = ["member"];
    await eventsRepository.update(event.id, { title: "نیاز به مجوز" });
    await until(async () => (await db.outbox.filter((r) => !!r.rejected).count()) === 1);
    const row = (await db.outbox.toArray())[0];
    expect(row.rejected?.reason).toBe("forbidden-entity");
    expect(row.rejected?.message).toContain("نقش");
    // not retried automatically
    const count = mock.opBatchSizes.length;
    await d.engine.flush(event.id);
    expect(mock.opBatchSizes.length).toBe(count);
    // retry after being made treasurer again
    mock.events.get(event.id)!.members.get((await db.onlineLinks.get(event.id))!.memberId)!.roles = ["treasurer"];
    await d.engine.retryRejected(event.id);
    await until(async () => (await db.outbox.count()) === 0);
  });
});

describe("invite + redeem + read-only member", () => {
  async function setupTwoDevices() {
    const { treasurer, sara, event } = await seedEvent(2);
    const admin = makeDevice(db, "Android Chrome");
    await admin.engine.start();
    await admin.service.goOnline(event.id);
    await until(async () => (await db.onlineLinks.get(event.id))?.status === "online");
    const member = makeDevice(memberDb, "iPhone Safari");
    await member.engine.start();
    return { treasurer, sara, event, admin, member };
  }

  it("admin invites; the member redeems with the short code, catches up fully and is read-only", async () => {
    const { sara, event, admin, member } = await setupTwoDevices();
    const invite = await admin.service.createInvite(event.id, sara.id);
    expect(invite.url).toBe(`https://sharifbabak-ux.github.io/TabPals/#/join?t=${invite.inviteToken}&c=${invite.shortCode}`);
    expect(invite.shortCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    // the server learned about sara before the invite (members were registered)
    expect(mock.events.get(event.id)!.members.has(sara.id)).toBe(true);

    const localId = await member.service.joinWithInvite({ shortCode: invite.shortCode.toLowerCase().replace(/^(....)/, "$1-") });
    expect(localId).toBe(event.id);
    const link = (await memberDb.onlineLinks.get(event.id))!;
    expect(link).toMatchObject({ memberId: sara.id, roles: ["member"], status: "online" });
    expect(link.lastSeq).toBeGreaterThan(0);

    // full catch-up: event, members, persons, vouchers — and nothing private
    expect((await memberDb.events.get(event.id))?.title).toBe("سفر شمال");
    expect(await memberDb.vouchers.where("eventId").equals(event.id).count()).toBe(2);
    expect(await memberDb.eventMembers.where("eventId").equals(event.id).count()).toBe(2);
    expect((await memberDb.persons.toArray()).map((p) => p.firstName).sort()).toEqual(["سارا", "علی"].sort());
    for (const p of await memberDb.persons.toArray()) expect(p.cardNumber ?? p.phone ?? p.bankName).toBeUndefined();
    expect((await memberDb.events.get(event.id))?.treasurerCardNumber).toBeUndefined();
    expect(await memberDb.outbox.count()).toBe(0);

    // the same invite cannot be redeemed twice
    await expect(makeDevice(new TabPalDB("third"), "x").service.joinWithInvite({ inviteToken: invite.inviteToken })).rejects.toMatchObject({ code: "invite-used" });
    await Dexie.delete("third");
  });

  it("an invite can be revoked before use", async () => {
    const { sara, event, admin, member } = await setupTwoDevices();
    const invite = await admin.service.createInvite(event.id, sara.id);
    await admin.service.revokeInvite(event.id, invite.inviteId);
    await expect(member.service.joinWithInvite({ inviteToken: invite.inviteToken })).rejects.toMatchObject({ code: "invite-revoked" });
    expect(await memberDb.onlineLinks.count()).toBe(0);
    expect(await memberDb.events.count()).toBe(0);
  });

  it("live ops from the treasurer reach the member through the socket, applied without re-queueing", async () => {
    const { sara, treasurer, event, admin, member } = await setupTwoDevices();
    const invite = await admin.service.createInvite(event.id, sara.id);
    await member.service.joinWithInvite({ inviteToken: invite.inviteToken });
    await until(() => [...mock.sockets].some((s) => s.connected && memberSocket(s)));
    function memberSocket(s: MockSocket) {
      return s.token === mock.events.get(event.id)!.devices.find((d) => d.memberId === sara.id)!.token;
    }

    const voucher = await vouchersRepository.createExpense({ eventId: event.id, expenseDate: "2026-01-02", description: "ناهار زنده", totalAmount: 60, payers: [{ personId: treasurer.id, amount: 60 }], split: { mode: "equal_all" } });
    await until(async () => !!(await memberDb.vouchers.get(voucher.id)));
    const copy = (await memberDb.vouchers.get(voucher.id))!;
    expect(copy).toMatchObject({ description: "ناهار زنده", totalAmount: 60, number: voucher.number });
    expect(copy.shares).toEqual(voucher.shares);
    expect(await memberDb.outbox.count()).toBe(0);
    expect(await memberDb.operations.count()).toBe(0);

    // the sender's own echo is not applied twice either
    expect(await db.vouchers.where("eventId").equals(event.id).count()).toBe(3);
  });

  it("a missed socket message is repaired by catch-up on reconnect", async () => {
    const { sara, treasurer, event, admin, member } = await setupTwoDevices();
    const invite = await admin.service.createInvite(event.id, sara.id);
    await member.service.joinWithInvite({ inviteToken: invite.inviteToken });
    const memberToken = mock.events.get(event.id)!.devices.find((d) => d.memberId === sara.id)!.token;
    await until(() => [...mock.sockets].some((s) => s.token === memberToken && s.connected));
    const sock = [...mock.sockets].find((s) => s.token === memberToken)!;
    sock.disconnect();
    const v = await vouchersRepository.createExpense({ eventId: event.id, expenseDate: "2026-01-02", description: "غایب", totalAmount: 10, payers: [{ personId: treasurer.id, amount: 10 }], split: { mode: "equal_all" } });
    await until(() => mock.events.get(event.id)!.ops.some((o) => o.op.entityId === v.id));
    expect(await memberDb.vouchers.get(v.id)).toBeUndefined();
    sock.connected = true;
    sock.receive("connect"); // reconnect → catch-up
    await until(async () => !!(await memberDb.vouchers.get(v.id)));
  });

  it("member device cannot write ledger data (repository guard) — nothing is queued", async () => {
    // Use the primary db as the member's device: link with member role only.
    const { event, treasurer } = await seedEvent(0);
    await db.onlineLinks.put({ localEventId: event.id, serverEventId: event.id, memberId: "m", roles: ["member"], deviceToken: "t", lastSeq: 0, status: "online", createdAt: "x" });
    await expect(vouchersRepository.createExpense({ eventId: event.id, expenseDate: "2026-01-01", description: "x", totalAmount: 1, payers: [{ personId: treasurer.id, amount: 1 }], split: { mode: "equal_all" } })).rejects.toBeInstanceOf(OnlinePermissionError);
    expect(await db.outbox.count()).toBe(0);
  });

  it("roles-changed refreshes /v1/me and unblocks the member", async () => {
    const { sara, event, admin, member } = await setupTwoDevices();
    const invite = await admin.service.createInvite(event.id, sara.id);
    await member.service.joinWithInvite({ inviteToken: invite.inviteToken });
    await admin.service.setRoles(event.id, sara.id, ["treasurer", "member"]);
    await until(async () => (await memberDb.onlineLinks.get(event.id))!.roles.includes("treasurer"));
    await expect(admin.service.setRoles(event.id, (await db.onlineLinks.get(event.id))!.memberId, ["member"])).rejects.toMatchObject({ code: "last-admin" });
  });
});

describe("revocation, purge, leave", () => {
  async function joined() {
    const { sara, event } = await seedEvent(2);
    const admin = makeDevice(db, "Android Chrome");
    await admin.engine.start();
    await admin.service.goOnline(event.id);
    await until(async () => (await db.onlineLinks.get(event.id))?.status === "online");
    const member = makeDevice(memberDb, "iPhone Safari");
    await member.engine.start();
    const invite = await admin.service.createInvite(event.id, sara.id);
    await member.service.joinWithInvite({ inviteToken: invite.inviteToken });
    return { sara, event, admin, member };
  }

  it("a revoked device (socket event) wipes its local copy and shows a Persian message", async () => {
    const { sara, event, admin } = await joined();
    const device = mock.events.get(event.id)!.devices.find((d) => d.memberId === sara.id)!;
    expect(await memberDb.vouchers.count()).toBe(2);
    await admin.service.revokeDevice(event.id, device.deviceId);
    await until(async () => (await memberDb.events.get(event.id)) === undefined);
    expect(await memberDb.vouchers.count()).toBe(0);
    expect(await memberDb.eventMembers.count()).toBe(0);
    expect(await memberDb.persons.count()).toBe(0);
    expect(await memberDb.onlineLinks.count()).toBe(0);
    expect(await memberDb.appliedRemoteOps.count()).toBe(0);
    const notice = await readOnlineNotice(memberDb);
    expect(notice?.message).toContain("قطع شد");
    expect(notice?.message).toContain("سفر شمال");
    await clearOnlineNotice(memberDb);
    // the admin keeps everything
    expect(await db.vouchers.count()).toBe(2);
  });

  it("a 401 on any request is treated like a revoked device", async () => {
    const { sara, event, member } = await joined();
    const device = mock.events.get(event.id)!.devices.find((d) => d.memberId === sara.id)!;
    device.revokedAt = new Date().toISOString(); // revoked server-side while the member was offline
    await member.engine.syncNow(event.id);
    expect(await memberDb.events.get(event.id)).toBeUndefined();
    expect((await readOnlineNotice(memberDb))?.message).toContain("قطع شد");
  });

  it("event-purged wipes members; the purging admin keeps an offline copy", async () => {
    const { event, admin } = await joined();
    await expect(admin.service.purgeFromServer(event.id, "عنوان اشتباه")).rejects.toThrow("عنوان");
    await admin.service.purgeFromServer(event.id, "سفر شمال");
    await until(async () => (await memberDb.events.get(event.id)) === undefined);
    expect((await readOnlineNotice(memberDb))?.message).toContain("از سرور حذف شد");
    expect(mock.events.has(event.id)).toBe(false);
    // admin's copy stays, as an offline event
    expect(await db.events.get(event.id)).toBeTruthy();
    expect(await db.vouchers.count()).toBe(2);
    expect(await db.onlineLinks.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    // and it is writable again (no link, no guard)
    await expect(eventsRepository.update(event.id, { title: "آفلاین دوباره" })).resolves.toBeUndefined();
  });

  it("leaving deletes the device on the server and the local copy", async () => {
    const { sara, event, member } = await joined();
    await member.service.leave(event.id);
    const device = mock.events.get(event.id)!.devices.find((d) => d.memberId === sara.id)!;
    expect(device.revokedAt).toBeTruthy();
    expect(await memberDb.events.count()).toBe(0);
    expect(await memberDb.onlineLinks.count()).toBe(0);
  });

  it("admin screens' data: members, devices and audit log", async () => {
    const { sara, event, admin } = await joined();
    const members = await admin.service.listMembers(event.id);
    expect(members.find((m) => m.memberId === sara.id)).toMatchObject({ roles: ["member"], activeDevices: 1 });
    const devices = await admin.service.listDevices(event.id);
    expect(devices).toHaveLength(2);
    const audit = await admin.service.listAudit(event.id);
    expect(audit.entries.map((e) => e.action)).toEqual(expect.arrayContaining(["event.created", "invite.created", "invite.redeemed"]));
  });
});
