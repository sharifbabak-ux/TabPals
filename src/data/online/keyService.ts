/**
 * Event-key lifecycle of one device (docs/PLAN.md "Key distribution"):
 *  - the creator device generates the key, writes `keyCheck`, backfills encrypted data;
 *  - devices without the key fetch their envelope, unwrap and verify it;
 *  - devices holding a verified key wrap it for devices awaiting one;
 *  - decrypt values that arrived while the key was missing.
 * A key is accepted only if it decrypts the event's `keyCheck`.
 */
import { PROFILE_FIELDS, EVENT_ENCRYPTED_FIELDS } from "@/domain/outboundSanitizer";
import {
  buildAad,
  eventKeyFromText,
  eventKeyToText,
  exportBackupKey,
  generateEventKey,
  importBackupKey,
  isEncrypted,
  makeKeyCheck,
  parseBackupText,
  sanitizePublicJwk,
  tryDecryptValue,
  unwrapEventKey,
  verifyKeyCheck,
  wrapEventKey
} from "../crypto";
import type { TabPalDB } from "../db";
import type { OnlineLink, ServerOp } from "../types";
import { api as defaultApi, ApiError } from "./apiClient";
import { getDeviceKeys, putEventKey } from "./keyStore";
import { signalOutboxChanged } from "./syncSignal";

export type KeyApi = Pick<typeof defaultApi, "getKeyEnvelope" | "awaitingKey" | "postKeyEnvelope">;

export interface KeyServiceDeps {
  db: TabPalDB;
  api: KeyApi;
  /** Random pause before answering a key request (0–3 s) to reduce duplicate envelopes. */
  serveDelayMs: () => number;
}

export const defaultServeDelayMs = () => Math.floor(Math.random() * 3000);

export type KeyAcceptance = "stored" | "rejected" | "deferred";

const enqueue = async (db: TabPalDB, localEventId: string, op: ServerOp): Promise<void> => {
  if (await db.outbox.where("[localEventId+opId]").equals([localEventId, op.id]).first()) return;
  if (await db.appliedRemoteOps.get([localEventId, op.id])) return;
  await db.outbox.add({ opId: op.id, localEventId, op, attempts: 0, lastError: null, createdAt: new Date().toISOString(), rejected: null });
};

/** Encrypted-member-profile + treasurer-field ops for an existing event (plaintext here; encrypted when pushed). Deterministic ids make the backfill idempotent. */
export async function buildBackfillOps(db: TabPalDB, localEventId: string, deviceId: string): Promise<ServerOp[]> {
  const ops: ServerOp[] = [];
  const now = new Date().toISOString();
  const members = await db.eventMembers.where("eventId").equals(localEventId).filter((m) => !m.deleted).toArray();
  const persons = await db.persons.bulkGet([...new Set(members.map((m) => m.personId))]);
  for (const person of persons) {
    if (!person) continue;
    const changes: ServerOp["changes"] = {};
    for (const field of PROFILE_FIELDS) {
      const value = (person as unknown as Record<string, unknown>)[field];
      if (typeof value === "string" && value !== "" && !isEncrypted(value)) changes[field] = { before: undefined, after: value };
    }
    if (Object.keys(changes).length > 0) {
      ops.push({ id: `bf.profile.${person.id}`.slice(0, 128), entity: "memberProfile", entityId: person.id, type: "update", changes, timestamp: now, deviceId });
    }
  }
  const event = (await db.events.get(localEventId)) as unknown as Record<string, unknown> | undefined;
  if (event) {
    const changes: ServerOp["changes"] = {};
    for (const field of EVENT_ENCRYPTED_FIELDS) {
      if (field === "keyCheck") continue;
      const value = event[field];
      if (typeof value === "string" && value !== "" && !isEncrypted(value)) changes[field] = { before: undefined, after: value };
    }
    if (Object.keys(changes).length > 0) {
      ops.push({ id: `bf.treasurer.${localEventId}`.slice(0, 128), entity: "events", entityId: localEventId, type: "update", changes, timestamp: now, deviceId });
    }
  }
  return ops;
}

