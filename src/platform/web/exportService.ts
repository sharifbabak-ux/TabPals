import { domToCanvas } from "modern-screenshot";
import { jsPDF } from "jspdf";
import { computePageBreaks } from "@/domain/pagination";
import { toPersianDigits } from "@/domain/format";
import type { ExportedFile, ExportService } from "../types";

/** 2x capture for pixel-perfect Persian shaping (docs/PLAN.md Stage 3C). */
const CAPTURE_SCALE = 2;
/** A4 height/width ratio — every page (PDF and image) is cropped to this shape. */
const A4_ASPECT = 297 / 210;
const IMAGE_WIDTH = 1080;
const JPEG_QUALITY = 0.85;

async function waitForFonts(): Promise<void> {
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }
}

interface PageRange {
  /** CSS-px offset (relative to the captured element) where this page's body content starts. */
  topCss: number;
  bottomCss: number;
  /** Whether the repeated header must be drawn at the top of this page (every page after the first). */
  repeatHeader: boolean;
}

interface LinkArea {
  url: string;
  /** CSS-px rect relative to the captured element. */
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Capture {
  linkAreas: LinkArea[];
  canvas: HTMLCanvasElement;
  containerWidthCss: number;
  headerHeightCss: number;
  ranges: PageRange[];
}

/** Captures the element once at full resolution and plans page breaks at its `[data-export-block]` boundaries — never cutting one, and repeating `[data-export-header]` on every page after the first (see ExportService's doc comment). */
async function captureAndPlanPages(element: HTMLElement): Promise<Capture> {
  await waitForFonts();
  const canvas = await domToCanvas(element, { scale: CAPTURE_SCALE, backgroundColor: "#ffffff" });

  const containerRect = element.getBoundingClientRect();
  const header = element.querySelector<HTMLElement>("[data-export-header]");
  const headerHeightCss = header ? header.getBoundingClientRect().height : 0;

  const blocks = Array.from(element.querySelectorAll<HTMLElement>("[data-export-block]"));
  const blockRects = blocks.map((block) => {
    const rect = block.getBoundingClientRect();
    return { top: rect.top - containerRect.top, height: rect.height };
  });

  const pageHeightCss = containerRect.width * A4_ASPECT;
  const bodyHeightCss = Math.max(pageHeightCss - headerHeightCss, pageHeightCss * 0.5);

  const ranges: PageRange[] = [];
  if (blockRects.length === 0) {
    ranges.push({ topCss: 0, bottomCss: containerRect.height, repeatHeader: false });
  } else {
    const groups = computePageBreaks(
      blockRects.map((b) => b.height),
      bodyHeightCss
    );
    groups.forEach((group, pageIndex) => {
      const first = blockRects[group[0]];
      const last = blockRects[group[group.length - 1]];
      ranges.push({
        topCss: pageIndex === 0 ? 0 : first.top,
        bottomCss: last.top + last.height,
        repeatHeader: pageIndex > 0
      });
    });
  }

  // Elements marked `data-export-link` (+ `data-href`) become clickable link annotations in the PDF.
  const linkAreas = Array.from(element.querySelectorAll<HTMLElement>("[data-export-link][data-href]")).map((el) => {
    const rect = el.getBoundingClientRect();
    return { url: el.dataset.href as string, top: rect.top - containerRect.top, left: rect.left - containerRect.left, width: rect.width, height: rect.height };
  });

  return { canvas, containerWidthCss: containerRect.width, headerHeightCss, ranges, linkAreas };
}

/** Slices the one full-resolution capture into per-page canvases, redrawing the header at the top of every page after the first. */
function buildPageCanvases(capture: Capture): HTMLCanvasElement[] {
  const { canvas, containerWidthCss, headerHeightCss, ranges } = capture;
  const widthPx = Math.round(containerWidthCss * CAPTURE_SCALE);
  const headerHeightPx = Math.round(headerHeightCss * CAPTURE_SCALE);

  return ranges.map((range) => {
    const bodyHeightPx = Math.max(1, Math.round((range.bottomCss - range.topCss) * CAPTURE_SCALE));
    const page = document.createElement("canvas");
    page.width = widthPx;
    page.height = (range.repeatHeader ? headerHeightPx : 0) + bodyHeightPx;

    const ctx = page.getContext("2d");
    if (!ctx) throw new Error("پردازش تصویر پشتیبانی نمی‌شود");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, page.width, page.height);

    let y = 0;
    if (range.repeatHeader) {
      ctx.drawImage(canvas, 0, 0, widthPx, headerHeightPx, 0, 0, widthPx, headerHeightPx);
      y = headerHeightPx;
    }
    ctx.drawImage(canvas, 0, Math.round(range.topCss * CAPTURE_SCALE), widthPx, bodyHeightPx, 0, y, widthPx, bodyHeightPx);
    return page;
  });
}

