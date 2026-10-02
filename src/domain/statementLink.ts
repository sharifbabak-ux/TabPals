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
    return { ...data, ledger: data.ledger.map((row) => ({ ...row, participantShares: [] })) };
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
