import { domToCanvas } from "modern-screenshot";
import { jsPDF } from "jspdf";
import { planPages, type PageAtom } from "@/domain/pagination";
import { toPersianDigits } from "@/domain/format";
import type { ExportOptions, ExportedFile, ExportService, QrImage } from "../types";

/** 2x capture for pixel-perfect Persian shaping (docs/PLAN.md Stage 3C). */
const CAPTURE_SCALE = 2;
/** A4 height/width ratio — every page (PDF and image) is exactly this shape. */
const A4_ASPECT = 297 / 210;
const JPEG_QUALITY = 0.85;
/** Fixed footer band reserved at the bottom of EVERY page (CSS px): page number, verification code, issuer and version. Content never enters it. */
const FOOTER_CSS = 40;
const FOOTER_SIDE_PAD_CSS = 24;
/** Breathing room under the repeated page header. */
const HEADER_GAP_CSS = 8;

async function waitForFonts(): Promise<void> {
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface LinkArea extends Rect {
  url: string;
}

/** One keep-together unit in CSS px relative to the captured element: a whole section or a single table row (with its note row). */
interface Atom {
  top: number;
  bottom: number;
  /** The table header to redraw above this atom when it starts a continuation page. */
  repeat?: { top: number; height: number };
}

interface Layout {
  widthCss: number;
  heightCss: number;
  headerHeightCss: number;
  atoms: Atom[];
  qr: Rect | null;
  links: LinkArea[];
  verificationCode: string;
  appVersion: string;
}

interface PlannedRange {
  atomIndexes: number[];
  /** Source CSS-px range in the capture (page 1 starts at 0 so it includes the header). */
  topCss: number;
  bottomCss: number;
  repeatHeader: boolean;
  repeat: { top: number; height: number } | null;
  /** Where (CSS px from the top of the page) the source range is drawn. */
  bodyStartCss: number;
}

function relativeRect(el: Element, container: DOMRect): Rect {
  const rect = el.getBoundingClientRect();
  return { top: rect.top - container.top, left: rect.left - container.left, width: rect.width, height: rect.height };
}

/** Splits every `[data-export-block]` into atoms: tables become one atom per row (with its note row), everything else stays whole. */
function collectAtoms(element: HTMLElement, container: DOMRect): Atom[] {
  const tops: { top: number; repeat?: Atom["repeat"] }[] = [];
  let lastBottom = 0;

  for (const block of Array.from(element.querySelectorAll<HTMLElement>("[data-export-block]"))) {
    const blockRect = relativeRect(block, container);
    lastBottom = Math.max(lastBottom, blockRect.top + blockRect.height);

    const table = block.querySelector("table");
    const rows = table ? Array.from(table.querySelectorAll("tbody > tr")) : [];
    if (!table || rows.length === 0) {
      tops.push({ top: blockRect.top });
      continue;
    }

    const thead = table.querySelector("thead");
    const repeat = thead ? (({ top, height }) => ({ top, height }))(relativeRect(thead, container)) : undefined;

    // Group each data row with the note row that follows it.
    const groups: { top: number; bottom: number }[] = [];
    for (const row of rows) {
      const r = relativeRect(row, container);
      if (row.classList.contains("statement-table__note-row") && groups.length > 0) {
        groups[groups.length - 1].bottom = r.top + r.height;
      } else {
        groups.push({ top: r.top, bottom: r.top + r.height });
      }
    }

    // The first atom carries the section heading and the table header with the first row.
    tops.push({ top: blockRect.top });
    for (let i = 1; i < groups.length; i++) tops.push({ top: groups[i].top, repeat });
    // Anything after the last row (totals, trailing paragraphs) is its own atom.
    const last = groups[groups.length - 1];
    if (blockRect.top + blockRect.height - last.bottom > 0.5) tops.push({ top: last.bottom, repeat: table.querySelector("tfoot") ? repeat : undefined });
  }

  return tops.map((entry, index) => ({ top: entry.top, bottom: index + 1 < tops.length ? tops[index + 1].top : lastBottom, repeat: entry.repeat }));
}

function collectLayout(element: HTMLElement): Layout {
  const container = element.getBoundingClientRect();
  const header = element.querySelector<HTMLElement>("[data-export-header]");
  const qrEl = element.querySelector<HTMLElement>("[data-export-qr]");

  const links = Array.from(element.querySelectorAll<HTMLElement>("[data-export-link][data-href]")).map((el) => ({
    ...relativeRect(el, container),
    url: el.dataset.href as string
  }));

  return {
    widthCss: container.width,
    heightCss: container.height,
    headerHeightCss: header ? header.getBoundingClientRect().height : 0,
    atoms: collectAtoms(element, container),
    qr: qrEl ? relativeRect(qrEl, container) : null,
    links,
    verificationCode: element.dataset.exportVerification ?? "",
    appVersion: element.dataset.exportAppVersion ?? ""
  };
}

/** Plans the pages: fixed footer reserved on every page, keep-together atoms, header repeated after the first page. */
function planRanges(layout: Layout): PlannedRange[] {
  const { atoms, widthCss, headerHeightCss } = layout;
  const pageHeightCss = widthCss * A4_ASPECT;

  if (atoms.length === 0) {
    return [{ atomIndexes: [], topCss: 0, bottomCss: layout.heightCss, repeatHeader: false, repeat: null, bodyStartCss: 0 }];
  }

  // Page 1 keeps everything above the first atom (the header block); later pages redraw the header + a gap — reserve the larger of the two everywhere.
  const headerBand = Math.max(atoms[0].top, headerHeightCss + HEADER_GAP_CSS);
  const capacity = Math.max(pageHeightCss - FOOTER_CSS - headerBand, pageHeightCss * 0.4);

  const pageAtoms: PageAtom[] = atoms.map((atom) => ({ height: atom.bottom - atom.top, repeatHeight: atom.repeat?.height }));
  return planPages(pageAtoms, capacity).map((page, pageIndex) => {
    const first = atoms[page.atoms[0]];
    const last = atoms[page.atoms[page.atoms.length - 1]];
    const repeatHeader = pageIndex > 0;
    const repeat = repeatHeader && page.repeatHeight > 0 ? (first.repeat ?? null) : null;
    return {
      atomIndexes: page.atoms,
      topCss: pageIndex === 0 ? 0 : first.top,
      bottomCss: last.bottom,
      repeatHeader,
      repeat,
      bodyStartCss: pageIndex === 0 ? 0 : headerHeightCss + HEADER_GAP_CSS + (repeat ? repeat.height : 0)
    };
  });
}

interface Capture {
  canvas: HTMLCanvasElement;
  layout: Layout;
  ranges: PlannedRange[];
}

/** Captures the element once at full resolution (with the QR slot hidden — it is drawn later as a lossless image) and plans the pages. */
async function captureAndPlanPages(element: HTMLElement): Promise<Capture> {
  await waitForFonts();
  const layout = collectLayout(element);
  const qrEl = element.querySelector<HTMLElement>("[data-export-qr]");
  const previousVisibility = qrEl?.style.visibility ?? "";
  if (qrEl) qrEl.style.visibility = "hidden";
  let canvas: HTMLCanvasElement;
  try {
    canvas = await domToCanvas(element, { scale: CAPTURE_SCALE, backgroundColor: "#ffffff" });
  } finally {
    if (qrEl) qrEl.style.visibility = previousVisibility;
  }
  return { canvas, layout, ranges: planRanges(layout) };
}

function drawFooter(ctx: CanvasRenderingContext2D, widthPx: number, heightPx: number, pageNumber: number, total: number, layout: Layout): void {
  const bandPx = FOOTER_CSS * CAPTURE_SCALE;
  const top = heightPx - bandPx;
  const pad = FOOTER_SIDE_PAD_CSS * CAPTURE_SCALE;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, top, widthPx, bandPx);
  ctx.fillStyle = "#bbbbbb";
  ctx.fillRect(pad, top, widthPx - 2 * pad, CAPTURE_SCALE);

  ctx.fillStyle = "#333333";
  ctx.font = `${12 * CAPTURE_SCALE}px Vazirmatn, sans-serif`;
  ctx.direction = "rtl";
  ctx.textBaseline = "middle";
  const middle = top + bandPx / 2 + CAPTURE_SCALE;

  ctx.textAlign = "right";
  if (layout.verificationCode) ctx.fillText(`کد اعتبارسنجی: ${layout.verificationCode}`, widthPx - pad, middle);
  ctx.textAlign = "center";
  ctx.fillText(`(${toPersianDigits(pageNumber)} از ${toPersianDigits(total)})`, widthPx / 2, middle);
  ctx.textAlign = "left";
  ctx.fillText(`صادرشده توسط TabPals${layout.appVersion ? ` · نسخه ${toPersianDigits(layout.appVersion)}` : ""}`, pad, middle);
}

