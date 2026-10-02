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
