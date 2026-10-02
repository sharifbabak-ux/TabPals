/**
 * Group Order session state machine (docs/PLAN.md "Group Order").
 * draft → open → locked → pricing → finalized; open ↔ locked (the admin can
 * reopen); any non-finalized session can be cancelled (reason required);
 * finalized and cancelled are terminal.
 */
import type { OrderSessionStatus } from "@/data/types";

const TRANSITIONS: Record<OrderSessionStatus, OrderSessionStatus[]> = {
  draft: ["open", "cancelled"],
  open: ["locked", "cancelled"],
  locked: ["open", "pricing", "cancelled"],
  pricing: ["finalized", "cancelled"],
  finalized: [],
  cancelled: []
};

export function allowedTransitions(from: OrderSessionStatus): OrderSessionStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: OrderSessionStatus, to: OrderSessionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalStatus(status: OrderSessionStatus): boolean {
  return status === "finalized" || status === "cancelled";
}

/** Returns an error message, or null when the transition (with its optional cancel reason) is valid. */
export function validateTransition(from: OrderSessionStatus, to: OrderSessionStatus, cancelReason?: string): string | null {
  if (!canTransition(from, to)) return "این تغییر وضعیت برای نشست مجاز نیست.";
  if (to === "cancelled" && !(cancelReason ?? "").trim()) return "دلیل لغو الزامی است.";
  return null;
}

/** Whether order lines (items, quantities) may be changed — `source` other than the admin's device (members' packages/online) may only edit while the session is open. */
export function canEditLines(status: OrderSessionStatus, source: "admin-device" | "package" | "online" = "admin-device"): boolean {
  if (source !== "admin-device") return status === "open";
  return status === "open" || status === "locked" || status === "pricing";
}

/** Whether session details (title, menu, extras, payers, ...) may still be edited. */
export function canEditSession(status: OrderSessionStatus): boolean {
  return !isTerminalStatus(status);
}
