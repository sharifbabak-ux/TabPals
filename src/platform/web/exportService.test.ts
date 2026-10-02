import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { flushSync } from "react-dom";
import jsQR from "jsqr";
import { jsPDF } from "jspdf";
import { PNG } from "pngjs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installFakeCanvas, type FakeCanvas } from "@/test/fakeCanvas";
import type { Statement } from "@/data/types";
import { buildStatementLink, buildSummaryLink, decodeSharedPayload, type StatementLinkData, type StatementLinkPayload } from "@/domain/statementLink";
import { StatementPaper } from "@/ui/screens/statements/StatementPaper";
import { buildStatementShareLink } from "@/ui/screens/statements/sendActions";
import { statementPaperMeta } from "@/ui/screens/statements/offscreenExport";
import { WebExportService } from "./exportService";

const capture = vi.hoisted(() => ({ heightCss: 0 }));

vi.mock("modern-screenshot", () => ({
  // The full-resolution page capture: a white 2× canvas as tall as the synthetic layout.
  domToCanvas: vi.fn(async () => {
    const { whiteCanvas: make } = await import("@/test/fakeCanvas");
    return make(1600, capture.heightCss * 2);
  })
}));

const PAGE_W = 800;
const FOOTER_PX = 80; // FOOTER_CSS (40) × capture scale (2)

function memberData(expenseCount: number): StatementLinkData {
  const expenses = Array.from({ length: expenseCount }, (_, i) => ({
    voucherNumber: i + 1,
    expenseDate: "2025-01-01",
    description: `هزینه ${i + 1}`,
    totalAmount: 1000,
    splitExplanation: "سهم مساوی",
    share: 500,
    paid: 0,
    participantNames: ["آرش", "بهار"]
  }));
  return {
    kind: "member",
    event: { title: "سفر شمال", currency: "تومان" },
    member: { personId: "p1", name: "آرش", firstName: "آرش", lastName: "احمدی" },
    expenses,
    expenseTotals: { totalAmount: expenseCount * 1000, totalShare: expenseCount * 500, totalPaid: 0 },
    fundEntries: [],
    summary: { personId: "p1", expenseShare: expenseCount * 500, expensePaid: 0, contributedToFund: 0, receivedAsTreasurer: 0, settlementsPaid: 0, settlementsReceived: 0, balance: -(expenseCount * 500) },
    treasurerName: "ترانه",
    treasurerCardNumberGrouped: "6037 9972 1234 5678",
    treasurerIbanGrouped: "IR12 0170 0000 0010 0123 4567 89",
    treasurerBankName: "ملی",
    treasurerAccountHolder: "ترانه تی",
    hubSettlement: null,
    closingText: "با تشکر از همراهی شما."
  };
}

const statement: Statement = {
  id: "st1",
  eventId: "e1",
  kind: "member",
  personId: "p1",
  number: 3,
  issueVersion: 1,
  issuedAt: "2025-01-05T08:00:00.000Z",
  snapshot: "{}",
  templateId: null,
  closingText: "با تشکر از همراهی شما.",
  verificationCode: "A1B2-C3D4",
  status: "current",
  sendLog: [],
  createdAt: "2025-01-05T08:00:00.000Z",
  updatedAt: "2025-01-05T08:00:00.000Z",
  deviceId: "d",
  version: 1,
  deleted: false
};

interface Geometry {
  rects: Map<Element, { top: number; left: number; width: number; height: number }>;
  total: number;
  keepTogether: { top: number; bottom: number; name: string }[];
  rows: { top: number; bottom: number }[];
  theadHeight: number;
}

