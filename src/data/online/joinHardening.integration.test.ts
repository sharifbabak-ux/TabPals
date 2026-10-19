/**
 * Join hardening (v0.9.1): failed first catch-up, local failure after redeem, double join. Same setup as sync.integration.test.ts.
 * Integration tests: the real sync engine + services + repositories against
 * an in-memory server that follows Tabpals-Live docs/API.md (MSW) and a mock
 * Socket.IO hub. Two devices = two Dexie databases.
 */
import { setupServer } from "msw/node";
import { vi } from "vitest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { createMockApi } from "@/test/mockApiServer";
import { db, TabPalDB } from "../db";
import { eventMembersRepository } from "../repositories/eventMembersRepository";
import { eventsRepository } from "../repositories/eventsRepository";
import { personsRepository } from "../repositories/personsRepository";
import { vouchersRepository } from "../repositories/vouchersRepository";
import { createOnlineService } from "./onlineService";
import { SyncEngine } from "./syncEngine";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

let mock: ReturnType<typeof createMockApi>;
const engines: SyncEngine[] = [];
let memberDb: TabPalDB;

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


async function setupTwoDevices() {
  const { sara, event } = await seedEvent(2);
  const admin = makeDevice(db, "Android Chrome");
  await admin.engine.start();
  await admin.service.goOnline(event.id);
  await until(async () => (await db.onlineLinks.get(event.id))?.status === "online");
  const member = makeDevice(memberDb, "iPhone Safari");
  await member.engine.start();
  return { sara, event, admin, member };
}

const serverDevices = (eventId: string, memberId: string) => mock.events.get(eventId)!.devices.filter((d) => d.memberId === memberId);

describe("join hardening", () => {
  it("a failed first catch-up is reported, the device stays joined, and a retry completes the download (person row included)", async () => {
    const { sara, event, admin, member } = await setupTwoDevices();
    const invite = await admin.service.createInvite(event.id, sara.id);
    mock.failures.pullOps = 1_000; // the download fails (offline / server error)

    const joined = await member.service.joinWithInvite({ inviteToken: invite.inviteToken });
    expect(joined).toMatchObject({ eventId: event.id, synced: false });
    expect((joined as { error: string }).error).toBeTruthy();
    // state is kept for a later retry: link + token + event shell, device still active on the server
    expect(await memberDb.onlineLinks.get(event.id)).toMatchObject({ memberId: sara.id, status: "online" });
    expect(await memberDb.events.get(event.id)).toBeTruthy();
    expect(await memberDb.persons.get(sara.id)).toBeUndefined(); // exactly the situation that disabled Save before
    expect(serverDevices(event.id, sara.id).filter((d) => !d.revokedAt)).toHaveLength(1);

    mock.failures.pullOps = 0;
    const retried = await member.service.retryJoinSync(event.id);
    expect(retried).toEqual({ eventId: event.id, synced: true });
    expect((await memberDb.persons.get(sara.id))?.firstName).toBe("سارا");
    expect(await memberDb.vouchers.where("eventId").equals(event.id).count()).toBe(2);
  });

  it("if local persistence fails after the redeem, the new device is revoked and nothing is left behind", async () => {
    const { sara, event, admin, member } = await setupTwoDevices();
    const invite = await admin.service.createInvite(event.id, sara.id);
    const put = vi.spyOn(memberDb.onlineLinks, "put").mockRejectedValueOnce(new Error("disk full"));

    await expect(member.service.joinWithInvite({ inviteToken: invite.inviteToken })).rejects.toThrow("دعوت‌نامه‌ی تازه");
    put.mockRestore();
    expect(await memberDb.onlineLinks.count()).toBe(0);
    expect(await memberDb.events.count()).toBe(0);
    // no "ghost active device" that would hide the admin's Invite button
    expect(serverDevices(event.id, sara.id).filter((d) => !d.revokedAt)).toHaveLength(0);

    // the admin can invite again and the second try works
    const again = await admin.service.createInvite(event.id, sara.id);
    expect(await member.service.joinWithInvite({ inviteToken: again.inviteToken })).toEqual({ eventId: event.id, synced: true });
  });

  it("joining an event this device already belongs to writes nothing and revokes the extra device", async () => {
    const { sara, event, admin, member } = await setupTwoDevices();
    const first = await admin.service.createInvite(event.id, sara.id);
    await member.service.joinWithInvite({ inviteToken: first.inviteToken });
    const linkBefore = await memberDb.onlineLinks.get(event.id);
    const second = await admin.service.createInvite(event.id, sara.id);

    await expect(member.service.joinWithInvite({ inviteToken: second.inviteToken })).rejects.toThrow("قبلاً عضو این ایونت");
    expect(await memberDb.onlineLinks.get(event.id)).toEqual(linkBefore); // untouched
    expect(serverDevices(event.id, sara.id).filter((d) => !d.revokedAt)).toHaveLength(1);
  });

  it("«جایگزینی دستگاه»: revoking the old device and inviting again lets a new device take over", async () => {
    const { sara, event, admin, member } = await setupTwoDevices();
    const invite = await admin.service.createInvite(event.id, sara.id);
    await member.service.joinWithInvite({ inviteToken: invite.inviteToken });
    const old = serverDevices(event.id, sara.id)[0];

    await admin.service.revokeDevice(event.id, old.deviceId);
    const fresh = await admin.service.createInvite(event.id, sara.id);
    await Dexie.delete("member-new");
    const newDb = new TabPalDB("member-new");
    await newDb.open();
    try {
      const phone = makeDevice(newDb, "New phone");
      await phone.engine.start();
      expect(await phone.service.joinWithInvite({ inviteToken: fresh.inviteToken })).toEqual({ eventId: event.id, synced: true });
      expect(serverDevices(event.id, sara.id).filter((d) => !d.revokedAt)).toHaveLength(1);
    } finally {
      newDb.close();
      await Dexie.delete("member-new");
    }
  });
});
