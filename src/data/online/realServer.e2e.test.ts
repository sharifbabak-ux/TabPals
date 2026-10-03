/**
 * End-to-end: the real client (engine, services, repositories) against the REAL
 * server cloned from github.com/sharifbabak-ux/Tabpals-Live (pg-mem, real HTTP and
 * real Socket.IO). Skipped unless TABPALS_LIVE_DIR points at a checkout with
 * `npm ci` done — see scripts/e2e-live-server.mjs.
 */
import { spawn, type ChildProcess } from "node:child_process";
import Dexie from "dexie";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setApiBaseOverride } from "@/config/online";
import { db, TabPalDB } from "../db";
import { eventMembersRepository, eventsRepository, personsRepository, vouchersRepository } from "../repositories";
import { OnlinePermissionError } from "./outboxHook";
import { readOnlineNotice } from "./localCleanup";
import { createOnlineService } from "./onlineService";
import { SyncEngine } from "./syncEngine";

const LIVE_DIR = process.env.TABPALS_LIVE_DIR;
const run = LIVE_DIR ? describe : describe.skip;

let server: ChildProcess | null = null;
let base = "";
const engines: SyncEngine[] = [];

async function until(condition: () => Promise<boolean> | boolean, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("condition not met in time");
}

beforeAll(async () => {
  if (!LIVE_DIR) return;
  server = spawn("node", ["scripts/e2e-live-server.mjs"], { env: { ...process.env, TABPALS_LIVE_DIR: LIVE_DIR }, stdio: ["ignore", "pipe", "inherit"] });
  base = await new Promise<string>((resolve, reject) => {
    server!.stdout!.on("data", (chunk: Buffer) => {
      const m = /PORT (\d+)/.exec(String(chunk));
      if (m) resolve(`http://localhost:${m[1]}`);
    });
    server!.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  setApiBaseOverride(base);
}, 30000);

afterAll(() => {
  setApiBaseOverride(null);
  server?.kill();
});

afterEach(async () => {
  const stopped = engines.splice(0);
  stopped.forEach((e) => e.stop());
  await Promise.all(stopped.map((e) => e.idle()));
});

run("real server end-to-end", () => {
  it("go online → invite → redeem → live sync → read-only member → revoke wipes", async () => {
    for (const table of db.tables) if (table.name !== "messageTemplates") await table.clear();
    await Dexie.delete("e2e-member");
    const memberDb = new TabPalDB("e2e-member");
    await memberDb.open();

    const ali = await personsRepository.create({ firstName: "علی", lastName: "رضایی", phone: "09121234567", cardNumber: "6037-9912-3456-7802" });
    const sara = await personsRepository.create({ firstName: "سارا", lastName: "احمدی" });
    const event = await eventsRepository.create({ title: "سفر شمال", treasurerPersonId: ali.id, treasurerCardNumber: "6037-9912-3456-7802" });
    await eventMembersRepository.addMembers(event.id, [ali.id, sara.id]);
    await vouchersRepository.createExpense({ eventId: event.id, expenseDate: "2026-01-01", description: "شام", totalAmount: 100, payers: [{ personId: ali.id, amount: 100 }], split: { mode: "equal_all" } });

    const adminEngine = new SyncEngine({ db });
    engines.push(adminEngine);
    const admin = createOnlineService({ db, engine: adminEngine, deviceLabel: () => "Android Chrome" });
    await adminEngine.start();
    await admin.goOnline(event.id);
    await until(async () => (await db.onlineLinks.get(event.id))?.status === "online");
    expect(await db.outbox.count()).toBe(0);

    const invite = await admin.createInvite(event.id, sara.id);
    const memberEngine = new SyncEngine({ db: memberDb });
    engines.push(memberEngine);
    const member = createOnlineService({ db: memberDb, engine: memberEngine, deviceLabel: () => "iPhone Safari" });
    await memberEngine.start();
    const localId = await member.joinWithInvite({ shortCode: invite.shortCode });
    expect(localId).toBe(event.id);

    expect((await memberDb.events.get(event.id))?.title).toBe("سفر شمال");
    expect(await memberDb.vouchers.count()).toBe(1);
    expect((await memberDb.persons.toArray()).map((p) => p.firstName).sort()).toEqual(["سارا", "علی"].sort());
    for (const p of await memberDb.persons.toArray()) expect(p.cardNumber ?? p.phone).toBeUndefined();
    expect((await memberDb.events.get(event.id))?.treasurerCardNumber).toBeUndefined();

    // live: a new voucher on the admin device arrives on the member device through the real socket
    const v = await vouchersRepository.createExpense({ eventId: event.id, expenseDate: "2026-01-02", description: "ناهار", totalAmount: 60, payers: [{ personId: ali.id, amount: 60 }], split: { mode: "equal_all" } });
    await until(async () => !!(await memberDb.vouchers.get(v.id)));
    expect(await memberDb.outbox.count()).toBe(0);

    // the member is read-only: the repository guard refuses writes (checked against the member link on the shared db)
    await db.onlineLinks.update(event.id, { roles: ["member"] });
    await expect(eventsRepository.update(event.id, { title: "هک" })).rejects.toBeInstanceOf(OnlinePermissionError);
    await db.onlineLinks.update(event.id, { roles: ["admin", "treasurer"] });

    // admin data
    expect((await admin.listMembers(event.id)).find((m) => m.memberId === sara.id)?.activeDevices).toBe(1);
    const audit = await admin.listAudit(event.id);
    expect(audit.entries.map((e) => e.action)).toEqual(expect.arrayContaining(["event.created", "invite.created", "invite.redeemed"]));

    // revoke the member's device → its local copy is wiped with a Persian notice
    const devices = await admin.listDevices(event.id);
    const memberDevice = devices.find((d) => d.memberId === sara.id)!;
    await admin.revokeDevice(event.id, memberDevice.deviceId);
    await until(async () => (await memberDb.events.get(event.id)) === undefined);
    expect((await readOnlineNotice(memberDb))?.message).toContain("قطع شد");

    memberDb.close();
    await Dexie.delete("e2e-member");
  }, 40000);
});
