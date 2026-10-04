/**
 * In-memory mock of the TabPals API that follows Tabpals-Live docs/API.md
 * (auth, ops with idempotency/seq, members, roles, invites, devices, audit,
 * purge) plus a mock Socket.IO hub. Used by the sync integration tests.
 */
import { http, HttpResponse, type RequestHandler } from "msw";
import { checkOp } from "@/domain/onlinePermissions";
import type { OnlineRole, ServerOp } from "@/data/types";
import type { SocketFactory, SocketLike } from "@/data/online/syncEngine";

export const BASE = "https://api.tabpals.ir";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface StoredOp {
  seq: number;
  serverTs: string;
  memberId: string;
  deviceId: string;
  op: ServerOp;
}
interface Invite {
  id: number;
  memberId: string;
  token: string;
  shortCode: string;
  expiresAt: number;
  usedAt?: number;
  revokedAt?: number;
}
interface Device {
  deviceId: string;
  memberId: string;
  label: string;
  token: string;
  createdAt: string;
  revokedAt: string | null;
  /** ECDH public JWK as JSON text (docs/API.md). */
  publicKey?: string;
  envelope?: { fromDeviceId: string; wrappedKey: string; meta: unknown; createdAt: string };
}
interface MockEvent {
  id: string;
  title: string;
  members: Map<string, { displayName: string; roles: OnlineRole[]; removedAt?: string | null; createdAt: string }>;
  devices: Device[];
  invites: Invite[];
  ops: StoredOp[];
  opIndex: Map<string, StoredOp>;
  audit: { id: number; actorMember: string | null; actorDevice: string | null; action: string; target: string | null; details: unknown; at: string }[];
}

export class MockSocket implements SocketLike {
  connected = false;
  private handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  constructor(
    public readonly token: string,
    private onClose: (s: MockSocket) => void
  ) {}
  on(event: string, listener: (...args: any[]) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener]);
    return this;
  }
  /** Server → client. */
  receive(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }
  connect() {
    this.connected = true;
    this.receive("connect");
  }
  disconnect() {
    this.connected = false;
    this.receive("disconnect");
  }
  close() {
    this.connected = false;
    this.onClose(this);
  }
}

