import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { WaiterItem } from "@/domain/groupOrder";
import { exportService } from "@/platform";
import type { ExportedFile } from "@/platform/types";
import { WaiterListPaper } from "./WaiterListPaper";

const OFFSCREEN_WIDTH_PX = 800;

/** Renders the waiter list off-screen and exports it as PNG page(s) with the shared export service (same approach as the statements' bulk export). */
export async function captureWaiterListImages(title: string, items: WaiterItem[], filenameBase: string): Promise<ExportedFile[]> {
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
      createElement(WaiterListPaper, {
        title,
        items,
        ref: (el: HTMLDivElement | null) => {
          paperEl = el;
          if (el) resolve();
        }
      })
    );
  });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    if (!paperEl) return [];
    return await exportService.exportImages(paperEl, filenameBase);
  } finally {
    root.unmount();
    container.remove();
  }
}
