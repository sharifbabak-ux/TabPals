import { describe, expect, it } from "vitest";
import { isEventClosed } from "./eventStatus";

describe("isEventClosed", () => {
  it("is open when there is no closedAt and no endDate", () => {
    expect(isEventClosed({}, new Date(2025, 8, 28))).toBe(false);
  });

  it("is closed when closedAt is set, regardless of dates", () => {
    expect(isEventClosed({ closedAt: "2025-09-01T10:00:00.000Z", endDate: "2099-01-01" }, new Date(2025, 8, 28))).toBe(true);
  });

  it("is open when today is before the end date", () => {
    expect(isEventClosed({ endDate: "2025-10-01" }, new Date(2025, 8, 28))).toBe(false);
  });

  it("is open on the end date itself, until end of day", () => {
    const endDate = "2025-09-28";
    expect(isEventClosed({ endDate }, new Date(2025, 8, 28, 0, 0, 0))).toBe(false);
    expect(isEventClosed({ endDate }, new Date(2025, 8, 28, 23, 59, 59, 999))).toBe(false);
  });

  it("is closed the instant after the end date's day passes", () => {
    const endDate = "2025-09-28";
    expect(isEventClosed({ endDate }, new Date(2025, 8, 29, 0, 0, 0, 0))).toBe(true);
  });

  it("reopening after the auto-close moment keeps the event open past the end date", () => {
    const endDate = "2025-09-28";
    const reopenedAt = new Date(2025, 8, 30, 12, 0, 0).toISOString();
    expect(isEventClosed({ endDate, reopenedAt }, new Date(2025, 9, 5))).toBe(false);
  });

  it("ignores a stale reopenedAt from before the closing moment (an old cycle)", () => {
    const endDate = "2025-09-28";
    const staleReopenedAt = new Date(2025, 8, 20, 12, 0, 0).toISOString();
    expect(isEventClosed({ endDate, reopenedAt: staleReopenedAt }, new Date(2025, 9, 5))).toBe(true);
  });

  it("closes again once closedAt is set after a reopen", () => {
    const endDate = "2025-09-28";
    const reopenedAt = new Date(2025, 8, 30, 12, 0, 0).toISOString();
    const closedAt = new Date(2025, 9, 2, 9, 0, 0).toISOString();
    expect(isEventClosed({ endDate, reopenedAt, closedAt }, new Date(2025, 9, 5))).toBe(true);
  });
});
