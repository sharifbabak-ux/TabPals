/** Label for the small sync indicator on online events (docs/PLAN.md "Sync status UI"). Pure. */
export interface SyncStatusInput {
  /** Socket currently connected. */
  connected: boolean;
  /** A push or catch-up is running right now. */
  syncing: boolean;
  /** Ops waiting in the outbox (excluding rejected). */
  pending: number;
  /** Ops the server rejected. */
  rejected: number;
  /** Browser reports it is offline. */
  browserOffline?: boolean;
}

export type SyncStatusKind = "online" | "offline" | "syncing" | "queued";

export interface SyncStatusView {
  kind: SyncStatusKind;
  label: string;
  hasRejected: boolean;
}

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
function toPersian(n: number): string {
  return String(n).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

export function describeSyncStatus(input: SyncStatusInput): SyncStatusView {
  const hasRejected = input.rejected > 0;
  if (input.pending > 0 && (!input.connected || input.browserOffline)) {
    return { kind: "queued", label: `${toPersian(input.pending)} تغییر در صف`, hasRejected };
  }
  if (input.syncing) return { kind: "syncing", label: "در حال همگام‌سازی", hasRejected };
  if (input.pending > 0) return { kind: "queued", label: `${toPersian(input.pending)} تغییر در صف`, hasRejected };
  if (!input.connected || input.browserOffline) return { kind: "offline", label: "آفلاین", hasRejected };
  return { kind: "online", label: "آنلاین", hasRejected };
}
