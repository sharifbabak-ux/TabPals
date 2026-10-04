/**
 * Field-level end-to-end encryption (docs/PLAN.md "Encryption design").
 *
 * Format: `enc:v1:<iv base64url>:<ciphertext base64url>` — AES-256-GCM with a
 * fresh 96-bit IV per value. The AAD binds a ciphertext to its place:
 * `${serverEventId}|${entity}|${entityId}|${field}`, so a value cannot be
 * moved to another field or record. Pure WebCrypto; no storage, no network.
 */
import { base64UrlToBytes, bytesToBase64Url, fromUtf8, randomBytes, utf8 } from "./base64url";

export const ENC_PREFIX = "enc:v1:";
/** Plaintext of the event's `keyCheck` field. */
export const KEY_CHECK_PLAINTEXT = "tabpals-key-check-v1";

export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

export function buildAad(serverEventId: string, entity: string, entityId: string, field: string): string {
  return `${serverEventId}|${entity}|${entityId}|${field}`;
}

/** A fresh random 256-bit AES-GCM event key (extractable: it must be wrapped for other devices and backed up). */
export function generateEventKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function exportRawEventKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

export async function importRawEventKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error("invalid event key length");
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

/** Raw key as base64url text (invite-link fragment `k=`). */
export async function eventKeyToText(key: CryptoKey): Promise<string> {
  return bytesToBase64Url(await exportRawEventKey(key));
}

export async function eventKeyFromText(text: string): Promise<CryptoKey> {
  return importRawEventKey(base64UrlToBytes(text.trim()));
}

export async function encryptValue(key: CryptoKey, aad: string, plaintext: string): Promise<string> {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: utf8(aad) as BufferSource }, key, utf8(plaintext) as BufferSource);
  return `${ENC_PREFIX}${bytesToBase64Url(iv)}:${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

/** Throws when the value is malformed, the key is wrong, or the AAD does not match. */
export async function decryptValue(key: CryptoKey, aad: string, value: string): Promise<string> {
  if (!isEncrypted(value)) throw new Error("not an encrypted value");
  const parts = value.slice(ENC_PREFIX.length).split(":");
  if (parts.length !== 2) throw new Error("malformed encrypted value");
  const iv = base64UrlToBytes(parts[0]);
  const ciphertext = base64UrlToBytes(parts[1]);
  if (iv.length !== 12) throw new Error("malformed encrypted value");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: utf8(aad) as BufferSource }, key, ciphertext as BufferSource);
  return fromUtf8(plain);
}

/** Decrypts or returns null (wrong key / tampered / wrong place). */
export async function tryDecryptValue(key: CryptoKey, aad: string, value: string): Promise<string | null> {
  try {
    return await decryptValue(key, aad, value);
  } catch {
    return null;
  }
}

export function makeKeyCheck(key: CryptoKey, serverEventId: string): Promise<string> {
  return encryptValue(key, buildAad(serverEventId, "events", serverEventId, "keyCheck"), KEY_CHECK_PLAINTEXT);
}

/** True only when `key` decrypts the event's keyCheck to the constant. */
export async function verifyKeyCheck(key: CryptoKey, serverEventId: string, keyCheck: string): Promise<boolean> {
  return (await tryDecryptValue(key, buildAad(serverEventId, "events", serverEventId, "keyCheck"), keyCheck)) === KEY_CHECK_PLAINTEXT;
}
