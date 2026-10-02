/**
 * File naming for exported statements (docs/PLAN.md Stage 3C):
 * "TabPals-<event>-<member>-<number>.<ext>", Persian allowed but sanitized
 * of characters that are illegal (or awkward) in a filename on any of the
 * platforms this app targets.
 */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;

export function sanitizeFilenamePart(input: string): string {
  return input.replace(ILLEGAL_FILENAME_CHARS, "").replace(/\s+/g, " ").trim();
}

/** The filename without its extension, e.g. "TabPals-سفر شمال-آرش ای-3" — used as-is when a filename has no single extension (a multi-page image export). */
export function buildStatementExportFilenameBase(eventTitle: string, memberLabel: string, number: number): string {
  const parts = ["TabPals", sanitizeFilenamePart(eventTitle), sanitizeFilenamePart(memberLabel), String(number)].filter((p) => p.length > 0);
  return parts.join("-");
}

export function buildStatementExportFilename(eventTitle: string, memberLabel: string, number: number, extension: string): string {
  return `${buildStatementExportFilenameBase(eventTitle, memberLabel, number)}.${extension}`;
}