function resizeCanvas(source: HTMLCanvasElement, targetWidth: number): HTMLCanvasElement {
  const scale = targetWidth / source.width;
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("پردازش تصویر پشتیبانی نمی‌شود");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Stamps "(۱ از ۳)" in a small footer band — only when there's more than one page. */
function stampPageNumber(canvas: HTMLCanvasElement, pageNumber: number, total: number): void {
  if (total <= 1) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const label = `(${toPersianDigits(pageNumber)} از ${toPersianDigits(total)})`;
  const fontSize = Math.round(canvas.width * 0.022);
  const paddingBottom = Math.round(fontSize * 0.6);
  const boxHeight = fontSize + paddingBottom * 2;

  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillRect(0, canvas.height - boxHeight, canvas.width, boxHeight);
  ctx.fillStyle = "#333333";
  ctx.font = `${fontSize}px Vazirmatn, sans-serif`;
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, canvas.width / 2, canvas.height - paddingBottom);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("خروجی گرفتن از تصویر ناموفق بود"))), type, quality);
  });
}

export class WebExportService implements ExportService {
  async exportPdf(element: HTMLElement, filenameBase: string): Promise<ExportedFile> {
    const capture = await captureAndPlanPages(element);
    const pages = buildPageCanvases(capture);

    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidthMm = pdf.internal.pageSize.getWidth();

    const mmPerCssPx = pageWidthMm / capture.containerWidthCss;
    pages.forEach((pageCanvas, index) => {
      if (index > 0) pdf.addPage();
      const pageHeightMm = (pageCanvas.height / pageCanvas.width) * pageWidthMm;
      const dataUrl = pageCanvas.toDataURL("image/jpeg", JPEG_QUALITY);
      pdf.addImage(dataUrl, "JPEG", 0, 0, pageWidthMm, pageHeightMm);

      const range = capture.ranges[index];
      const headerOffsetCss = range.repeatHeader ? capture.headerHeightCss : 0;
      for (const area of capture.linkAreas) {
        if (area.top < range.topCss || area.top + area.height > range.bottomCss + 1) continue;
        pdf.link(area.left * mmPerCssPx, (headerOffsetCss + area.top - range.topCss) * mmPerCssPx, area.width * mmPerCssPx, area.height * mmPerCssPx, { url: area.url });
      }
    });

    const blob = pdf.output("blob");
    return { blob, filename: `${filenameBase}.pdf`, mimeType: "application/pdf" };
  }

  async exportImages(element: HTMLElement, filenameBase: string): Promise<ExportedFile[]> {
    const capture = await captureAndPlanPages(element);
    const pages = buildPageCanvases(capture);
    const total = pages.length;

    const files: ExportedFile[] = [];
    for (let i = 0; i < pages.length; i++) {
      const resized = resizeCanvas(pages[i], IMAGE_WIDTH);
      stampPageNumber(resized, i + 1, total);
      const blob = await canvasToBlob(resized, "image/jpeg", JPEG_QUALITY);
      const suffix = total > 1 ? `-${i + 1}` : "";
      files.push({ blob, filename: `${filenameBase}${suffix}.jpg`, mimeType: "image/jpeg" });
    }
    return files;
  }
}
