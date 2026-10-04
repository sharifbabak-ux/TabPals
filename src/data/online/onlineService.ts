/**
 * Online-event use cases (docs/PLAN.md "Online architecture"): go online,
 * join by invite, invites, roles, devices, audit, purge, leave. Everything
 * network-facing goes through `api`; everything local through Dexie. The
 * device token is read from the `onlineLinks` row and never logged.
 */
import { getAppBaseUrl } from "@/config/online";
import { platform } from "@/platform";
import { can, canWriteLedger } from "@/domain/onlinePermissions";
import { buildInviteUrl } from "@/domain/inviteLink";
import { buildProfileOp, PROFILE_FIELDS, sanitizeOutboundOp } from "@/domain/outboundSanitizer";
import { generateEventKey, makeKeyCheck } from "../crypto";
import { isEventClosed } from "@/domain/eventStatus";
import { db as defaultDb, type TabPalDB } from "../db";
import { getDeviceId } from "../deviceId";
import { diffFields, logOperation, newBaseFields, touchBaseFields } from "../repositories/operationLog";
import { validateCardNumber, validateIban } from "@/domain/paymentValidation";
import type { Event, OnlineLink, OnlineRole, ServerOp } from "../types";
import { api, ApiError, type AuditEntry, type InviteCreated, type MemberInput, type ServerDevice, type ServerInvite, type ServerMember } from "./apiClient";
import { getDeviceKeys, putEventKey } from "./keyStore";
import { detachOnlineEvent, setOnlineNotice, wipeOnlineEvent } from "./localCleanup";
import { syncEngine, type SyncEngine } from "./syncEngine";

const BASE_FIELDS = new Set(["id", "createdAt", "updatedAt", "deviceId", "version"]);

export class OnlineServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnlineServiceError";
  }
}

export interface OnlineServiceDeps {
  db: TabPalDB;
  engine: SyncEngine;
  deviceLabel: () => string;
}

function personName(person: { firstName: string; lastName: string }): string {
  return (`${person.firstName} ${person.lastName}`.trim() || person.firstName).slice(0, 80);
}

type Row = Record<string, unknown> & { id: string };

function createOpsFor(entity: string, row: Row): { op: ServerOp | null; profile: ServerOp | null } {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const [field, value] of Object.entries(row)) {
    if (BASE_FIELDS.has(field) || value === undefined) continue;
    changes[field] = { before: undefined, after: value };
  }
  const local = {
    id: `snap.${entity}.${row.id}`.slice(0, 120),
    entity,
    entityId: row.id,
    type: "create" as const,
    changes,
    timestamp: (row.updatedAt as string) ?? new Date().toISOString(),
    deviceId: getDeviceId()
  };
  // A person's bank details / phone leave only as an encrypted memberProfile op (encrypted when pushed).
  return { op: sanitizeOutboundOp(local), profile: buildProfileOp(local) };
}

/** One sanitized `create` op per live row of an event, in dependency order (persons → event → members → ledger → group orders). */
export async function buildSnapshotOps(db: TabPalDB, eventId: string): Promise<ServerOp[]> {
  const ops: ServerOp[] = [];
  const push = (entity: string, rows: Row[]) => {
    for (const row of rows) {
      const { op, profile } = createOpsFor(entity, row);
      if (op) ops.push(op);
      if (profile) ops.push(profile);
    }
  };

  const event = (await db.events.get(eventId)) as unknown as Row | undefined;
  if (!event) throw new OnlineServiceError("ایونت پیدا نشد.");
  const members = (await db.eventMembers.where("eventId").equals(eventId).filter((m) => !m.deleted).toArray()) as unknown as Row[];
  const personIds = [...new Set(members.map((m) => m.personId as string))];
  const persons = ((await db.persons.bulkGet(personIds)).filter(Boolean) as unknown) as Row[];
  push("persons", persons);
  push("events", [event]);
  push("eventMembers", members);
  push("vouchers", (await db.vouchers.where("eventId").equals(eventId).toArray()) as unknown as Row[]);
  push("statements", (await db.statements.where("eventId").equals(eventId).toArray()) as unknown as Row[]);

  const sessions = (await db.orderSessions.where("eventId").equals(eventId).filter((s) => !s.deleted).toArray()) as unknown as Row[];
  push("orderSessions", sessions);
  for (const session of sessions) {
    const sid = session.id;
    push("sessionMenuItems", (await db.sessionMenuItems.where("sessionId").equals(sid).filter((r) => !r.deleted).toArray()) as unknown as Row[]);
    push("orderLines", (await db.orderLines.where("sessionId").equals(sid).filter((r) => !r.deleted).toArray()) as unknown as Row[]);
    push("orderPersonTotals", (await db.orderPersonTotals.where("sessionId").equals(sid).filter((r) => !r.deleted).toArray()) as unknown as Row[]);
    push("sessionExtras", (await db.sessionExtras.where("sessionId").equals(sid).filter((r) => !r.deleted).toArray()) as unknown as Row[]);
  }
  return ops;
}