/** Synthetic layout (jsdom has none): header, sections of fixed height, tables with one 30px row (+20px note) per data row. */
function layOut(article: HTMLElement, qrCssSize: number | null): Geometry {
  const rects = new Map<Element, { top: number; left: number; width: number; height: number }>();
  const set = (el: Element, top: number, height: number, left = 0, width = PAGE_W) => rects.set(el, { top, left, width, height });
  const geometry: Geometry = { rects, total: 0, keepTogether: [], rows: [], theadHeight: 30 };

  let y = 0;
  set(article.querySelector("[data-export-header]")!, 0, 120);
  y = 130;
  for (const block of Array.from(article.querySelectorAll<HTMLElement>("[data-export-block]"))) {
    const top = y;
    const table = block.querySelector("table");
    if (table) {
      y += 40;
      const thead = table.querySelector("thead");
      if (thead) set(thead, y, 30);
      y += 30;
      for (const tr of Array.from(table.querySelectorAll("tbody > tr"))) {
        const note = tr.classList.contains("statement-table__note-row");
        set(tr, y, note ? 20 : 30);
        if (!note) geometry.rows.push({ top: y, bottom: y + 30 });
        y += note ? 20 : 30;
      }
      const tfoot = table.querySelector("tfoot");
      if (tfoot) {
        set(tfoot, y, 30);
        y += 30;
      }
    } else if (block.querySelector("[data-export-qr]")) {
      const size = qrCssSize ?? 150;
      const qr = block.querySelector("[data-export-qr]")!;
      set(qr, top + 12, size, (PAGE_W - size) / 2, size);
      const link = block.querySelector("[data-export-link]")!;
      set(link, top + 12, size + 30, (PAGE_W - size) / 2, size);
      y += 12 + size + 30 + 12;
      geometry.keepTogether.push({ top, bottom: y, name: "qr" });
    } else {
      y += 150;
      geometry.keepTogether.push({ top, bottom: y, name: block.className || "section" });
    }
    set(block, top, y - top);
    y += 16;
  }
  geometry.total = y;
  set(article, 0, y);
  return geometry;
}

function render(data: StatementLinkData, link: Awaited<ReturnType<typeof buildStatementShareLink>>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(createElement(StatementPaper, { data, meta: statementPaperMeta(statement, link) })));
  const article = host.querySelector("article") as HTMLElement;
  const qrSize = link.qr ? link.qr.sizePx / 2 : null;
  const geometry = layOut(article, qrSize);
  capture.heightCss = geometry.total;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const r = geometry.rects.get(this) ?? { top: 0, left: 0, width: 0, height: 0 };
    return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON() {} } as DOMRect;
  };
  article.setAttribute("data-exporting", "true");
  return { article, geometry, cleanup: () => { root.unmount(); host.remove(); } };
}

function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function decodeQr(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): string | null {
  return jsQR(new Uint8ClampedArray(rgba), width, height)?.data ?? null;
}

function decodePngBytes(bytes: Uint8Array): { data: Uint8Array; width: number; height: number } {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { data: png.data, width: png.width, height: png.height };
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  return Uint8Array.from(Buffer.from(dataUrl.split(",")[1], "base64"));
}

const BASE = "http://localhost:3000/";
let expectedSummaryUrl = "";

function payloadFor(data: StatementLinkData): StatementLinkPayload {
  return {
    v: 1,
    statementId: statement.id,
    number: statement.number,
    issueVersion: statement.issueVersion,
    issuedAt: statement.issuedAt,
    verificationCode: statement.verificationCode,
    status: statement.status,
    appVersion: "0.7.1",
    data
  };
}

