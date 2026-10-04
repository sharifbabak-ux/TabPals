/**
 * Persistent keys of this device (IndexedDB only — never localStorage, never
 * logged): the ECDH device key pair and the AES-GCM event key per online event.
 */
import { exportPublicJwk, generateDeviceKeyPair, type PublicJwk } from "../crypto";
import { db as defaultDb, type TabPalDB } from "../db";
import type { DeviceKeyRow, EventKeyRow } from "../types";

const pending = new WeakMap<TabPalDB, Promise<DeviceKeyRow>>();

/** The device key pair, created on first use. */
export async function getDeviceKeys(db: TabPalDB = defaultDb): Promise<DeviceKeyRow> {
  const existing = await db.deviceKeys.get("device");
  if (existing) return existing;
  // Concurrent first calls must agree on ONE pair.
  if (!pending.has(db)) {
    const creating = (async () => {
      const again = await db.deviceKeys.get("device");
      if (again) return again;
      const pair = await generateDeviceKeyPair();
      const row: DeviceKeyRow = { id: "device", privateKey: pair.privateKey, publicKey: await exportPublicJwk(pair.publicKey), createdAt: new Date().toISOString() };
      await db.deviceKeys.put(row);
      return row;
    })().finally(() => {
      pending.delete(db);
    });
    pending.set(db, creating);
  }
  return pending.get(db)!;
}

export async function getDevicePublicJwk(db: TabPalDB = defaultDb): Promise<PublicJwk> {
  return (await getDeviceKeys(db)).publicKey;
}

export function getEventKeyRow(localEventId: string, db: TabPalDB = defaultDb): Promise<EventKeyRow | undefined> {
  return db.eventKeys.get(localEventId);
}

export async function putEventKey(localEventId: string, key: CryptoKey, verified: boolean, db: TabPalDB = defaultDb): Promise<void> {
  await db.eventKeys.put({ localEventId, key, verified, createdAt: new Date().toISOString() });
}

export async function hasEventKey(localEventId: string, db: TabPalDB = defaultDb): Promise<boolean> {
  return (await db.eventKeys.get(localEventId)) !== undefined;
}
