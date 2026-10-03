import { describe, expect, it } from "vitest";
import { backoffDelayMs, chunkBySizeAndCount } from "./syncBackoff";
import { describeSyncStatus } from "./syncStatus";

describe("backoff", () => {
  it("doubles from 1 s and caps at 60 s (jitter-free with random=0.5)", () => {
    const d = (n: number) => backoffDelayMs(n, () => 0.5);
    expect([d(0), d(1), d(2), d(3)]).toEqual([1000, 2000, 4000, 8000]);
    expect(d(10)).toBe(60_000);
    expect(d(99)).toBe(60_000);
  });
});

describe("chunking", () => {
  it("splits by count (≤ 500) and by size", () => {
    const items = Array.from({ length: 1200 }, (_, i) => i);
    expect(chunkBySizeAndCount(items, () => 10, 500).map((b) => b.length)).toEqual([500, 500, 200]);
    expect(chunkBySizeAndCount([1, 2, 3, 4], () => 600, 500, 1000).map((b) => b.length)).toEqual([1, 1, 1, 1]);
    expect(chunkBySizeAndCount([], () => 1)).toEqual([]);
  });
});

describe("sync status label", () => {
  it("maps state to the Persian indicator", () => {
    expect(describeSyncStatus({ connected: true, syncing: false, pending: 0, rejected: 0 }).label).toBe("آنلاین");
    expect(describeSyncStatus({ connected: false, syncing: false, pending: 0, rejected: 0 }).label).toBe("آفلاین");
    expect(describeSyncStatus({ connected: true, syncing: true, pending: 3, rejected: 0 }).label).toBe("در حال همگام‌سازی");
    expect(describeSyncStatus({ connected: false, syncing: false, pending: 3, rejected: 0 }).label).toBe("۳ تغییر در صف");
    expect(describeSyncStatus({ connected: true, syncing: false, pending: 2, rejected: 1 })).toMatchObject({ label: "۲ تغییر در صف", hasRejected: true });
  });
});
