/**
 * Encryption boundary of sync (docs/PLAN.md "Encryption design").
 *
 * Outbound: `encryptOutboundOp` turns the plaintext fields that may only
 * travel encrypted into `enc:v1:` values (AAD = serverEventId|entity|
 * entityId|field); `findPlaintextLeaks` is the last line of defence run on
 * every op right before it is sent. Inbound: `decryptInboundChanges`.
 */
import { EVENT_ENCRYPTED_FIELDS } from "@/domain/outboundSanitizer";
import { buildAad, decryptValue, encryptValue, isEncrypted } from "../crypto";
import type { FieldChange, ServerOp } from "../types";

export const PROFILE_ENTITY = "memberProfile";

const FORBIDDEN_KEY_PATTERN = /card|iban|bankname|accountholder|phone|photo|avatar/i;

/** Which fields of an op must travel encrypted. */
export function encryptedFieldsOf(op: Pick<ServerOp, "entity" | "changes">): string[] {
  const fields = Object.keys(op.changes ?? {});
  switch (op.entity) {
    case PROFILE_ENTITY:
      return fields;
    case "events":
      return fields.filter((f) => (EVENT_ENCRYPTED_FIELDS as readonly string[]).includes(f));
    case "statements":
      return fields.filter((f) => f === "snapshot");
    default:
      return [];
  }
}

/** True when the op still holds plaintext that needs the event key before it can be sent. */
export function opNeedsKey(op: Pick<ServerOp, "entity" | "changes">): boolean {
  return encryptedFieldsOf(op).some((field) => {
    const change = op.changes[field];
    return !isEncrypted(change?.after) || (change?.before !== undefined && change.before !== null && !isEncrypted(change.before));
  });
}

async function encryptChange(key: CryptoKey, aad: string, change: FieldChange | undefined): Promise<FieldChange> {
  const after = change?.after;
  // `before` never leaves the device for encrypted fields.
  if (isEncrypted(after)) return { before: undefined, after };
  const plain = after === undefined || after === null ? "" : typeof after === "string" ? after : JSON.stringify(after);
  return { before: undefined, after: await encryptValue(key, aad, plain) };
}

export async function encryptOutboundOp(op: ServerOp, key: CryptoKey, serverEventId: string): Promise<ServerOp> {
  const fields = encryptedFieldsOf(op);
  if (fields.length === 0) return op;
  const changes: Record<string, FieldChange> = { ...op.changes };
  for (const field of fields) changes[field] = await encryptChange(key, buildAad(serverEventId, op.entity, op.entityId, field), op.changes[field]);
  return { ...op, changes };
}

function leaksIn(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => leaksIn(item, `${path}[${index}]`, out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, inner] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_PATTERN.test(k) && (typeof inner === "string" || typeof inner === "number") && inner !== "" && !isEncrypted(inner)) out.push(`${path}.${k}`);
      else leaksIn(inner, `${path}.${k}`, out);
    }
  }
}

/** Paths of values that would leave the device as plaintext although they are sensitive. Empty = safe to send. */
export function findPlaintextLeaks(op: ServerOp): string[] {
  const leaks: string[] = [];
  const mustBeEncrypted = new Set(encryptedFieldsOf(op));
  for (const [field, change] of Object.entries(op.changes ?? {})) {
    for (const side of ["before", "after"] as const) {
      const value = change?.[side];
      if (mustBeEncrypted.has(field)) {
        if (value !== undefined && value !== null && !isEncrypted(value)) leaks.push(`changes.${field}.${side}`);
      } else if (FORBIDDEN_KEY_PATTERN.test(field)) {
        if (value !== undefined && value !== null && value !== "" && typeof value !== "boolean" && !isEncrypted(value)) leaks.push(`changes.${field}.${side}`);
      } else {
        leaksIn(value, `changes.${field}.${side}`, leaks);
      }
    }
  }
  if (op.entity === PROFILE_ENTITY && leaks.length === 0 && !Object.keys(op.changes ?? {}).every((f) => mustBeEncrypted.has(f))) leaks.push("memberProfile");
  return leaks;
}

/**
 * Decrypts the encrypted fields of an inbound op in place of a copy. With no
 * key (or a value that does not authenticate) the ciphertext is kept, so the
 * UI shows the "waiting for key" marker and `decryptPending` can retry later.
 */
export async function decryptInboundChanges(op: ServerOp, key: CryptoKey | null, serverEventId: string): Promise<ServerOp> {
  if (!key) return op;
  const changes: Record<string, FieldChange> = { ...op.changes };
  for (const field of encryptedFieldsOf(op)) {
    // keyCheck stays ciphertext: it is what candidate keys are verified against.
    if (op.entity === "events" && field === "keyCheck") continue;
    const after = op.changes[field]?.after;
    if (!isEncrypted(after)) continue;
    try {
      const plain = await decryptValue(key, buildAad(serverEventId, op.entity, op.entityId, field), after);
      changes[field] = { before: undefined, after: plain };
    } catch {
      // keep ciphertext
    }
  }
  return { ...op, changes };
}