export function createKeyService(deps: KeyServiceDeps) {
  const { db, api } = deps;
  const served = new Set<string>();
  const serving = new Set<string>();

  async function usableKey(localEventId: string): Promise<CryptoKey | null> {
    const row = await db.eventKeys.get(localEventId);
    return row?.verified ? row.key : null;
  }

  async function setKeyError(localEventId: string, message: string | null): Promise<void> {
    await db.onlineLinks.update(localEventId, { keyError: message });
  }

  /** Decrypts values that arrived (or were stored) as ciphertext: member profiles, treasurer fields, statement snapshots. */
  async function decryptPending(localEventId: string): Promise<void> {
    const row = await db.eventKeys.get(localEventId);
    const link = await db.onlineLinks.get(localEventId);
    if (!row || !link) return;
    const key = row.key;
    const sid = link.serverEventId;

    // 1) compute everything outside the transaction (WebCrypto cannot be awaited inside one)
    const personPatches: { id: string; field: string; from: string; to: string }[] = [];
    const members = await db.eventMembers.where("eventId").equals(localEventId).toArray();
    for (const person of await db.persons.bulkGet([...new Set(members.map((m) => m.personId))])) {
      if (!person) continue;
      for (const field of PROFILE_FIELDS) {
        const value = (person as unknown as Record<string, unknown>)[field];
        if (!isEncrypted(value)) continue;
        const plain = await tryDecryptValue(key, buildAad(sid, "memberProfile", person.id, field), value);
        if (plain !== null) personPatches.push({ id: person.id, field, from: value, to: plain });
      }
    }
    const eventPatches: { field: string; from: string; to: string }[] = [];
    const event = (await db.events.get(localEventId)) as unknown as Record<string, unknown> | undefined;
    if (event) {
      for (const field of EVENT_ENCRYPTED_FIELDS) {
        if (field === "keyCheck") continue;
        const value = event[field];
        if (!isEncrypted(value)) continue;
        const plain = await tryDecryptValue(key, buildAad(sid, "events", localEventId, field), value);
        if (plain !== null) eventPatches.push({ field, from: value, to: plain });
      }
    }
    const statementPatches: { id: string; from: string; to: string }[] = [];
    for (const statement of await db.statements.where("eventId").equals(localEventId).toArray()) {
      if (!isEncrypted(statement.snapshot)) continue;
      const plain = await tryDecryptValue(key, buildAad(sid, "statements", statement.id, "snapshot"), statement.snapshot);
      if (plain !== null) statementPatches.push({ id: statement.id, from: statement.snapshot, to: plain });
    }

    // 2) apply, but only where the stored value is still the ciphertext we decrypted
    await db.transaction("rw", db.persons, db.events, db.statements, async () => {
      for (const patch of personPatches) {
        const person = (await db.persons.get(patch.id)) as unknown as Record<string, unknown> | undefined;
        if (person && person[patch.field] === patch.from) await db.persons.update(patch.id, { [patch.field]: patch.to === "" ? undefined : patch.to });
      }
      const current = (await db.events.get(localEventId)) as unknown as Record<string, unknown> | undefined;
      for (const patch of eventPatches) {
        if (current && current[patch.field] === patch.from) await db.events.update(localEventId, { [patch.field]: patch.to === "" ? undefined : patch.to });
      }
      for (const patch of statementPatches) {
        const statement = await db.statements.get(patch.id);
        if (statement && statement.snapshot === patch.from) await db.statements.update(patch.id, { snapshot: patch.to });
      }
    });
  }

  /**
   * Offers a candidate key. With an event `keyCheck` known it is verified at once ("rejected" on mismatch);
   * without one an envelope key is "deferred" (fetched again after the next catch-up) and a link key is stored unverified.
   */
  async function acceptCandidate(localEventId: string, key: CryptoKey, source: "envelope" | "link" | "backup"): Promise<KeyAcceptance> {
    const link = await db.onlineLinks.get(localEventId);
    if (!link) return "rejected";
    const event = await db.events.get(localEventId);
    const keyCheck = event?.keyCheck;
    if (keyCheck) {
      if (!(await verifyKeyCheck(key, link.serverEventId, keyCheck))) {
        await setKeyError(localEventId, "کلید دریافت‌شده با این ایونت سازگار نیست و رد شد.");
        return "rejected";
      }
      await putEventKey(localEventId, key, true, db);
      await setKeyError(localEventId, null);
      await decryptPending(localEventId);
      return "stored";
    }
    if (source === "envelope") return "deferred";
    await putEventKey(localEventId, key, false, db);
    return "stored";
  }

  /** Verifies a key imported from an invite link once the event's `keyCheck` has arrived; a wrong key is dropped. */
  async function verifyPendingKey(localEventId: string): Promise<"verified" | "rejected" | "none" | "waiting"> {
    const row = await db.eventKeys.get(localEventId);
    if (!row) return "none";
    if (row.verified) return "verified";
    const link = await db.onlineLinks.get(localEventId);
    const event = await db.events.get(localEventId);
    if (!link || !event?.keyCheck) return "waiting";
    if (await verifyKeyCheck(row.key, link.serverEventId, event.keyCheck)) {
      await putEventKey(localEventId, row.key, true, db);
      await setKeyError(localEventId, null);
      await decryptPending(localEventId);
      return "verified";
    }
    await db.eventKeys.delete(localEventId);
    await setKeyError(localEventId, "کلید موجود در لینک دعوت با این ایونت سازگار نبود و رد شد؛ منتظر دریافت کلید از دستگاه‌های دیگر می‌مانیم.");
    return "rejected";
  }

  return {
    decryptPending,
    acceptCandidate,
    verifyPendingKey,

    async hasUsableKey(localEventId: string): Promise<boolean> {
      return (await usableKey(localEventId)) !== null;
    },

    /**
     * Creator device only: generates the event key, writes `keyCheck` and queues the encrypted backfill.
     * Returns true when a key was created.
     */
    async ensureCreatorKey(localEventId: string): Promise<boolean> {
      const link = await db.onlineLinks.get(localEventId);
      if (!link || link.status === "revoked" || !link.creatorDevice) return false;
      if (await db.eventKeys.get(localEventId)) return false;
      const event = await db.events.get(localEventId);
      if (!event || event.keyCheck) return false;
      const key = await generateEventKey();
      const keyCheck = await makeKeyCheck(key, link.serverEventId);
      const deviceId = link.deviceId ?? "device";
      const backfill = link.profilesBackfilledAt ? [] : await buildBackfillOps(db, localEventId, deviceId);
      await db.transaction("rw", db.eventKeys, db.events, db.outbox, db.appliedRemoteOps, db.onlineLinks, async () => {
        if (await db.eventKeys.get(localEventId)) return;
        await putEventKey(localEventId, key, true, db);
        await db.events.update(localEventId, { keyCheck });
        await enqueue(db, localEventId, {
          id: `keycheck.${localEventId}`.slice(0, 128),
          entity: "events",
          entityId: localEventId,
          type: "update",
          changes: { keyCheck: { before: undefined, after: keyCheck } },
          timestamp: new Date().toISOString(),
          deviceId
        });
        for (const op of backfill) await enqueue(db, localEventId, op);
        await db.onlineLinks.update(localEventId, { profilesBackfilledAt: new Date().toISOString() });
      });
      signalOutboxChanged(localEventId);
      return true;
    },

    /** Fetches this device's envelope (if any), unwraps and verifies it. */
    async fetchEnvelope(localEventId: string): Promise<KeyAcceptance | "none"> {
      const link = await db.onlineLinks.get(localEventId);
      if (!link || link.status === "revoked") return "none";
      const existing = await db.eventKeys.get(localEventId);
      if (existing?.verified) return "none";
      let envelope;
      try {
        envelope = await api.getKeyEnvelope(link.deviceToken);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return "none";
        throw err;
      }
      const device = await getDeviceKeys(db);
      let key: CryptoKey;
      try {
        key = await unwrapEventKey({ envelope: { wrappedKey: envelope.wrappedKey, meta: envelope.meta }, recipientPrivateKey: device.privateKey, serverEventId: link.serverEventId });
      } catch {
        await setKeyError(localEventId, "کلید دریافت‌شده خوانده نشد (نامعتبر یا برای دستگاه دیگری است).");
        return "rejected";
      }
      return acceptCandidate(localEventId, key, "envelope");
    },

    /** Holders of a verified key wrap it for every device that is waiting for one (skipping their own). */
    async serveAwaiting(localEventId: string, shouldContinue: () => boolean = () => true): Promise<number> {
      if (serving.has(localEventId)) return 0;
      serving.add(localEventId);
      try {
        const key = await usableKey(localEventId);
        const link = await db.onlineLinks.get(localEventId);
        if (!key || !link || link.status === "revoked") return 0;
        const delay = deps.serveDelayMs();
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        if (!shouldContinue()) return 0;
        const { devices } = await api.awaitingKey(link.deviceToken, link.serverEventId);
        const own = await getDeviceKeys(db);
        let sent = 0;
        for (const target of devices) {
          if (!shouldContinue()) return sent;
          if (target.deviceId === link.deviceId) continue;
          let recipient;
          try {
            recipient = sanitizePublicJwk(target.publicKey);
          } catch {
            continue;
          }
          const marker = `${link.serverEventId}|${target.deviceId}|${recipient.x}.${recipient.y}`;
          if (served.has(marker)) continue;
          const envelope = await wrapEventKey({
            eventKey: key,
            senderPrivateKey: own.privateKey,
            senderPublicKey: own.publicKey,
            recipientPublicKey: recipient,
            serverEventId: link.serverEventId
          });
          try {
            await api.postKeyEnvelope(link.deviceToken, link.serverEventId, { targetDeviceId: target.deviceId, wrappedKey: envelope.wrappedKey, meta: envelope.meta });
            served.add(marker);
            sent++;
          } catch (err) {
            // A device that vanished meanwhile is harmless; anything else is retried at the next trigger.
            if (!(err instanceof ApiError && (err.status === 404 || err.status === 400))) throw err;
          }
        }
        return sent;
      } finally {
        serving.delete(localEventId);
      }
    },

    // --- backup key / invite key -------------------------------------------------

    /** Backup text for the admin screen (null while this device has no verified key). */
    async exportBackup(localEventId: string, passphrase?: string): Promise<string | null> {
      const row = await db.eventKeys.get(localEventId);
      const link = await db.onlineLinks.get(localEventId);
      if (!row?.verified || !link) return null;
      return exportBackupKey(row.key, link.serverEventId, passphrase || undefined);
    },

    /** Restores the key from backup text. Throws a Persian message on a wrong passphrase, another event, or a key that fails keyCheck. */
    async restoreFromBackup(localEventId: string, text: string, passphrase?: string): Promise<void> {
      const link = await db.onlineLinks.get(localEventId);
      if (!link) throw new Error("این ایونت آنلاین نیست.");
      const parsed = parseBackupText(text);
      if (!parsed) throw new Error("کلید پشتیبان معتبر نیست.");
      if (parsed.serverEventId !== link.serverEventId) throw new Error("این کلید پشتیبان مربوط به ایونت دیگری است.");
      if (parsed.protectedByPassphrase && !passphrase) throw new Error("این کلید با گذرواژه محافظت شده است؛ گذرواژه را وارد کنید.");
      let key: CryptoKey;
      try {
        key = (await importBackupKey(text, passphrase)).key;
      } catch {
        throw new Error("گذرواژه نادرست است یا کلید پشتیبان آسیب دیده است.");
      }
      const event = await db.events.get(localEventId);
      if (!event?.keyCheck) throw new Error("هنوز اطلاعات ایونت کامل دریافت نشده؛ اتصال را بررسی کنید و دوباره تلاش کنید.");
      const result = await acceptCandidate(localEventId, key, "backup");
      if (result !== "stored") throw new Error("این کلید با اطلاعات ایونت سازگار نیست.");
    },

    /** The raw key as invite-fragment text, or null without a verified key. */
    async inviteKeyText(localEventId: string): Promise<string | null> {
      const row = await db.eventKeys.get(localEventId);
      if (!row?.verified) return null;
      return eventKeyToText(row.key);
    },

    /** Stores a key taken from an invite link (unverified until keyCheck is known). */
    async importLinkKey(localEventId: string, keyText: string): Promise<boolean> {
      try {
        const key = await eventKeyFromText(keyText);
        return (await acceptCandidate(localEventId, key, "link")) === "stored";
      } catch {
        return false;
      }
    }
  };
}

export type KeyService = ReturnType<typeof createKeyService>;

/** True when the link's event key has been received and verified (for the sync-details line). */
export async function isKeyReceived(db: TabPalDB, localEventId: string): Promise<boolean> {
  return Boolean((await db.eventKeys.get(localEventId))?.verified);
}

export type { OnlineLink };
