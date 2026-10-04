/**
 * Thin typed client for the TabPals API (Tabpals-Live docs/API.md).
 * Network access lives in the data layer behind this module; UI and domain
 * code never call fetch directly. The device token is passed per call and
 * is never logged.
 */
import { getApiBase } from "@/config/online";
import { onlineErrorMessage } from "@/domain/onlineErrors";
import type { OnlineRole, ServerOp } from "../types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string
  ) {
    super(onlineErrorMessage(code, message));
    this.name = "ApiError";
  }

  /** The device/token is no longer accepted (revoked device or purged event). */
  get isAuthFailure(): boolean {
    return this.status === 401;
  }
}

/** The request never reached the server (offline, DNS, CORS, …). */
export class NetworkError extends Error {
  constructor() {
    super(onlineErrorMessage("network"));
    this.name = "NetworkError";
  }
}

async function request<T>(method: string, path: string, options: { token?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(`${getApiBase()}${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
  } catch {
    throw new NetworkError();
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // empty / non-JSON body
  }
  if (!response.ok) {
    const err = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(response.status, err?.code ?? `http-${response.status}`, err?.message);
  }
  return payload as T;
}

export interface MemberInput {
  memberId: string;
  displayName: string;
}

export interface PushResult {
  accepted: { opId: string; seq: number }[];
  rejected: { opId: string; reason: string; message?: string }[];
  lastSeq: number;
}

export interface RemoteOpEnvelope {
  seq: number;
  serverTs: string;
  memberId: string;
  deviceId: string;
  op: ServerOp;
}

export interface PullResult {
  ops: RemoteOpEnvelope[];
  hasMore: boolean;
  lastSeq: number;
}

export interface MeResult {
  eventId: string;
  memberId: string;
  roles: OnlineRole[];
  deviceId: string;
  eventTitle: string;
  displayName: string;
}

export interface ServerMember {
  memberId: string;
  displayName: string;
  createdAt: string;
  /** ISO time the member was removed, or null/absent while active. Removed members keep their history but have no roles or devices. */
  removedAt?: string | null;
  roles: OnlineRole[];
  activeDevices: number;
}

export type InviteStatus = "pending" | "used" | "expired" | "revoked";

export interface ServerInvite {
  inviteId: string | number;
  memberId: string;
  status: InviteStatus;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  createdBy: string | null;
}

/** An active device that registered a public key but has no key envelope yet (`publicKey` is the JWK as JSON text). */
export interface AwaitingDevice {
  deviceId: string;
  memberId: string;
  label: string;
  publicKey: string;
}

export interface ServerKeyEnvelope {
  fromDeviceId: string;
  wrappedKey: string;
  meta: unknown;
  createdAt: string;
}

export interface ServerDevice {
  deviceId: string;
  memberId: string;
  label: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  current: boolean;
}

export interface InviteCreated {
  inviteId: string | number;
  inviteToken: string;
  shortCode: string;
  expiresAt: string;
}

export interface RedeemResult {
  eventId: string;
  memberId: string;
  roles: OnlineRole[];
  deviceToken: string;
  deviceId: string;
  eventTitle: string;
}

export interface AuditEntry {
  id: number | string;
  actorMember: string | null;
  actorDevice: string | null;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
  at: string;
}

export const api = {
  createEvent(body: { eventId: string; title: string; creator: MemberInput; members: MemberInput[]; deviceLabel: string; publicKey?: unknown }) {
    return request<{ deviceToken: string; deviceId: string }>("POST", "/v1/events", { body });
  },
  pushOps(token: string, eventId: string, ops: ServerOp[]) {
    return request<PushResult>("POST", `/v1/events/${encodeURIComponent(eventId)}/ops`, { token, body: { ops } });
  },
  pullOps(token: string, eventId: string, after: number, limit = 500) {
    return request<PullResult>("GET", `/v1/events/${encodeURIComponent(eventId)}/ops?after=${after}&limit=${limit}`, { token });
  },
  me(token: string) {
    return request<MeResult>("GET", "/v1/me", { token });
  },
  listMembers(token: string, eventId: string) {
    return request<{ members: ServerMember[] }>("GET", `/v1/events/${encodeURIComponent(eventId)}/members`, { token });
  },
  addMember(token: string, eventId: string, body: MemberInput) {
    return request<{ memberId: string; displayName: string; roles: OnlineRole[] }>("POST", `/v1/events/${encodeURIComponent(eventId)}/members`, { token, body });
  },
  setRoles(token: string, eventId: string, memberId: string, roles: OnlineRole[]) {
    return request<{ memberId: string; roles: OnlineRole[] }>("PUT", `/v1/events/${encodeURIComponent(eventId)}/members/${encodeURIComponent(memberId)}/roles`, { token, body: { roles } });
  },
  createInvite(token: string, eventId: string, memberId: string) {
    return request<InviteCreated>("POST", `/v1/events/${encodeURIComponent(eventId)}/invites`, { token, body: { memberId } });
  },
  revokeInvite(token: string, eventId: string, inviteId: string | number) {
    return request<{ ok: true }>("DELETE", `/v1/events/${encodeURIComponent(eventId)}/invites/${encodeURIComponent(String(inviteId))}`, { token });
  },
  redeemInvite(body: { inviteToken?: string; shortCode?: string; deviceLabel: string; publicKey?: unknown }) {
    return request<RedeemResult>("POST", "/v1/invites/redeem", { body });
  },
  listInvites(token: string, eventId: string) {
    return request<{ invites: ServerInvite[] }>("GET", `/v1/events/${encodeURIComponent(eventId)}/invites`, { token });
  },
  removeMember(token: string, eventId: string, memberId: string) {
    return request<{ ok: true }>("DELETE", `/v1/events/${encodeURIComponent(eventId)}/members/${encodeURIComponent(memberId)}`, { token });
  },
  restoreMember(token: string, eventId: string, memberId: string) {
    return request<{ ok: true; memberId: string; roles: OnlineRole[] }>("POST", `/v1/events/${encodeURIComponent(eventId)}/members/${encodeURIComponent(memberId)}/restore`, { token });
  },
  putPublicKey(token: string, publicKey: unknown) {
    return request<{ ok: true }>("PUT", "/v1/devices/me/public-key", { token, body: { publicKey } });
  },
  awaitingKey(token: string, eventId: string) {
    return request<{ devices: AwaitingDevice[] }>("GET", `/v1/events/${encodeURIComponent(eventId)}/devices/awaiting-key`, { token });
  },
  postKeyEnvelope(token: string, eventId: string, body: { targetDeviceId: string; wrappedKey: string; meta: unknown }) {
    return request<{ ok: true }>("POST", `/v1/events/${encodeURIComponent(eventId)}/key-envelopes`, { token, body });
  },
  getKeyEnvelope(token: string) {
    return request<ServerKeyEnvelope>("GET", "/v1/devices/me/key-envelope", { token });
  },
  listDevices(token: string, eventId: string) {
    return request<{ devices: ServerDevice[] }>("GET", `/v1/events/${encodeURIComponent(eventId)}/devices`, { token });
  },
  revokeDevice(token: string, eventId: string, deviceId: string) {
    return request<{ ok: true }>("DELETE", `/v1/events/${encodeURIComponent(eventId)}/devices/${encodeURIComponent(deviceId)}`, { token });
  },
  listAudit(token: string, eventId: string, limit = 50, before?: number | string | null) {
    const query = `limit=${limit}${before !== undefined && before !== null ? `&before=${encodeURIComponent(String(before))}` : ""}`;
    return request<{ entries: AuditEntry[]; nextBefore: number | string | null }>("GET", `/v1/events/${encodeURIComponent(eventId)}/audit?${query}`, { token });
  },
  purgeEvent(token: string, eventId: string) {
    return request<{ ok: true }>("DELETE", `/v1/events/${encodeURIComponent(eventId)}`, { token });
  }
};
