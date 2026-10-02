/**
 * The no-server statement link (docs/PLAN.md Stage 3C): a compact,
 * lz-string-compressed copy of an issued statement's rendered data, carried
 * entirely inside the URL fragment (`#/s/<payload>`) so the route that
 * renders it never touches the local database (see SharedStatementScreen).
 *
 * Three size tiers, tried in order against the FULL URL length:
 * "full" (everything), "reduced" (drop the per-row "سهیم‌ها" participant
 * lists and split explanations, which are the bulkiest, least essential
 * part of a member/treasurer statement), and "none" (doesn't fit even
 * reduced — callers fall back to a link-less SMS summary).
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import type { ComprehensiveReportData, MemberStatementData } from "./statementBuilder";

export type StatementLinkData = (MemberStatementData & { closingText: string }) | ComprehensiveReportData;

export interface StatementLinkPayload {
  v: 1;
  statementId: string;
  number: number;
  issueVersion: number;
  issuedAt: string;
  verificationCode: string;
  status: "current" | "outdated";
  appVersion: string;
  data: StatementLinkData;
}

export type StatementLinkTier = "full" | "reduced" | "none";

export interface StatementLinkResult {
  tier: StatementLinkTier;
  url: string | null;
  encoded: string | null;
}

/** Drops the bulkiest, least essential per-row detail — never the totals/summary a recipient actually needs. */
function reduceStatementData(data: StatementLinkData): StatementLinkData {
  if (data.kind === "comprehensive") {
    return { ...data, ledger: data.ledger.map(({ itemized: _itemized, ...row }) => ({ ...row, participantShares: [] })) };
  }
  return { ...data, expenses: data.expenses.map((row) => ({ ...row, participantNames: [], splitExplanation: "" })) };
}

export function encodeStatementPayload(payload: StatementLinkPayload): string {
  return compressToEncodedURIComponent(JSON.stringify(payload));
}

