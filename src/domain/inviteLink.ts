/**
 * Invite link / short-code helpers (docs/PLAN.md "Join flow"). Pure.
 * The server's short code is 8 chars from an alphabet without look-alikes
 * (O/0/I/1 removed); when typed it is case-, space- and dash-insensitive.
 */
import { normalizeDigits } from "./paymentValidation";

export const SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SHORT_CODE_LENGTH = 8;

/**
 * Builds `<appBase>#/join?t=<token>`; the base's own hash/query is dropped
 * and a missing trailing slash tolerated. The optional short code rides
 * along as `&c=` so the "install the app first" page can show it large
 * (the server only reveals the code once, at invite creation).
 */
export function buildInviteUrl(appBaseUrl: string, inviteToken: string, shortCode?: string): string {
  const base = appBaseUrl.split("#")[0].split("?")[0];
  const withSlash = base.endsWith("/") ? base : `${base}/`;
  const code = shortCode ? normalizeShortCode(shortCode) : "";
  return `${withSlash}#/join?t=${encodeURIComponent(inviteToken)}${code ? `&c=${code}` : ""}`;
}

/** The short code carried in a join link's `c` parameter (valid codes only), or null. */
export function parseInviteLinkCode(input: string): string | null {
  const queryStart = input.indexOf("?");
  if (queryStart === -1 || parseInviteToken(input) === null) return null;
  const code = new URLSearchParams(input.slice(queryStart + 1).split("#")[0]).get("c");
  return code && isValidShortCode(code) ? normalizeShortCode(code) : null;
}

/** Extracts the invite token from a join link, a bare `#/join?t=…` hash/path, or a full URL. Null when absent. */
export function parseInviteToken(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const queryStart = text.indexOf("?");
  if (queryStart === -1) return null;
  const hashStart = text.indexOf("#");
  // Must be a join route: either inside the hash fragment, or a router location like "/join?t=…".
  const beforeQuery = text.slice(0, queryStart);
  if (!/\/join$/.test(beforeQuery)) return null;
  if (hashStart > queryStart) return null;
  const params = new URLSearchParams(text.slice(queryStart + 1).split("#")[0]);
  const token = params.get("t");
  return token && token.length > 0 ? token : null;
}

/** Uppercases, converts Persian digits and removes everything that is not part of the alphabet (spaces, dashes, …). */
export function normalizeShortCode(input: string): string {
  return normalizeDigits(input)
    .toUpperCase()
    .split("")
    .filter((ch) => SHORT_CODE_ALPHABET.includes(ch))
    .join("");
}

export function isValidShortCode(input: string): boolean {
  return normalizeShortCode(input).length === SHORT_CODE_LENGTH;
}

/** "ABCD2345" → "ABCD-2345" (display form). Incomplete input is grouped as far as it goes. */
export function formatShortCode(input: string): string {
  const code = normalizeShortCode(input).slice(0, SHORT_CODE_LENGTH);
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** The text of a share message carrying the link and the short code. */
export function buildInviteMessage(appName: string, eventTitle: string, memberName: string, url: string, shortCode: string): string {
  return `${memberName} عزیز، به ایونت «${eventTitle}» در برنامه‌ی ${appName} دعوت شده‌اید.\nلینک دعوت: ${url}\nکد دعوت: ${formatShortCode(shortCode)}`;
}