beforeAll(() => {
  installFakeCanvas();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("statement export: scannable QR, footer, keep-together pagination", () => {
  it("the QR encodes the compact summary link (≤ 300 chars) with correct raster properties", async () => {
    const data = memberData(40);
    const link = await buildStatementShareLink(statement, data, "سفر شمال");
    expectedSummaryUrl = buildSummaryLink(payloadFor(data), BASE).url;

    expect(link.qr).not.toBeNull();
    const qr = link.qr!;
    expect(expectedSummaryUrl.length).toBeLessThanOrEqual(300);
    expect(qr.modulePx).toBeGreaterThanOrEqual(4);
    expect(qr.sizePx).toBeGreaterThanOrEqual(300);
    expect(qr.sizePx).toBe((qr.moduleCount + 8) * qr.modulePx); // 4-module quiet zone each side
    // Quiet zone and colors: corners white, only black/white pixels.
    expect(qr.rgba[0]).toBe(255);
    expect(new Set(Array.from({ length: qr.sizePx * qr.sizePx }, (_, i) => qr.rgba[i * 4])).size).toBe(2);

    // The PNG is lossless and decodes to the expected summary URL.
    const png = decodePngBytes(dataUrlBytes(qr.dataUrl));
    expect(png.width).toBe(qr.sizePx);
    expect(decodeQr(png.data, png.width, png.height)).toBe(expectedSummaryUrl);

    const decoded = decodeSharedPayload(expectedSummaryUrl.split("#/s/")[1]);
    expect(decoded?.tier).toBe("summary");
    // The clickable link is the FULL link while it fits the size policy.
    const full = buildStatementLink(payloadFor(data), BASE);
    expect(link.url).toBe(full.url ?? expectedSummaryUrl);
  });

  it("image export: decodes the QR from the produced PNG pages at export resolution, fixed footer on every page", { timeout: 60000 }, async () => {
    const data = memberData(40);
    const link = await buildStatementShareLink(statement, data, "سفر شمال");
    const { article, geometry, cleanup } = render(data, link);

    const files = await new WebExportService().exportImages(article, "test", { qr: link.qr });
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.every((f) => f.mimeType === "image/png" && f.filename.endsWith(".png"))).toBe(true);

    const decodedPages = [];
    for (const file of files) {
      const png = decodePngBytes(await readBlob(file.blob));
      expect(png.width).toBe(1600);
      expect(png.height).toBe(Math.round(1600 * (297 / 210)));
      decodedPages.push(decodeQr(png.data, png.width, png.height));
    }
    // Exactly one page carries the QR, and it decodes to the expected summary link at ≥ 300 px.
    expect(decodedPages.filter((d) => d !== null)).toEqual([expectedSummaryUrl]);
    expect(link.qr!.sizePx).toBeGreaterThanOrEqual(300);
    expect(geometry.total).toBeGreaterThan(0);
    cleanup();
  });

  it("pagination: footer area reserved on every page, rows and boxes never split, headers repeat", { timeout: 60000 }, async () => {
    const data = memberData(40);
    const link = await buildStatementShareLink(statement, data, "سفر شمال");
    const { article, geometry, cleanup } = render(data, link);

    // Spy on the page canvases the service builds.
    const created: FakeCanvas[] = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "canvas") created.push(el as FakeCanvas);
      return el;
    }) as typeof document.createElement);

    await new WebExportService().exportImages(article, "test", { qr: link.qr });
    const pages = created.filter((c) => c.width === 1600 && c.height === Math.round(1600 * (297 / 210)));
    expect(pages.length).toBeGreaterThanOrEqual(2);

    const total = pages.length;
    pages.forEach((page, index) => {
      // Footer: page number, verification code, issuer + version.
      const texts = page.__texts.map((t) => t.text);
      expect(texts.some((t) => t.includes(`از ${total.toLocaleString("fa-IR")}`) || t.includes("از "))).toBe(true);
      expect(texts.find((t) => t.startsWith("("))).toBe(`(${(index + 1).toLocaleString("fa-IR")} از ${total.toLocaleString("fa-IR")})`);
      expect(texts.some((t) => t.includes("A1B2-C3D4"))).toBe(true);
      expect(texts.some((t) => t.includes("صادرشده توسط TabPals") && t.includes("نسخه"))).toBe(true);

      // Content stops above the reserved footer band.
      const bodyDraws = page.__draws.filter((d) => d.source.width === 1600 && d.source.height === geometry.total * 2);
      for (const draw of bodyDraws) expect(draw.dy + draw.dh).toBeLessThanOrEqual(page.height - FOOTER_PX);

      // The page header is redrawn on every continuation page.
      if (index > 0) expect(bodyDraws.some((d) => d.sy === 0 && d.sh === 120 * 2)).toBe(true);
    });

    // A page that starts in the middle of a table redraws that table's header.
    const continuationPages = pages.slice(1);
    expect(continuationPages.some((page) => page.__draws.some((d) => d.source.height === geometry.total * 2 && d.sh === geometry.theadHeight * 2 && d.sy > 0))).toBe(true);

    // Every keep-together block, and every table row, lies entirely inside ONE page slice.
    const slices = pages.flatMap((page) =>
      page.__draws
        .filter((d) => d.source.height === geometry.total * 2 && d.sh !== 120 * 2 && d.sh !== geometry.theadHeight * 2)
        .map((d) => ({ top: d.sy / 2, bottom: (d.sy + d.sh) / 2 }))
    );
    for (const unit of [...geometry.keepTogether, ...geometry.rows]) {
      const holders = slices.filter((s) => unit.top >= s.top - 0.5 && unit.bottom <= s.bottom + 0.5);
      expect(holders.length, `block ${"name" in unit ? unit.name : "row"} at ${unit.top}`).toBeGreaterThanOrEqual(1);
    }
    // The QR block (separate image on the page) is whole on the page that carries it.
    const qrBlock = geometry.keepTogether.find((b) => b.name === "qr")!;
    expect(slices.some((s) => qrBlock.top >= s.top - 0.5 && qrBlock.bottom <= s.bottom + 0.5)).toBe(true);
    cleanup();
  });

  it("pdf export: QR is a separate lossless PNG ≥ 35 mm on top of the JPEG page, decodable, with a working link annotation", { timeout: 60000 }, async () => {
    const data = memberData(40);
    const link = await buildStatementShareLink(statement, data, "سفر شمال");
    const { article, cleanup } = render(data, link);

    const api = jsPDF.API as unknown as { addImage: (...a: unknown[]) => jsPDF };
    const addImage = api.addImage;
    const calls: unknown[][] = [];
    vi.spyOn(api, "addImage").mockImplementation(function (this: jsPDF, ...args: unknown[]) {
      calls.push(args);
      // Only the real PNG goes through jsPDF; the fake JPEG bytes can't be parsed.
      return args[1] === "PNG" ? (addImage as (...a: unknown[]) => jsPDF).apply(this, args) : this;
    } as never);

    const pdf = await new WebExportService().exportPdf(article, "test", { qr: link.qr });
    expect(pdf.mimeType).toBe("application/pdf");

    const jpegCalls = calls.filter((c) => c[1] === "JPEG");
    const pngCalls = calls.filter((c) => c[1] === "PNG");
    expect(jpegCalls.length).toBeGreaterThanOrEqual(2);
    expect(pngCalls).toHaveLength(1);
    expect(pngCalls[0][0]).toBe(link.qr!.dataUrl);
    expect(pngCalls[0][4] as number).toBeGreaterThanOrEqual(35);
    expect(pngCalls[0][5] as number).toBeGreaterThanOrEqual(35);

    // Decode the lossless image that was added to the PDF.
    const png = decodePngBytes(dataUrlBytes(pngCalls[0][0] as string));
    expect(decodeQr(png.data, png.width, png.height)).toBe(expectedSummaryUrl);

    // Link annotation pointing at the full statement link, in the generated PDF.
    const bytes = await readBlob(pdf.blob);
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("/Subtype /Link");
    expect(text).toContain(`/URI (${link.url})`);

    // The embedded image XObject is the 1-bit QR (uncompressed, pixel-exact): read it back out of the PDF and decode it again.
    const widthMatch = new RegExp(`/Width ${link.qr!.sizePx}\\b`).exec(text);
    expect(widthMatch).not.toBeNull();
    const length = Number(/\/Length (\d+)/.exec(text.slice(widthMatch!.index))![1]);
    const start = text.indexOf("stream\n", widthMatch!.index) + "stream\n".length;
    const raw = bytes.subarray(start, start + length);
    const side = link.qr!.sizePx;
    const rowBytes = Math.ceil(side / 8);
    const rgba = new Uint8ClampedArray(side * side * 4);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const bit = (raw[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        rgba.set([v, v, v, 255], (y * side + x) * 4);
      }
    }
    expect(decodeQr(rgba, side, side)).toBe(expectedSummaryUrl);
    cleanup();
  });

  it("no raw URL text is rendered, only the «مشاهده‌ی نسخه‌ی آنلاین» label", async () => {
    const data = memberData(3);
    const link = await buildStatementShareLink(statement, data, "سفر شمال");
    const { article, cleanup } = render(data, link);
    expect(article.textContent).toContain("مشاهده‌ی نسخه‌ی آنلاین");
    expect(article.textContent).not.toContain("http");
    expect(article.textContent).not.toContain("#/s/");
    cleanup();
  });
});
