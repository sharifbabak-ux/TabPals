/** Per-device ECDH P-256 key pair and the wrapping of the event key for another device. Pure WebCrypto. */
import { base64UrlToBytes, bytesToBase64Url, randomBytes, utf8 } from "./base64url";
import { exportRawEventKey, importRawEventKey } from "./fieldCipher";

export interface PublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

export interface WrapMeta {
  v: 1;
  senderPublicKey: PublicJwk;
  salt: string;
  iv: string;
}

export interface KeyEnvelope {
  wrappedKey: string;
  meta: WrapMeta;
}

/** Private key is NOT extractable; the pair is meant to live in IndexedDB only. */
export function generateDeviceKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]) as Promise<CryptoKeyPair>;
}

/** kty, crv, x, y only — never any private member. */
export function sanitizePublicJwk(jwk: unknown): PublicJwk {
  const source = (typeof jwk === "string" ? JSON.parse(jwk) : jwk) as Record<string, unknown> | null;
  if (!source || source.kty !== "EC" || source.crv !== "P-256" || typeof source.x !== "string" || typeof source.y !== "string") {
    throw new Error("invalid public key");
  }
  return { kty: "EC", crv: "P-256", x: source.x, y: source.y };
}

export async function exportPublicJwk(publicKey: CryptoKey): Promise<PublicJwk> {
  return sanitizePublicJwk(await crypto.subtle.exportKey("jwk", publicKey));
}

function importPublicKey(jwk: PublicJwk): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", sanitizePublicJwk(jwk), { name: "ECDH", namedCurve: "P-256" }, true, []);
}

async function deriveWrapKey(privateKey: CryptoKey, peerPublic: PublicJwk, salt: Uint8Array, serverEventId: string): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: await importPublicKey(peerPublic) }, privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: utf8(`tabpals-key-wrap-v1|${serverEventId}`) as BufferSource },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Wraps the event key for a recipient device: ECDH → HKDF-SHA256 (random salt) → AES-GCM. */
export async function wrapEventKey(params: {
  eventKey: CryptoKey;
  senderPrivateKey: CryptoKey;
  senderPublicKey: PublicJwk;
  recipientPublicKey: PublicJwk;
  serverEventId: string;
}): Promise<KeyEnvelope> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const wrapKey = await deriveWrapKey(params.senderPrivateKey, params.recipientPublicKey, salt, params.serverEventId);
  const raw = await exportRawEventKey(params.eventKey);
  const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, wrapKey, raw as BufferSource);
  return {
    wrappedKey: bytesToBase64Url(new Uint8Array(wrapped)),
    meta: { v: 1, senderPublicKey: sanitizePublicJwk(params.senderPublicKey), salt: bytesToBase64Url(salt), iv: bytesToBase64Url(iv) }
  };
}

/** Inverse of `wrapEventKey`; throws on a malformed or tampered envelope. The caller must still verify keyCheck. */
export async function unwrapEventKey(params: { envelope: { wrappedKey: string; meta: unknown }; recipientPrivateKey: CryptoKey; serverEventId: string }): Promise<CryptoKey> {
  const meta = params.envelope.meta as Partial<WrapMeta> | null;
  if (!meta || meta.v !== 1 || typeof meta.salt !== "string" || typeof meta.iv !== "string" || !meta.senderPublicKey) throw new Error("invalid key envelope");
  const wrapKey = await deriveWrapKey(params.recipientPrivateKey, sanitizePublicJwk(meta.senderPublicKey), base64UrlToBytes(meta.salt), params.serverEventId);
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(meta.iv) as BufferSource }, wrapKey, base64UrlToBytes(params.envelope.wrappedKey) as BufferSource);
  return importRawEventKey(new Uint8Array(raw));
}