export function decodeStatementPayload(encoded: string): StatementLinkPayload | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const parsed = JSON.parse(json) as StatementLinkPayload;
    if (parsed?.v !== 1 || !parsed.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** `baseUrl` is the app's own origin+path (e.g. `location.origin + location.pathname`), read by the caller — this stays pure. */
export function buildStatementLinkUrl(baseUrl: string, encoded: string): string {
  return `${baseUrl}#/s/${encoded}`;
}

const DEFAULT_MAX_URL_LENGTH = 1800;

/** Picks the smallest tier whose full URL fits within `maxUrlLength`, per the docs/PLAN.md Stage 3C size policy. */
export function buildStatementLink(payload: StatementLinkPayload, baseUrl: string, maxUrlLength = DEFAULT_MAX_URL_LENGTH): StatementLinkResult {
  const fullEncoded = encodeStatementPayload(payload);
  const fullUrl = buildStatementLinkUrl(baseUrl, fullEncoded);
  if (fullUrl.length <= maxUrlLength) {
    return { tier: "full", url: fullUrl, encoded: fullEncoded };
  }

  const reducedEncoded = encodeStatementPayload({ ...payload, data: reduceStatementData(payload.data) });
  const reducedUrl = buildStatementLinkUrl(baseUrl, reducedEncoded);
  if (reducedUrl.length <= maxUrlLength) {
    return { tier: "reduced", url: reducedUrl, encoded: reducedEncoded };
  }

  return { tier: "none", url: null, encoded: null };
}

// --- Summary tier (docs/PLAN.md GO-1.1) ---------------------------------------
//
// The QR printed on exports must stay small enough for a phone camera to read
// reliably, so it encodes a *summary* link instead of the full statement:
// member name, event title, issue date, final balance, currency, treasurer
// and (if set) card number / IBAN, and the verification code. Same route
// (`#/s/<payload>`); the payload's `t: "s"` marks it as the summary tier.

export interface SummaryLinkPayload {
  v: 1;
  t: "s";
  /** "m" = member/treasurer statement, "c" = comprehensive report. */
  k: "m" | "c";
  /** Member's full name (member statements only). */
  n?: string;
  /** Event title. */
  e: string;
  /** Issue date, ISO "YYYY-MM-DD". */
  d: string;
  /** Final balance (negative = debtor, positive = creditor, 0 = settled). Member statements only. */
  b?: number;
  /** Currency label. */
  c: string;
  /** Treasurer name. */
  r?: string;
  /** Treasurer card number (digits only). */
  cd?: string;
  /** Treasurer IBAN (no spaces). */
  ib?: string;
  /** Verification code. */
  vc: string;
}

export interface SummaryLinkResult {
  url: string;
  encoded: string;
  payload: SummaryLinkPayload;
}

/** Target total URL length of the summary link (keeps the QR a modest size so cameras read it). */
export const SUMMARY_LINK_MAX_URL_LENGTH = 300;

function compactDigits(value: string | null | undefined): string | undefined {
  const compact = (value ?? "").replace(/[\s-]/g, "");
  return compact || undefined;
}

export function buildSummaryPayload(payload: StatementLinkPayload): SummaryLinkPayload {
  const data = payload.data;
  const base = {
    v: 1 as const,
    t: "s" as const,
    e: data.event.title,
    d: payload.issuedAt.slice(0, 10),
    c: data.event.currency,
    vc: payload.verificationCode
  };
  if (data.kind === "comprehensive") return { ...base, k: "c" };
  const treasurer = data.treasurerName ?? undefined;
  return {
    ...base,
    k: "m",
    n: `${data.member.firstName} ${data.member.lastName}`.trim(),
    b: data.summary.balance,
    r: treasurer,
    cd: compactDigits(data.treasurerCardNumberGrouped),
    ib: compactDigits(data.treasurerIbanGrouped)
  };
}

/** Wire format: a positional array (no key names) — the shortest JSON, so the QR stays small. */
function summaryToWire(payload: SummaryLinkPayload): unknown[] {
  return [1, "s", payload.k, payload.n ?? null, payload.e, payload.d, payload.b ?? null, payload.c, payload.r ?? null, payload.cd ?? null, payload.ib ?? null, payload.vc];
}

function summaryFromWire(wire: unknown[]): SummaryLinkPayload | null {
  const [, , k, n, e, d, b, c, r, cd, ib, vc] = wire as [number, string, "m" | "c", string | null, string, string, number | null, string, string | null, string | null, string | null, string];
  if ((k !== "m" && k !== "c") || typeof e !== "string" || typeof vc !== "string") return null;
  const payload: SummaryLinkPayload = { v: 1, t: "s", k, e, d: String(d ?? ""), c: String(c ?? ""), vc };
  if (n) payload.n = n;
  if (typeof b === "number") payload.b = b;
  if (r) payload.r = r;
  if (cd) payload.cd = cd;
  if (ib) payload.ib = ib;
  return payload;
}

function encodeSummary(payload: SummaryLinkPayload): string {
  return compressToEncodedURIComponent(JSON.stringify(summaryToWire(payload)));
}

function stripUndefined(payload: SummaryLinkPayload): SummaryLinkPayload {
  return JSON.parse(JSON.stringify(payload)) as SummaryLinkPayload;
}

/**
 * Builds the compact summary link. If the URL would exceed `maxUrlLength`,
 * the least essential fields are dropped in turn (IBAN, then card number,
 * then a long event title is truncated) — the member, balance, treasurer
 * and verification code always stay.
 */
export function buildSummaryLink(payload: StatementLinkPayload, baseUrl: string, maxUrlLength = SUMMARY_LINK_MAX_URL_LENGTH): SummaryLinkResult {
  const full = stripUndefined(buildSummaryPayload(payload));
  const attempts: SummaryLinkPayload[] = [
    full,
    { ...full, ib: undefined },
    { ...full, ib: undefined, cd: undefined },
    { ...full, ib: undefined, cd: undefined, e: full.e.slice(0, 24) }
  ].map(stripUndefined);

  let best: SummaryLinkResult | null = null;
  for (const attempt of attempts) {
    const encoded = encodeSummary(attempt);
    const url = buildStatementLinkUrl(baseUrl, encoded);
    best = { url, encoded, payload: attempt };
    if (url.length <= maxUrlLength) break;
  }
  return best as SummaryLinkResult;
}

export type SharedLinkPayload = { tier: "full"; payload: StatementLinkPayload } | { tier: "summary"; payload: SummaryLinkPayload };

/** Decodes either tier of `#/s/<payload>`; null for anything invalid. */
export function decodeSharedPayload(encoded: string): SharedLinkPayload | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    const raw = JSON.parse(json) as unknown;
    if (Array.isArray(raw)) {
      if (raw[0] !== 1 || raw[1] !== "s") return null;
      const summary = summaryFromWire(raw);
      return summary ? { tier: "summary", payload: summary } : null;
    }
    const parsed = raw as { v?: number; data?: unknown };
    if (parsed?.v !== 1 || !parsed.data) return null;
    return { tier: "full", payload: parsed as unknown as StatementLinkPayload };
  } catch {
    return null;
  }
}
