/** Tiny pub/sub so the repository layer can nudge the sync engine without importing it (no import cycle, no engine in tests). */
type Listener = (localEventId: string) => void;

const outboxListeners = new Set<Listener>();

export function onOutboxChanged(listener: Listener): () => void {
  outboxListeners.add(listener);
  return () => outboxListeners.delete(listener);
}

/** Called after ops were queued for an event. Deferred so it never runs inside the writing transaction. */
export function signalOutboxChanged(localEventId: string): void {
  if (outboxListeners.size === 0) return;
  setTimeout(() => outboxListeners.forEach((listener) => listener(localEventId)), 0);
}
