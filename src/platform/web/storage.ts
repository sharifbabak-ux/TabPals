const STORAGE_PERSIST_REQUESTED_KEY = "tabpal:storagePersistRequested";

/**
 * Requests persistent storage from the browser so the OS won't evict
 * IndexedDB data under storage pressure. Only actually asks once per
 * device (on first launch) — safe to call on every app boot.
 */
export async function requestPersistentStorageOnce(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return;
  if (localStorage.getItem(STORAGE_PERSIST_REQUESTED_KEY)) return;

  try {
    await navigator.storage.persist();
  } finally {
    localStorage.setItem(STORAGE_PERSIST_REQUESTED_KEY, "1");
  }
}
