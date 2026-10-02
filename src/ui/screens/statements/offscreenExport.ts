import { createRoot } from "react-dom/client";
import { createElement } from "react";
import type { Statement } from "@/data/types";
import type { ExportedFile } from "@/platform/types";
import { exportService } from "@/platform";
import { APP_VERSION } from "@/config/app";
import { StatementPaper, type StatementPaperMeta } from "./StatementPaper";
import type { StatementLinkData } from "@/domain/statementLink";

/** The `StatementPaper` meta a `Statement` record maps to, for the offscreen export render. */
export function statementPaperMeta(statement: Statement): StatementPaperMeta {
  return {
    number: statement.number,
    issueVersion: statement.issueVersion,
    issuedAt: statement.issuedAt,
    verificationCode: statement.verificationCode,
    status: statement.status,
    appVersion: APP_VERSION
  };
}

const OFFSCREEN_WIDTH_PX = 800;

/**
 * Renders one statement's `<StatementPaper>` off-screen (docs/PLAN.md Stage
 * 3C bulk sending: exporting several members' statements has no single
 * on-screen element to capture, unlike StatementViewScreen's own send
 * menu) and exports it, then tears the offscreen render down.
 */
export async function captureStatementFilesOffscreen(
  data: StatementLinkData,
  meta: StatementPaperMeta,
  kind: "pdf" | "image",
  filenameBase: string
): Promise<ExportedFile[]> {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "-10000px";
  container.style.width = `${OFFSCREEN_WIDTH_PX}px`;
  container.setAttribute("aria-hidden", "true");
  document.body.appendChild(container);

  const root = createRoot(container);
  let paperEl: HTMLElement | null = null;

  await new Promise<void>((resolve) => {
    root.render(
      createElement(StatementPaper, {
        data,
        meta,
        innerRef: (el: HTMLElement | null) => {
          paperEl = el;
          if (el) resolve();
        }
      })
    );
  });

  // Let layout settle after the initial commit before measuring/capturing.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    if (!paperEl) return [];
    (paperEl as HTMLElement).setAttribute("data-exporting", "true");
    return kind === "pdf" ? [await exportService.exportPdf(paperEl, filenameBase)] : await exportService.exportImages(paperEl, filenameBase);
  } finally {
    root.unmount();
    container.remove();
  }
}
