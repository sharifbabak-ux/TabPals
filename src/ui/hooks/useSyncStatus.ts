import { useEffect, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { syncEngine } from "@/data/online/syncEngine";
import { describeSyncStatus, type SyncStatusView } from "@/domain/syncStatus";

export interface SyncStatusInfo {
  view: SyncStatusView;
  pending: number;
  rejected: number;
  lastError: string | null;
  /** Initial upload progress, when the link is still "uploading". */
  upload: { done: number; total: number } | null;
}

function useBrowserOffline(): boolean {
  const [offline, setOffline] = useState(typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return offline;
}

/** Live sync state of an online event: socket/worker state from the engine, queue counts from the outbox. */
export function useSyncStatus(localEventId: string): SyncStatusInfo {
  // The engine state object is replaced on every change, so identity works as the snapshot.
  const state = useSyncExternalStore(
    (listener) => syncEngine.subscribe(listener),
    () => syncEngine.getState(localEventId)
  );
  const browserOffline = useBrowserOffline();
  const counts = useLiveQuery(async () => {
    const rows = await db.outbox.where("localEventId").equals(localEventId).toArray();
    const link = await db.onlineLinks.get(localEventId);
    const rejected = rows.filter((r) => r.rejected).length;
    return { pending: rows.length - rejected, rejected, uploadTotal: link?.status === "uploading" ? (link.uploadTotal ?? null) : null };
  }, [localEventId]);

  const pending = counts?.pending ?? 0;
  const rejected = counts?.rejected ?? 0;
  const view = describeSyncStatus({ connected: state.connected, syncing: state.syncing, pending, rejected, browserOffline });
  const upload = counts?.uploadTotal ? { total: counts.uploadTotal, done: Math.max(0, counts.uploadTotal - pending) } : null;
  return { view, pending, rejected, lastError: state.lastError, upload };
}

/** Counter that changes whenever the member/access picture of an event may have changed (member removed, roles changed, key received). */
export function useAccessRevision(localEventId: string): number {
  return useSyncExternalStore(
    (listener) => syncEngine.subscribe(listener),
    () => syncEngine.getState(localEventId).accessRevision
  );
}
