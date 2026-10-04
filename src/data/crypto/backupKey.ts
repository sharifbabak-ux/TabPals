/**
 * Backup key: the raw event key as text (and QR), optionally protected by a
 * passphrase (PBKDF2-SHA256, 310 000 iterations, random salt → AES-GCM).
 *
 *   plain:      tpkey1.<eventId>.<key b64url>
 *   protected:  tpkey1p.<eventId>.<salt>.<iv>.<ciphertext>
 *
 * The event id is bound as AAD in the protected form. A restored key is
 * only accepted by the caller after it passes keyCheck.
 */
import { base64UrlToBytes, bytesToBase64Url, randomBytes, utf8 } from "./base64url";
import { exportRawEventKey, importRawEventKey } from "./fieldCipher";

export const PBKDF2_ITERATIONS = 310_000;
const PLAIN_TAG = "tpkey1";
const PROTECTED_TAG = "tpkey1p";

async function passphraseKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", utf8(passphrase.normalize("NFKC")) as BufferSource, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function exportBackupKey(eventKey: CryptoKey, serverEventId: string, passphrase?: string): Promise<string> {
  const raw = await exportRawEventKey(eventKey);
  if (!passphrase) return `${PLAIN_TAG}.${serverEventId}.${bytesToBase64Url(raw)}`;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const wrapKey = await passphraseKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: utf8(serverEventId) as BufferSource }, wrapKey, raw as BufferSource);
  return `${PROTECTED_TAG}.${serverEventId}.${bytesToBase64Url(salt)}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export interface ParsedBackup {
  serverEventId: string;
  protectedByPassphrase: boolean;
}

export function parseBackupText(text: string): ParsedBackup | null {
  const parts = text.trim().split(".");
  if (parts[0] === PLAIN_TAG && parts.length === 3 && parts[1] && parts[2]) return { serverEventId: parts[1], protectedByPassphrase: false };
  if (parts[0] === PROTECTED_TAG && parts.length === 5 && parts[1]) return { serverEventId: parts[1], protectedByPassphrase: true };
  return null;
}

/** Throws on malformed text or a wrong passphrase. */
export async function importBackupKey(text: string, passphrase?: string): Promise<{ serverEventId: string; key: CryptoKey }> {
  const parsed = parseBackupText(text);
  if (!parsed) throw new Error("invalid backup key");
  const parts = text.trim().split(".");
  if (!parsed.protectedByPassphrase) return { serverEventId: parsed.serverEventId, key: await importRawEventKey(base64UrlToBytes(parts[2])) };
  if (!passphrase) throw new Error("passphrase required");
  const wrapKey = await passphraseKey(passphrase, base64UrlToBytes(parts[2]));
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(parts[3]) as BufferSource, additionalData: utf8(parsed.serverEventId) as BufferSource },
    wrapKey,
    base64UrlToBytes(parts[4]) as BufferSource
  );
  return { serverEventId: parsed.serverEventId, key: await importRawEventKey(new Uint8Array(raw)) };
}