export function createOnlineService(deps: OnlineServiceDeps) {
  const { db, engine } = deps;

  async function requireLink(localEventId: string): Promise<OnlineLink> {
    const link = await db.onlineLinks.get(localEventId);
    if (!link || link.status === "revoked") throw new OnlineServiceError("این ایونت آنلاین نیست.");
    return link;
  }

  /** Runs an authenticated call; a 401 means this device lost access, which wipes the local event just like a socket revoke. */
  async function authed<T>(localEventId: string, fn: (link: OnlineLink) => Promise<T>): Promise<T> {
    const link = await requireLink(localEventId);
    try {
      return await fn(link);
    } catch (err) {
      if (err instanceof ApiError && err.isAuthFailure) {
        await engine.handleRevoked(localEventId, err.code === "device-revoked" ? "device-revoked" : "unauthorized");
      }
      throw err;
    }
  }

  return {
    async getLink(localEventId: string): Promise<OnlineLink | undefined> {
      return db.onlineLinks.get(localEventId);
    },

    /** Why an event cannot go online yet, or null. */
    async goOnlineBlocker(event: Event): Promise<string | null> {
      if (!event.treasurerPersonId) return "برای آنلاین کردن ایونت ابتدا مسئول صندوق را تعیین کنید.";
      if (event.deletedAt) return "این ایونت در سطل بازیافت است.";
      if (await db.onlineLinks.get(event.id)) return "این ایونت از قبل آنلاین است.";
      return null;
    },

    /**
     * Creates the event on the server (creator = the treasurer person), then
     * queues one sanitized create op per existing record and lets the sync
     * engine upload them in chunks. The queue is persistent, so an
     * interrupted upload simply resumes at the next start.
     */
    async goOnline(localEventId: string): Promise<void> {
      const event = await db.events.get(localEventId);
      if (!event) throw new OnlineServiceError("ایونت پیدا نشد.");
      const blocker = await this.goOnlineBlocker(event);
      if (blocker) throw new OnlineServiceError(blocker);

      const treasurer = await db.persons.get(event.treasurerPersonId!);
      if (!treasurer) throw new OnlineServiceError("مسئول صندوق پیدا نشد.");
      const memberRows = await db.eventMembers.where("eventId").equals(localEventId).filter((m) => m.active && !m.deleted).toArray();
      const memberPersons = ((await db.persons.bulkGet(memberRows.map((m) => m.personId))).filter(Boolean) as { id: string; firstName: string; lastName: string }[]).filter(
        (p) => p.id !== treasurer.id
      );
      const members: MemberInput[] = memberPersons.map((p) => ({ memberId: p.id, displayName: personName(p) }));

      // The creator device generates the event key; it never leaves the device except wrapped for members' devices.
      const eventKey = await generateEventKey();
      const keyCheck = await makeKeyCheck(eventKey, localEventId);
      const deviceKeys = await getDeviceKeys(db);

      const created = await api.createEvent({
        eventId: localEventId,
        title: event.title.slice(0, 200),
        creator: { memberId: treasurer.id, displayName: personName(treasurer) },
        members,
        deviceLabel: deps.deviceLabel(),
        publicKey: deviceKeys.publicKey
      });

      // Everything below is local and atomic: the token must not be lost between the POST and the queue.
      const snapshot = await buildSnapshotOps(db, localEventId);
      snapshot.push({
        id: `keycheck.${localEventId}`.slice(0, 128),
        entity: "events",
        entityId: localEventId,
        type: "update",
        changes: { keyCheck: { before: undefined, after: keyCheck } },
        timestamp: new Date().toISOString(),
        deviceId: getDeviceId()
      });
      const nowIso = new Date().toISOString();
      await db.transaction("rw", db.onlineLinks, db.outbox, db.eventKeys, db.events, async () => {
        await putEventKey(localEventId, eventKey, true, db);
        await db.events.update(localEventId, { keyCheck });
        await db.onlineLinks.put({
          localEventId,
          serverEventId: localEventId,
          memberId: treasurer.id,
          roles: ["admin", "treasurer"],
          deviceToken: created.deviceToken,
          deviceId: created.deviceId,
          lastSeq: 0,
          status: "uploading",
          uploadTotal: snapshot.length,
          registeredPersonIds: [treasurer.id, ...members.map((m) => m.memberId)],
          creatorDevice: true,
          publicKeyRegistered: true,
          profilesBackfilledAt: nowIso,
          createdAt: nowIso
        });
        for (const op of snapshot) {
          await db.outbox.add({ opId: op.id, localEventId, op, attempts: 0, lastError: null, createdAt: nowIso, rejected: null });
        }
      });
      engine.attach(localEventId);
    },

    /** Redeems an invite (token from the link or the typed short code), creates the local event shell + link, and catches up on all ops. Returns the local event id. */
    async joinWithInvite(invite: { inviteToken?: string; shortCode?: string; eventKey?: string | null }): Promise<string> {
      const deviceKeys = await getDeviceKeys(db);
      const result = await api.redeemInvite({ inviteToken: invite.inviteToken, shortCode: invite.shortCode, deviceLabel: deps.deviceLabel(), publicKey: deviceKeys.publicKey });
      const existing = await db.onlineLinks.get(result.eventId);
      if (existing) throw new OnlineServiceError("شما قبلاً عضو این ایونت آنلاین هستید.");

      const nowIso = new Date().toISOString();
      await db.transaction("rw", db.events, db.onlineLinks, async () => {
        if (!(await db.events.get(result.eventId))) {
          await db.events.add({
            ...newBaseFields(),
            id: result.eventId,
            title: result.eventTitle,
            currency: "تومان",
            archived: false,
            treasurerPersonId: null,
            closedAt: null,
            reopenedAt: null,
            reopenReason: null,
            deletedAt: null
          });
        }
        await db.onlineLinks.put({
          localEventId: result.eventId,
          serverEventId: result.eventId,
          memberId: result.memberId,
          roles: result.roles,
          deviceToken: result.deviceToken,
          deviceId: result.deviceId,
          lastSeq: 0,
          status: "online",
          creatorDevice: false,
          publicKeyRegistered: true,
          createdAt: nowIso
        });
      });
      // A key from the invite link is imported at once and verified against keyCheck after the first catch-up.
      if (invite.eventKey) await engine.keys.importLinkKey(result.eventId, invite.eventKey);
      await engine.catchUp(result.eventId);
      engine.attach(result.eventId);
      return result.eventId;
    },

    // --- admin ------------------------------------------------------------

    async createInvite(localEventId: string, memberId: string): Promise<InviteCreated & { url: string }> {
      await engine.registerMembers(localEventId).catch(() => undefined);
      const created = await authed(localEventId, (link) => api.createInvite(link.deviceToken, link.serverEventId, memberId));
      const keyText = await engine.keys.inviteKeyText(localEventId);
      return { ...created, url: buildInviteUrl(getAppBaseUrl(), created.inviteToken, created.shortCode, keyText ?? undefined) };
    },

    /** Invites of the event as the server knows them (status pending / used / expired / revoked). */
    async listInvites(localEventId: string): Promise<ServerInvite[]> {
      return (await authed(localEventId, (link) => api.listInvites(link.deviceToken, link.serverEventId))).invites;
    },

    /** Removes a member: devices revoked, invites cancelled, roles dropped; their financial history stays. */
    async removeMember(localEventId: string, memberId: string): Promise<void> {
      await authed(localEventId, (link) => api.removeMember(link.deviceToken, link.serverEventId, memberId));
    },

    async restoreMember(localEventId: string, memberId: string): Promise<void> {
      await authed(localEventId, (link) => api.restoreMember(link.deviceToken, link.serverEventId, memberId));
    },

    // --- own member profile ------------------------------------------------------

    /**
     * "اطلاعات بانکی من": saves the caller's own bank details/phone on their person (plaintext locally);
     * the outbox hook turns that into an encrypted `memberProfile` op for this member. Throws a Persian message on invalid input.
     */
    async saveMyProfile(localEventId: string, input: { cardNumber?: string; iban?: string; bankName?: string; accountHolder?: string; phone?: string }): Promise<void> {
      const link = await requireLink(localEventId);
      const person = await db.persons.get(link.memberId);
      if (!person) throw new OnlineServiceError("اطلاعات شما در این ایونت پیدا نشد؛ کمی بعد دوباره تلاش کنید.");
      const patch: Partial<Record<(typeof PROFILE_FIELDS)[number], string | undefined>> = {};
      if (input.cardNumber !== undefined) {
        const text = input.cardNumber.trim();
        if (text) {
          const result = validateCardNumber(text);
          if (!result.valid) throw new OnlineServiceError(result.error ?? "شماره کارت نامعتبر است");
          patch.cardNumber = result.normalized;
        } else patch.cardNumber = undefined;
      }
      if (input.iban !== undefined) {
        const text = input.iban.trim();
        if (text) {
          const result = validateIban(text);
          if (!result.valid) throw new OnlineServiceError(result.error ?? "شماره شبا نامعتبر است");
          patch.iban = result.normalized;
        } else patch.iban = undefined;
      }
      if (input.bankName !== undefined) patch.bankName = input.bankName.trim() || undefined;
      if (input.accountHolder !== undefined) patch.accountHolder = input.accountHolder.trim() || undefined;
      if (input.phone !== undefined) patch.phone = input.phone.trim() || undefined;
      const updated = { ...person, ...patch, ...touchBaseFields(person) };
      await db.transaction("rw", db.persons, db.operations, async () => {
        await db.persons.put(updated);
        await logOperation(db, "persons", person.id, "update", diffFields(person, updated, [...PROFILE_FIELDS]));
      });
    },

    // --- backup key ---------------------------------------------------------

    exportBackupKey(localEventId: string, passphrase?: string): Promise<string | null> {
      return engine.keys.exportBackup(localEventId, passphrase);
    },

    async restoreBackupKey(localEventId: string, text: string, passphrase?: string): Promise<void> {
      await engine.keys.restoreFromBackup(localEventId, text, passphrase);
      engine.attach(localEventId);
      await engine.syncNow(localEventId);
    },

    async revokeInvite(localEventId: string, inviteId: string | number): Promise<void> {
      await authed(localEventId, (link) => api.revokeInvite(link.deviceToken, link.serverEventId, inviteId));
    },

    async listMembers(localEventId: string): Promise<ServerMember[]> {
      return (await authed(localEventId, (link) => api.listMembers(link.deviceToken, link.serverEventId))).members;
    },

    async setRoles(localEventId: string, memberId: string, roles: OnlineRole[]): Promise<void> {
      const result = await authed(localEventId, (link) => api.setRoles(link.deviceToken, link.serverEventId, memberId, roles));
      const link = await db.onlineLinks.get(localEventId);
      if (link && link.memberId === result.memberId) await db.onlineLinks.update(localEventId, { roles: result.roles });
    },

    async listDevices(localEventId: string): Promise<ServerDevice[]> {
      return (await authed(localEventId, (link) => api.listDevices(link.deviceToken, link.serverEventId))).devices;
    },

    async revokeDevice(localEventId: string, deviceId: string): Promise<void> {
      await authed(localEventId, (link) => api.revokeDevice(link.deviceToken, link.serverEventId, deviceId));
    },

    async listAudit(localEventId: string, before?: number | string | null): Promise<{ entries: AuditEntry[]; nextBefore: number | string | null }> {
      return authed(localEventId, (link) => api.listAudit(link.deviceToken, link.serverEventId, 50, before));
    },

    /** Admin: deletes the event from the server. The local copy stays on this device as an offline event. */
    async purgeFromServer(localEventId: string, typedTitle: string): Promise<void> {
      const event = await db.events.get(localEventId);
      const link = await requireLink(localEventId);
      if (!event || typedTitle.trim() !== event.title.trim()) throw new OnlineServiceError("عنوان ایونت درست وارد نشده است.");
      if (!can(link.roles, "event.purge")) throw new OnlineServiceError("فقط مدیر می‌تواند ایونت را از سرور حذف کند.");
      engine.expectPurge(localEventId);
      try {
        await api.purgeEvent(link.deviceToken, link.serverEventId);
      } catch (err) {
        // Not purged (a 401 means it is gone anyway): forget the expectation so a later revoke still wipes.
        if (!(err instanceof ApiError && err.isAuthFailure)) engine.cancelExpectedPurge(localEventId);
        throw err;
      }
      engine.detach(localEventId);
      await detachOnlineEvent(localEventId, db);
      await setOnlineNotice(`ایونت «${event.title}» از سرور حذف شد؛ نسخه‌ی محلی به‌صورت آفلاین روی این دستگاه ماند.`, db);
    },

    /** "خروج از ایونت آنلاین": deletes this device on the server, then the local copy. */
    async leave(localEventId: string): Promise<void> {
      const link = await requireLink(localEventId);
      if (link.deviceId) {
        try {
          await api.revokeDevice(link.deviceToken, link.serverEventId, link.deviceId);
        } catch (err) {
          // Already revoked/purged on the server is fine — the goal (no access) holds.
          if (!(err instanceof ApiError && (err.isAuthFailure || err.status === 404))) throw err;
        }
      }
      engine.detach(localEventId);
      await wipeOnlineEvent(localEventId, db);
    },

    canManage(link: OnlineLink | undefined): boolean {
      return !!link && can(link.roles, "roles.set");
    },

    canWrite(link: OnlineLink | undefined): boolean {
      return !link || canWriteLedger(link.roles);
    },

    isClosed(event: Event): boolean {
      return isEventClosed(event, new Date());
    }
  };
}

export const onlineService = createOnlineService({ db: defaultDb, engine: syncEngine, deviceLabel: () => platform.getInfo().deviceLabel });