/** Slices the one full-resolution capture into fixed A4-shaped page canvases: repeated header + table header, body slice, fixed footer. */
function buildPageCanvases(capture: Capture): HTMLCanvasElement[] {
  const { canvas, layout, ranges } = capture;
  const widthPx = Math.round(layout.widthCss * CAPTURE_SCALE);
  const heightPx = Math.round(layout.widthCss * A4_ASPECT * CAPTURE_SCALE);
  const px = (css: number) => Math.round(css * CAPTURE_SCALE);

  return ranges.map((range, index) => {
    const page = document.createElement("canvas");
    page.width = widthPx;
    page.height = heightPx;
    const ctx = page.getContext("2d");
    if (!ctx) throw new Error("پردازش تصویر پشتیبانی نمی‌شود");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, widthPx, heightPx);

    let y = 0;
    if (range.repeatHeader) {
      ctx.drawImage(canvas, 0, 0, widthPx, px(layout.headerHeightCss), 0, 0, widthPx, px(layout.headerHeightCss));
      y = px(layout.headerHeightCss + HEADER_GAP_CSS);
      if (range.repeat) {
        ctx.drawImage(canvas, 0, px(range.repeat.top), widthPx, px(range.repeat.height), 0, y, widthPx, px(range.repeat.height));
        y += px(range.repeat.height);
      }
    }
    const sourceTop = px(range.topCss);
    const sliceHeight = Math.max(1, Math.min(px(range.bottomCss) - sourceTop, canvas.height - sourceTop));
    ctx.drawImage(canvas, 0, sourceTop, widthPx, sliceHeight, 0, y, widthPx, sliceHeight);

    drawFooter(ctx, widthPx, heightPx, index + 1, ranges.length, layout);
    return page;
  });
}

