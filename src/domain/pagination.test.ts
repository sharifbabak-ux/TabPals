import { describe, expect, it } from "vitest";
import { computePageBreaks } from "./pagination";

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
