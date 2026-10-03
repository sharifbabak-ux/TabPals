/** Exponential backoff for the outbox worker (1 s, 2 s, 4 s … capped at 60 s). Pure; jitter is injected for testability. */
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;

export function backoffDelayMs(attempts: number, random: () => number = Math.random): number {
  const exponent = Math.min(Math.max(attempts, 0), 16);
  const raw = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
  // ±20 % jitter so many devices do not retry in lockstep.
  return Math.round(raw * (0.8 + random() * 0.4));
}

/** Splits queued items into batches of at most `maxOps` ops and roughly `maxBytes` of JSON each (an oversized single item still gets its own batch). */
export function chunkBySizeAndCount<T>(items: T[], size: (item: T) => number, maxOps = 500, maxBytes = 4_000_000): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const itemBytes = size(item);
    if (current.length > 0 && (current.length >= maxOps || bytes + itemBytes > maxBytes)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += itemBytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
