import { describe, expect, it } from "vitest";
import {
  buildAad,
  decryptValue,
  encryptValue,
  eventKeyFromText,
  eventKeyToText,
  exportBackupKey,
  exportPublicJwk,
  generateDeviceKeyPair,
  generateEventKey,
  importBackupKey,
  isEncrypted,
  makeKeyCheck,
  parseBackupText,
  sanitizePublicJwk,
  unwrapEventKey,
  verifyKeyCheck,
  wrapEventKey
} from "./index";

const EV = "01EVENT";

describe("field encryption", () => {
  it("round-trips and uses the enc:v1 format with a fresh IV", async () => {
    const key = await generateEventKey();
    const aad = buildAad(EV, "memberProfile", "p1", "cardNumber");
    const a = await encryptValue(key, aad, "5859831012343724");
    const b = await encryptValue(key, aad, "5859831012343724");
    expect(a).toMatch(/^enc:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("5859");
    expect(isEncrypted(a)).toBe(true);
    expect(await decryptValue(key, aad, a)).toBe("5859831012343724");
    expect(await decryptValue(key, aad, b)).toBe("5859831012343724");
  });

  it("round-trips unicode", async () => {
    const key = await generateEventKey();
    const aad = buildAad(EV, "memberProfile", "p1", "accountHolder");
    expect(await decryptValue(key, aad, await encryptValue(key, aad, "علی رضایی"))).toBe("علی رضایی");
  });

  it("fails when the AAD differs (field, record, event or entity swapped)", async () => {
    const key = await generateEventKey();
    const value = await encryptValue(key, buildAad(EV, "memberProfile", "p1", "cardNumber"), "secret");
    for (const aad of [
      buildAad(EV, "memberProfile", "p1", "iban"),
      buildAad(EV, "memberProfile", "p2", "cardNumber"),
      buildAad("OTHER", "memberProfile", "p1", "cardNumber"),
      buildAad(EV, "events", "p1", "cardNumber")
    ]) {
      await expect(decryptValue(key, aad, value)).rejects.toBeTruthy();
    }
  });

  it("fails with a wrong key or tampered ciphertext", async () => {
    const key = await generateEventKey();
    const aad = buildAad(EV, "memberProfile", "p1", "phone");
    const value = await encryptValue(key, aad, "09121234567");
    await expect(decryptValue(await generateEventKey(), aad, value)).rejects.toBeTruthy();
    const tampered = value.slice(0, -2) + (value.endsWith("AA") ? "BB" : "AA");
    await expect(decryptValue(key, aad, tampered)).rejects.toBeTruthy();
    await expect(decryptValue(key, aad, "plain text")).rejects.toBeTruthy();
    await expect(decryptValue(key, aad, "enc:v1:onlyone")).rejects.toBeTruthy();
  });

  it("serializes the key to text and back", async () => {
    const key = await generateEventKey();
    const text = await eventKeyToText(key);
    const restored = await eventKeyFromText(text);
    const aad = buildAad(EV, "events", EV, "x");
    expect(await decryptValue(restored, aad, await encryptValue(key, aad, "v"))).toBe("v");
    await expect(eventKeyFromText("abc")).rejects.toBeTruthy();
  });
});

describe("keyCheck", () => {
  it("accepts the right key and rejects a wrong key or another event", async () => {
    const key = await generateEventKey();
    const check = await makeKeyCheck(key, EV);
    expect(await verifyKeyCheck(key, EV, check)).toBe(true);
    expect(await verifyKeyCheck(await generateEventKey(), EV, check)).toBe(false);
    expect(await verifyKeyCheck(key, "OTHER", check)).toBe(false);
    expect(await verifyKeyCheck(key, EV, "garbage")).toBe(false);
  });
});

describe("device keys and key wrapping", () => {
  it("wraps between two generated key pairs", async () => {
    const sender = await generateDeviceKeyPair();
    const recipient = await generateDeviceKeyPair();
    const eventKey = await generateEventKey();
    const envelope = await wrapEventKey({
      eventKey,
      senderPrivateKey: sender.privateKey,
      senderPublicKey: await exportPublicJwk(sender.publicKey),
      recipientPublicKey: await exportPublicJwk(recipient.publicKey),
      serverEventId: EV
    });
    expect(envelope.meta.v).toBe(1);
    expect(Object.keys(envelope.meta.senderPublicKey).sort()).toEqual(["crv", "kty", "x", "y"]);
    const unwrapped = await unwrapEventKey({ envelope, recipientPrivateKey: recipient.privateKey, serverEventId: EV });
    expect(await verifyKeyCheck(unwrapped, EV, await makeKeyCheck(eventKey, EV))).toBe(true);
  });

  it("does not unwrap for the wrong recipient, event id or tampered data", async () => {
    const sender = await generateDeviceKeyPair();
    const recipient = await generateDeviceKeyPair();
    const stranger = await generateDeviceKeyPair();
    const eventKey = await generateEventKey();
    const envelope = await wrapEventKey({
      eventKey,
      senderPrivateKey: sender.privateKey,
      senderPublicKey: await exportPublicJwk(sender.publicKey),
      recipientPublicKey: await exportPublicJwk(recipient.publicKey),
      serverEventId: EV
    });
    await expect(unwrapEventKey({ envelope, recipientPrivateKey: stranger.privateKey, serverEventId: EV })).rejects.toBeTruthy();
    await expect(unwrapEventKey({ envelope, recipientPrivateKey: recipient.privateKey, serverEventId: "OTHER" })).rejects.toBeTruthy();
    await expect(unwrapEventKey({ envelope: { ...envelope, wrappedKey: envelope.wrappedKey.slice(2) + "AA" }, recipientPrivateKey: recipient.privateKey, serverEventId: EV })).rejects.toBeTruthy();
    await expect(unwrapEventKey({ envelope: { wrappedKey: "x", meta: null }, recipientPrivateKey: recipient.privateKey, serverEventId: EV })).rejects.toBeTruthy();
  });

  it("keeps the private key non-extractable and exports only public members", async () => {
    const pair = await generateDeviceKeyPair();
    expect(pair.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("jwk", pair.privateKey)).rejects.toBeTruthy();
    const jwk = await exportPublicJwk(pair.publicKey);
    expect(Object.keys(jwk).sort()).toEqual(["crv", "kty", "x", "y"]);
    expect(sanitizePublicJwk({ ...jwk, d: "private", ext: true })).toEqual(jwk);
    expect(() => sanitizePublicJwk({ kty: "RSA" })).toThrow();
  });
});

describe("backup key", () => {
  it("round-trips without a passphrase", async () => {
    const key = await generateEventKey();
    const text = await exportBackupKey(key, EV);
    expect(parseBackupText(text)).toEqual({ serverEventId: EV, protectedByPassphrase: false });
    const restored = await importBackupKey(text);
    expect(restored.serverEventId).toBe(EV);
    expect(await verifyKeyCheck(restored.key, EV, await makeKeyCheck(key, EV))).toBe(true);
  });

  it("round-trips with a passphrase and rejects a wrong one", async () => {
    const key = await generateEventKey();
    const text = await exportBackupKey(key, EV, "گذرواژه‌ی من ۱۲۳");
    expect(parseBackupText(text)).toEqual({ serverEventId: EV, protectedByPassphrase: true });
    const restored = await importBackupKey(text, "گذرواژه‌ی من ۱۲۳");
    expect(await verifyKeyCheck(restored.key, EV, await makeKeyCheck(key, EV))).toBe(true);
    await expect(importBackupKey(text, "wrong")).rejects.toBeTruthy();
    await expect(importBackupKey(text)).rejects.toBeTruthy();
  });

  it("rejects garbage", async () => {
    expect(parseBackupText("hello")).toBeNull();
    await expect(importBackupKey("hello")).rejects.toBeTruthy();
  });
});