export function createMockApi() {
  const events = new Map<string, MockEvent>();
  const sockets = new Set<MockSocket>();
  const log: { method: string; path: string; body?: unknown }[] = [];
  let nextSeq = 1;
  let nextInvite = 1;
  let nextAudit = 1;
  const failures = { pushOps: 0, pullOps: 0 };
  const opBatchSizes: number[] = [];
  /** Every op body the server ever received, serialized exactly as sent (for "nothing private on the wire" guard tests). */
  const wire: string[] = [];

  const rand = (n: number, alphabet = ALPHABET) => Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  const err = (status: number, code: string) => HttpResponse.json({ error: { code, message: code } }, { status });

  function auth(request: Request): { event: MockEvent; device: Device; roles: OnlineRole[] } | Response {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    for (const event of events.values()) {
      const device = event.devices.find((d) => d.token === token);
      if (device) {
        if (device.revokedAt) return err(401, "device-revoked");
        return { event, device, roles: event.members.get(device.memberId)?.roles ?? [] };
      }
    }
    return err(401, "unauthorized");
  }
  const audit = (event: MockEvent, device: { memberId: string; deviceId: string }, action: string, target: string | null, details: unknown = null) =>
    event.audit.push({ id: nextAudit++, actorMember: device.memberId, actorDevice: device.deviceId, action, target, details, at: new Date().toISOString() });

  const broadcast = (eventId: string, name: string, payload: unknown) => {
    for (const s of sockets) {
      const ev = [...events.values()].find((e) => e.devices.some((d) => d.token === s.token && !d.revokedAt));
      if (ev?.id === eventId && s.connected) s.receive(name, payload);
    }
  };

  /** docs/API.md: memberProfile ops reach only the owning member and current admins/treasurers. */
  const canRead = (event: MockEvent, memberId: string, op: ServerOp): boolean => {
    if (op.entity !== "memberProfile") return true;
    const roles = event.members.get(memberId)?.roles ?? [];
    return op.entityId === memberId || roles.includes("admin") || roles.includes("treasurer");
  };
  const toDevice = (event: MockEvent, name: string, deviceId: string, payload: unknown) => {
    const device = event.devices.find((d) => d.deviceId === deviceId);
    if (!device) return;
    for (const s of sockets) if (s.token === device.token && s.connected) s.receive(name, payload);
  };
  const registerPublicKey = (event: MockEvent, device: Device, publicKey: unknown) => {
    const text = typeof publicKey === "string" ? publicKey : JSON.stringify(publicKey);
    if (device.publicKey && device.publicKey !== text) device.envelope = undefined;
    device.publicKey = text;
    if (!device.envelope) broadcast(event.id, "key-needed", { deviceId: device.deviceId, memberId: device.memberId });
  };

  function addDevice(event: MockEvent, memberId: string, label: string): Device {
    const device: Device = { deviceId: `dev-${rand(8)}`, memberId, label, token: `tok-${rand(24)}`, createdAt: new Date().toISOString(), revokedAt: null };
    event.devices.push(device);
    return device;
  }

  const handlers: RequestHandler[] = [
    http.post(`${BASE}/v1/events`, async ({ request }) => {
      const body = (await request.json()) as { eventId: string; title: string; creator: { memberId: string; displayName: string }; members?: { memberId: string; displayName: string }[]; deviceLabel: string; publicKey?: unknown };
      log.push({ method: "POST", path: "/v1/events", body });
      if (events.has(body.eventId)) return err(409, "event-exists");
      const event: MockEvent = { id: body.eventId, title: body.title, members: new Map(), devices: [], invites: [], ops: [], opIndex: new Map(), audit: [] };
      const created = new Date().toISOString();
      event.members.set(body.creator.memberId, { displayName: body.creator.displayName, roles: ["admin", "treasurer"], createdAt: created });
      for (const m of body.members ?? []) if (!event.members.has(m.memberId)) event.members.set(m.memberId, { displayName: m.displayName, roles: ["member"], createdAt: created });
      events.set(event.id, event);
      const device = addDevice(event, body.creator.memberId, body.deviceLabel);
      if (body.publicKey) device.publicKey = typeof body.publicKey === "string" ? body.publicKey : JSON.stringify(body.publicKey);
      audit(event, device, "event.created", event.id);
      return HttpResponse.json({ deviceToken: device.token, deviceId: device.deviceId }, { status: 201 });
    }),

    http.post(`${BASE}/v1/events/:eventId/ops`, async ({ request }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      const { ops } = (await request.json()) as { ops: ServerOp[] };
      log.push({ method: "POST", path: "ops", body: { count: ops.length } });
      for (const op of ops) wire.push(JSON.stringify(op));
      opBatchSizes.push(ops.length);
      (log[log.length - 1].body as { first?: string }).first = ops[0]?.id;
      if (failures.pushOps > 0) {
        failures.pushOps--;
        return HttpResponse.error();
      }
      const accepted: { opId: string; seq: number }[] = [];
      const rejected: { opId: string; reason: string; message: string }[] = [];
      const fresh: StoredOp[] = [];
      for (const op of ops) {
        const known = a.event.opIndex.get(op.id);
        if (known) {
          accepted.push({ opId: op.id, seq: known.seq });
          continue;
        }
        const check = checkOp({ memberId: a.device.memberId, roles: a.roles }, op);
        if (!check.ok) {
          rejected.push({ opId: op.id, reason: check.reason, message: check.reason });
          continue;
        }
        const stored: StoredOp = { seq: nextSeq++, serverTs: new Date().toISOString(), memberId: a.device.memberId, deviceId: a.device.deviceId, op };
        a.event.ops.push(stored);
        a.event.opIndex.set(op.id, stored);
        accepted.push({ opId: op.id, seq: stored.seq });
        fresh.push(stored);
      }
      if (fresh.length) {
        for (const sock of sockets) {
          const device = a.event.devices.find((d) => d.token === sock.token && !d.revokedAt);
          if (!device || !sock.connected) continue;
          const visible = fresh.filter((o) => canRead(a.event, device.memberId, o.op));
          if (visible.length) sock.receive("ops", { ops: visible, lastSeq: visible[visible.length - 1].seq });
        }
      }
      return HttpResponse.json({ accepted, rejected, lastSeq: a.event.ops.at(-1)?.seq ?? 0 });
    }),

    http.get(`${BASE}/v1/events/:eventId/ops`, ({ request }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      if (failures.pullOps > 0) {
        failures.pullOps--;
        return HttpResponse.error();
      }
      const url = new URL(request.url);
      const after = Number(url.searchParams.get("after") ?? 0);
      const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 200));
      const rest = a.event.ops.filter((o) => o.seq > after && canRead(a.event, a.device.memberId, o.op));
      const page = rest.slice(0, limit);
      return HttpResponse.json({ ops: page, hasMore: rest.length > page.length, lastSeq: page.at(-1)?.seq ?? after });
    }),

    http.get(`${BASE}/v1/me`, ({ request }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      const m = a.event.members.get(a.device.memberId)!;
      return HttpResponse.json({ eventId: a.event.id, memberId: a.device.memberId, roles: m.roles, deviceId: a.device.deviceId, eventTitle: a.event.title, displayName: m.displayName });
    }),

    http.get(`${BASE}/v1/events/:eventId/members`, ({ request }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      return HttpResponse.json({
        members: [...a.event.members].map(([memberId, m]) => ({
          memberId,
          displayName: m.displayName,
          createdAt: m.createdAt,
          removedAt: m.removedAt ?? null,
          roles: m.roles,
          activeDevices: a.event.devices.filter((d) => d.memberId === memberId && !d.revokedAt).length
        }))
      });
    }),

    http.post(`${BASE}/v1/events/:eventId/members`, async ({ request }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      log.push({ method: "POST", path: "members" });
      if (!a.roles.includes("admin") && !a.roles.includes("treasurer")) return err(403, "forbidden");
      const body = (await request.json()) as { memberId: string; displayName: string };
      if (a.event.members.has(body.memberId)) return err(409, "member-exists");
      a.event.members.set(body.memberId, { displayName: body.displayName, roles: ["member"], createdAt: new Date().toISOString() });
      audit(a.event, a.device, "member.added", body.memberId);
      return HttpResponse.json({ memberId: body.memberId, displayName: body.displayName, roles: ["member"] }, { status: 201 });
    }),

    http.put(`${BASE}/v1/events/:eventId/members/:memberId/roles`, async ({ request, params }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      if (!a.roles.includes("admin")) return err(403, "forbidden");
      const member = a.event.members.get(String(params.memberId));
      if (!member) return err(404, "member-not-found");
      const { roles } = (await request.json()) as { roles: OnlineRole[] };
      const admins = [...a.event.members].filter(([id, m]) => (id === params.memberId ? roles : m.roles).includes("admin"));
      if (admins.length === 0) return err(409, "last-admin");
      audit(a.event, a.device, "roles.changed", String(params.memberId), { from: member.roles, to: roles });
      member.roles = roles;
      broadcast(a.event.id, "roles-changed", { memberId: params.memberId, roles });
      return HttpResponse.json({ memberId: params.memberId, roles });
    }),

    http.post(`${BASE}/v1/events/:eventId/invites`, async ({ request }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      if (!a.roles.includes("admin")) return err(403, "forbidden");
      const { memberId } = (await request.json()) as { memberId: string };
      if (!a.event.members.has(memberId)) return err(404, "member-not-found");
      if (a.event.members.get(memberId)!.removedAt) return err(409, "member-removed");
      const invite: Invite = { id: nextInvite++, memberId, token: `inv-${rand(24)}`, shortCode: rand(8), expiresAt: Date.now() + 7 * 864e5 };
      a.event.invites.push(invite);
      audit(a.event, a.device, "invite.created", memberId, { inviteId: invite.id });
      return HttpResponse.json({ inviteId: invite.id, inviteToken: invite.token, shortCode: invite.shortCode, expiresAt: new Date(invite.expiresAt).toISOString() }, { status: 201 });
    }),

    http.delete(`${BASE}/v1/events/:eventId/invites/:inviteId`, ({ request, params }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      const invite = a.event.invites.find((i) => String(i.id) === params.inviteId);
      if (!invite) return err(404, "invite-not-found");
      invite.revokedAt = Date.now();
      audit(a.event, a.device, "invite.revoked", invite.memberId, { inviteId: invite.id });
      return HttpResponse.json({ ok: true });
    }),

    http.post(`${BASE}/v1/invites/redeem`, async ({ request }) => {
      const body = (await request.json()) as { inviteToken?: string; shortCode?: string; deviceLabel: string; publicKey?: unknown };
      log.push({ method: "POST", path: "redeem", body });
      const code = body.shortCode?.toUpperCase().replace(/[^A-Z0-9]/g, "");
      for (const event of events.values()) {
        const invite = event.invites.find((i) => (body.inviteToken ? i.token === body.inviteToken : i.shortCode === code));
        if (!invite) continue;
        if (invite.revokedAt) return err(410, "invite-revoked");
        if (invite.usedAt) return err(409, "invite-used");
        if (invite.expiresAt <= Date.now()) return err(410, "invite-expired");
        if (event.members.get(invite.memberId)?.removedAt) return err(409, "member-removed");
        invite.usedAt = Date.now();
        const device = addDevice(event, invite.memberId, body.deviceLabel);
        if (body.publicKey) registerPublicKey(event, device, body.publicKey);
        audit(event, device, "invite.redeemed", invite.memberId, { inviteId: invite.id });
        return HttpResponse.json({ eventId: event.id, memberId: invite.memberId, roles: event.members.get(invite.memberId)!.roles, deviceToken: device.token, deviceId: device.deviceId, eventTitle: event.title });
      }
      return err(404, "invite-not-found");
    }),

    http.get(`${BASE}/v1/events/:eventId/devices`, ({ request }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      const list = a.roles.includes("admin") ? a.event.devices : a.event.devices.filter((d) => d.memberId === a.device.memberId);
      return HttpResponse.json({ devices: list.map((d) => ({ deviceId: d.deviceId, memberId: d.memberId, label: d.label, createdAt: d.createdAt, lastSeenAt: d.createdAt, revokedAt: d.revokedAt, current: d.deviceId === a.device.deviceId })) });
    }),

    http.delete(`${BASE}/v1/events/:eventId/devices/:deviceId`, ({ request, params }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      const target = a.event.devices.find((d) => d.deviceId === params.deviceId);
      if (!target) return err(404, "device-not-found");
      if (target.memberId !== a.device.memberId && !a.roles.includes("admin")) return err(403, "forbidden");
      if (!target.revokedAt) {
        target.revokedAt = new Date().toISOString();
        audit(a.event, a.device, "device.revoked", target.memberId, { deviceId: target.deviceId });
        for (const s of sockets) if (s.token === target.token) s.receive("device-revoked", { deviceId: target.deviceId });
      }
      return HttpResponse.json({ ok: true });
    }),

    http.get(`${BASE}/v1/events/:eventId/audit`, ({ request }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      if (!a.roles.includes("admin")) return err(403, "forbidden");
      const entries = [...a.event.audit].reverse();
      return HttpResponse.json({ entries, nextBefore: null });
    }),

    http.get(`${BASE}/v1/events/:eventId/invites`, ({ request }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      if (!a.roles.includes("admin")) return err(403, "forbidden");
      return HttpResponse.json({
        invites: a.event.invites.map((i) => ({
          inviteId: i.id,
          memberId: i.memberId,
          status: i.revokedAt ? "revoked" : i.usedAt ? "used" : i.expiresAt <= Date.now() ? "expired" : "pending",
          createdAt: new Date(i.expiresAt - 7 * 864e5).toISOString(),
          expiresAt: new Date(i.expiresAt).toISOString(),
          usedAt: i.usedAt ? new Date(i.usedAt).toISOString() : null,
          createdBy: a.device.memberId
        }))
      });
    }),

    http.delete(`${BASE}/v1/events/:eventId/members/:memberId`, ({ request, params }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      if (!a.roles.includes("admin")) return err(403, "forbidden");
      const memberId = String(params.memberId);
      const member = a.event.members.get(memberId);
      if (!member) return err(404, "member-not-found");
      if (member.roles.includes("admin") && [...a.event.members].filter(([, m]) => m.roles.includes("admin") && !m.removedAt).length <= 1) return err(409, "last-admin");
      if (!member.removedAt) {
        for (const d of a.event.devices.filter((x) => x.memberId === memberId && !x.revokedAt)) {
          d.revokedAt = new Date().toISOString();
          d.envelope = undefined;
          for (const sock of sockets) if (sock.token === d.token) sock.receive("device-revoked", { deviceId: d.deviceId });
        }
        for (const i of a.event.invites.filter((x) => x.memberId === memberId && !x.usedAt && !x.revokedAt)) i.revokedAt = Date.now();
        member.roles = [];
        member.removedAt = new Date().toISOString();
        audit(a.event, a.device, "member.removed", memberId);
        broadcast(a.event.id, "member-removed", { memberId });
      }
      return HttpResponse.json({ ok: true });
    }),

    http.post(`${BASE}/v1/events/:eventId/members/:memberId/restore`, ({ request, params }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      if (!a.roles.includes("admin")) return err(403, "forbidden");
      const member = a.event.members.get(String(params.memberId));
      if (!member) return err(404, "member-not-found");
      member.removedAt = null;
      audit(a.event, a.device, "member.restored", String(params.memberId));
      return HttpResponse.json({ ok: true, memberId: params.memberId, roles: [] });
    }),

    http.put(`${BASE}/v1/devices/me/public-key`, async ({ request }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      const { publicKey } = (await request.json()) as { publicKey: unknown };
      if (!publicKey || (typeof publicKey === "object" && "d" in (publicKey as object))) return err(400, "invalid-field");
      log.push({ method: "PUT", path: "public-key" });
      registerPublicKey(a.event, a.device, publicKey);
      return HttpResponse.json({ ok: true });
    }),

    http.get(`${BASE}/v1/events/:eventId/devices/awaiting-key`, ({ request }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      log.push({ method: "GET", path: "awaiting-key" });
      return HttpResponse.json({
        devices: a.event.devices
          .filter((d) => !d.revokedAt && d.publicKey && !d.envelope && !a.event.members.get(d.memberId)?.removedAt)
          .map((d) => ({ deviceId: d.deviceId, memberId: d.memberId, label: d.label, publicKey: d.publicKey }))
      });
    }),

    http.post(`${BASE}/v1/events/:eventId/key-envelopes`, async ({ request }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      const body = (await request.json()) as { targetDeviceId: string; wrappedKey: string; meta?: unknown };
      if (body.targetDeviceId === a.device.deviceId) return err(400, "invalid-field");
      const target = a.event.devices.find((d) => d.deviceId === body.targetDeviceId && !d.revokedAt && !a.event.members.get(d.memberId)?.removedAt);
      if (!target) return err(404, "device-not-found");
      log.push({ method: "POST", path: "key-envelopes", body: { target: target.deviceId, from: a.device.deviceId } });
      target.envelope = { fromDeviceId: a.device.deviceId, wrappedKey: body.wrappedKey, meta: body.meta ?? null, createdAt: new Date().toISOString() };
      audit(a.event, a.device, "key.delivered", target.deviceId, { targetDeviceId: target.deviceId });
      toDevice(a.event, "key-delivered", target.deviceId, { deviceId: target.deviceId, fromDeviceId: a.device.deviceId });
      return HttpResponse.json({ ok: true });
    }),

    http.get(`${BASE}/v1/devices/me/key-envelope`, ({ request }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      if (!a.device.envelope) return err(404, "not-found");
      return HttpResponse.json(a.device.envelope);
    }),

    http.delete(`${BASE}/v1/events/:eventId`, ({ request }) => {
      const a = auth(request);
      if (a instanceof Response) return a;
      if (!a.roles.includes("admin")) return err(403, "forbidden");
      events.delete(a.event.id);
      for (const s of sockets) s.receive("event-purged", { eventId: a.event.id });
      return HttpResponse.json({ ok: true });
    })
  ];

  /** Socket factory handing out mock sockets that are "connected" on the next tick. */
  const socketFactory: SocketFactory = (_url, token) => {
    const socket = new MockSocket(token, (s) => sockets.delete(s));
    sockets.add(socket);
    setTimeout(() => socket.connect(), 0);
    return socket;
  };

  return { handlers, events, sockets, log, wire, failures, opBatchSizes, socketFactory, addDevice, broadcast };
}
