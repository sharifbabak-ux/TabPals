import { describe, expect, it } from "vitest";
import { computePageBreaks, planPages } from "./pagination";

describe("computePageBreaks", () => {
  it("returns no pages for an empty document", () => {
    expect(computePageBreaks([], 100)).toEqual([]);
  });

  it("fits everything on one page when it's short enough", () => {
    expect(computePageBreaks([30, 40, 20], 100)).toEqual([[0, 1, 2]]);
  });

  it("never splits a block across pages", () => {
    expect(computePageBreaks([60, 60, 60], 100)).toEqual([[0], [1], [2]]);
  });

  it("packs as many whole blocks per page as fit", () => {
    expect(computePageBreaks([30, 30, 30, 30], 100)).toEqual([
      [0, 1, 2],
      [3]
    ]);
  });

  it("gives a single block taller than the page its own page rather than cutting it", () => {
    expect(computePageBreaks([10, 150, 10], 100)).toEqual([[0], [1], [2]]);
  });
});

describe("planPages", () => {
  it("never splits an atom and moves a block that doesn't fit whole to the next page", () => {
    const pages = planPages([{ height: 60 }, { height: 50 }, { height: 30 }], 100);
    expect(pages.map((p) => p.atoms)).toEqual([[0], [1, 2]]);
  });

  it("repeats the table header on continuation pages and reserves room for it", () => {
    const rows = [{ height: 40 }, ...Array.from({ length: 4 }, () => ({ height: 30, repeatHeight: 20 }))];
    // page 1: 40 + 30 + 30 = 100 (fits); page 2 starts mid-table: 20 (header) + 30 + 30 = 80.
    const pages = planPages(rows, 100);
    expect(pages.map((p) => p.atoms)).toEqual([
      [0, 1, 2],
      [3, 4]
    ]);
    expect(pages[0].repeatHeight).toBe(0);
    expect(pages[1].repeatHeight).toBe(20);
  });

  it("counts the repeated header against the page capacity", () => {
    const pages = planPages([{ height: 90 }, { height: 45, repeatHeight: 20 }, { height: 45, repeatHeight: 20 }], 100);
    // 20 + 45 + 45 = 110 > 100, so the last row can't share the continuation page.
    expect(pages.map((p) => p.atoms)).toEqual([[0], [1], [2]]);
  });

  it("gives an oversized atom its own page instead of dropping it", () => {
    expect(planPages([{ height: 10 }, { height: 500 }, { height: 10 }], 100).map((p) => p.atoms)).toEqual([[0], [1], [2]]);
  });

  it("returns no pages for no atoms", () => {
    expect(planPages([], 100)).toEqual([]);
  });
});