/** Where (page-relative CSS px) a rect from the capture lands on a page, or null when it isn't on that page. */
function placeOnPage(rect: Rect, range: PlannedRange): Rect | null {
  if (rect.top < range.topCss - 0.5 || rect.top + rect.height > range.bottomCss + 1) return null;
  return { ...rect, top: range.bodyStartCss + rect.top - range.topCss };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("خروجی گرفتن از تصویر ناموفق بود"))), type, quality);
  });
}

/** Draws the QR 1:1 with smoothing off, centered in its slot — after the page is composed, so it is never resampled or lossily compressed. */
function drawQr(page: HTMLCanvasElement, qr: QrImage, slot: Rect): void {
  const ctx = page.getContext("2d");
  if (!ctx) return;
  const source = document.createElement("canvas");
  source.width = qr.sizePx;
  source.height = qr.sizePx;
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) return;
  sourceCtx.putImageData(new ImageData(qr.rgba as Uint8ClampedArray<ArrayBuffer>, qr.sizePx, qr.sizePx), 0, 0);

  const x = Math.round(slot.left * CAPTURE_SCALE + (slot.width * CAPTURE_SCALE - qr.sizePx) / 2);
  const y = Math.round(slot.top * CAPTURE_SCALE + (slot.height * CAPTURE_SCALE - qr.sizePx) / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, x, y, qr.sizePx, qr.sizePx);
}

export class WebExportService implements ExportService {
  async exportPdf(element: HTMLElement, filenameBase: string, options: ExportOptions = {}): Promise<ExportedFile> {
    const capture = await captureAndPlanPages(element);
    const pages = buildPageCanvases(capture);

    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidthMm = pdf.internal.pageSize.getWidth();
    const pageHeightMm = pdf.internal.pageSize.getHeight();
    const mmPerCssPx = pageWidthMm / capture.layout.widthCss;

    pages.forEach((pageCanvas, index) => {
      if (index > 0) pdf.addPage();
      // The page capture is lossy JPEG; the QR below is a separate lossless PNG on top of it.
      pdf.addImage(pageCanvas.toDataURL("image/jpeg", JPEG_QUALITY), "JPEG", 0, 0, pageWidthMm, pageHeightMm);

      const range = capture.ranges[index];
      for (const area of capture.layout.links) {
        const placed = placeOnPage(area, range);
        if (placed) pdf.link(placed.left * mmPerCssPx, placed.top * mmPerCssPx, placed.width * mmPerCssPx, placed.height * mmPerCssPx, { url: area.url });
      }

      const qrSlot = capture.layout.qr && options.qr ? placeOnPage(capture.layout.qr, range) : null;
      if (options.qr && qrSlot) {
        const sizeMm = (options.qr.sizePx / CAPTURE_SCALE) * mmPerCssPx;
        const x = (qrSlot.left + qrSlot.width / 2) * mmPerCssPx - sizeMm / 2;
        const y = (qrSlot.top + qrSlot.height / 2) * mmPerCssPx - sizeMm / 2;
        pdf.addImage(options.qr.dataUrl, "PNG", x, y, sizeMm, sizeMm, undefined, "NONE");
      }
    });

    const blob = pdf.output("blob");
    return { blob, filename: `${filenameBase}.pdf`, mimeType: "application/pdf" };
  }

  async exportImages(element: HTMLElement, filenameBase: string, options: ExportOptions = {}): Promise<ExportedFile[]> {
    const capture = await captureAndPlanPages(element);
    const pages = buildPageCanvases(capture);
    const total = pages.length;

    const files: ExportedFile[] = [];
    for (let i = 0; i < pages.length; i++) {
      const slot = capture.layout.qr && options.qr ? placeOnPage(capture.layout.qr, capture.ranges[i]) : null;
      if (options.qr && slot) drawQr(pages[i], options.qr, slot);
      // Lossless PNG: no compression pass can blur the QR (docs/PLAN.md GO-1.1).
      const blob = await canvasToBlob(pages[i], "image/png");
      const suffix = total > 1 ? `-${i + 1}` : "";
      files.push({ blob, filename: `${filenameBase}${suffix}.png`, mimeType: "image/png" });
    }
    return files;
  }
}
