/**
 * Statement verification codes (docs/PLAN.md Stage 3B). A statement's
 * `snapshot` is stored as canonical JSON (object keys sorted recursively,
 * so the same data always serializes identically); the verification code
 * is the first 8 hex chars of that snapshot's SHA-256 digest, uppercased
 * and grouped "XXXX-XXXX". In-app "بررسی اعتبار" recomputes this from the
 * stored snapshot and compares it to the stored code.
 */

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

/** Deterministic JSON serialization: object keys sorted recursively, array order preserved. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Computes the "XXXX-XXXX" verification code for an already-canonical JSON snapshot string. */
export async function computeVerificationCode(canonicalSnapshotJson: string): Promise<string> {
  const hex = (await sha256Hex(canonicalSnapshotJson)).slice(0, 8).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}
