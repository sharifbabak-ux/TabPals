/**
 * Pure page-break planning shared by PDF and image export (docs/PLAN.md
 * Stage 3C): given the heights of a document's section/row-level blocks in
 * source order, greedily groups them into pages no taller than
 * `pageHeight` without ever splitting a block. A single block taller than
 * `pageHeight` still gets its own (overflowing) page rather than being cut.
 */
export function computePageBreaks(blockHeights: number[], pageHeight: number): number[][] {
  if (blockHeights.length === 0) return [];

  const pages: number[][] = [];
  let currentPage: number[] = [];
  let currentHeight = 0;

  blockHeights.forEach((height, index) => {
    if (currentPage.length > 0 && currentHeight + height > pageHeight) {
      pages.push(currentPage);
      currentPage = [];
      currentHeight = 0;
    }
    currentPage.push(index);
    currentHeight += height;
  });

  if (currentPage.length > 0) pages.push(currentPage);
  return pages;
}

/**
 * A keep-together unit for export pagination (GO-1.1): a whole section
 * (payment box, closing box, QR block, …) or one table row (with its note
 * row). `repeatHeight` is the table header that must be redrawn above this
 * atom whenever it starts a continuation page — omitted for non-table atoms
 * and for the atom that already contains its table's header.
 */
export interface PageAtom {
  height: number;
  repeatHeight?: number;
}

export interface PlannedPage {
  /** Indexes of the atoms on this page, in order. */
  atoms: number[];
  /** Height of the repeated table header drawn at the top of the body (0 when none). */
  repeatHeight: number;
}

/**
 * Greedy packing of keep-together atoms into pages of `capacity` (the page
 * height minus the fixed footer and, via the caller, the repeated page
 * header). An atom is never split: if it doesn't fit it moves whole to the
 * next page, and an atom taller than a whole page still gets its own page.
 * A page that starts in the middle of a table reserves room for that
 * table's header.
 */
export function planPages(atoms: PageAtom[], capacity: number): PlannedPage[] {
  const pages: PlannedPage[] = [];
  let current: PlannedPage | null = null;
  let used = 0;

  atoms.forEach((atom, index) => {
    if (current && used + atom.height > capacity) {
      pages.push(current);
      current = null;
    }
    if (!current) {
      const repeat = pages.length > 0 ? (atom.repeatHeight ?? 0) : 0;
      current = { atoms: [], repeatHeight: repeat };
      used = repeat;
    }
    current.atoms.push(index);
    used += atom.height;
  });

  if (current) pages.push(current);
  return pages;
}
