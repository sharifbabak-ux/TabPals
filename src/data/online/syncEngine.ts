/**
 * Sync engine for online events (docs/PLAN.md "Online architecture").
 *
 * Outbound: a per-event worker drains the outbox in batches (≤ 500 ops, ≤ ~4 MB)
 * with exponential backoff; accepted ops leave the queue, rejected ops are
 * kept with the server's reason. Inbound: a Socket.IO connection delivers
 * ops live; on every (re)connect and at app start the engine catches up via
 * `GET ops?after=lastSeq` until `hasMore` is false. All remote ops go
 * through `applyRemoteOperation`, which never re-queues them.
 *
 * Network and socket access is injected so the engine can be tested against
 * a mocked server and a mock socket.
 */
import { io } from "socket.io-client";
import { getApiBase } from "@/config/online";
import { backoffDelayMs, chunkBySizeAndCount } from "@/domain/syncBackoff";
import { onlineErrorMessage } from "@/domain/onlineErrors";
import { canWriteLedger } from "@/domain/onlinePermissions";
import { db as defaultDb, type TabPalDB } from "../db";
import type { OnlineLink, OnlineRole, OutboxEntry } from "../types";
import { api as defaultApi, ApiError, NetworkError, type PullResult, type RemoteOpEnvelope } from "./apiClient";
import { applyRemoteOperation } from "./applyRemoteOperation";
import { detachOnlineEvent, setOnlineNotice, wipeOnlineEvent } from "./localCleanup";
import { onOutboxChanged } from "./syncSignal";

/** The subset of a Socket.IO client the engine relies on. */
export interface SocketLike {
  connected: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
  close(): unknown;
}

export type SocketFactory = (baseUrl: string, token: string) => SocketLike;

export const defaultSocketFactory: SocketFactory = (baseUrl, token) =>
  io(baseUrl, { auth: { token }, transports: ["websocket", "polling"], reconnection: true }) as unknown as SocketLike;

export interface EventSyncState {
  connected: boolean;
  syncing: boolean;
  lastError: string | null;
}

export type RevokeReason = "device-revoked" | "event-purged" | "unauthorized";

export interface SyncEngineDeps {
  db: TabPalDB;
  api: Pick<typeof defaultApi, "pushOps" | "pullOps" | "me" | "addMember">;
  socketFactory: SocketFactory;
  apiBase: () => string;
}

const MAX_BATCH_OPS = 500;

function revokeMessage(reason: RevokeReason, title: string): string {
  switch (reason) {
    case "device-revoked":
      return `دسترسی این دستگاه به ایونت «${title}» قطع شد و نسخه‌ی محلی آن از این دستگاه حذف شد.`;
    case "event-purged":
      return `ایونت «${title}» توسط مدیر از سرور حذف شد و نسخه‌ی محلی آن از این دستگاه پاک شد.`;
    default:
      return `دسترسی شما به ایونت «${title}» دیگر معتبر نیست (ایونت حذف شده یا دسترسی قطع شده است)؛ نسخه‌ی محلی آن از این دستگاه حذف شد.`;
  }
}

export class SyncEngine {
  private deps: SyncEngineDeps;
  private sockets = new Map<string, SocketLike>();
  private states = new Map<string, EventSyncState>();
  private chains = new Map<string, Promise<unknown>>();
  /** Bumped by `detach`/`stop`: work queued before that point is dropped instead of running against a detached event. */
  private epochs = new Map<string, number>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private retryAttempts = new Map<string, number>();
  private expectedPurges = new Set<string>();
  private listeners = new Set<() => void>();
  private unsubscribeSignal: (() => void) | null = null;
  private windowHandler = () => this.fire(this.syncAll());
  private started = false;

  constructor(deps: Partial<SyncEngineDeps> = {}) {
    this.deps = {
      db: deps.db ?? defaultDb,
      api: deps.api ?? defaultApi,
      socketFactory: deps.socketFactory ?? defaultSocketFactory,
      apiBase: deps.apiBase ?? getApiBase
    };
  }

  /** Background work must never surface as an unhandled rejection (e.g. the DB closing under it); failures show up via `lastError` and retries. */
  private fire(work: Promise<unknown>): void {
    work.catch(() => undefined);
  }

  // --- lifecycle ----------------------------------------------------------

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.unsubscribeSignal = onOutboxChanged((id) => this.fire(this.flush(id)));
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.windowHandler);
      window.addEventListener("offline", this.notify);
    }
    const links = await this.deps.db.onlineLinks.toArray();
    for (const link of links) {
      if (link.status !== "revoked") this.attach(link.localEventId);
    }
  }

  /** Resolves when all work already running or queued has finished (used for graceful shutdown and in tests). */
  async idle(): Promise<void> {
    await Promise.all([...this.chains.values()]);
  }

  stop(): void {
    this.started = false;
    this.unsubscribeSignal?.();
    this.unsubscribeSignal = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.windowHandler);
      window.removeEventListener("offline", this.notify);
    }
    for (const id of [...this.sockets.keys()]) this.detach(id);
  }

  /** Starts syncing an event (connects its socket, catches up, drains the outbox). */
  attach(localEventId: string): void {
    if (this.sockets.has(localEventId)) return;
    this.fire((async () => {
      const link = await this.deps.db.onlineLinks.get(localEventId);
      if (!link || link.status === "revoked" || this.sockets.has(localEventId)) return;
      this.states.set(localEventId, { connected: false, syncing: false, lastError: null });
      let socket: SocketLike;
      try {
        socket = this.deps.socketFactory(this.deps.apiBase(), link.deviceToken);
      } catch {
        this.fire(this.syncNow(localEventId));
        return;
      }
      this.sockets.set(localEventId, socket);
      this.bindSocket(localEventId, socket);
      this.notify();
      this.fire(this.syncNow(localEventId));
    })());
  }

  detach(localEventId: string): void {
    const socket = this.sockets.get(localEventId);
    if (socket) {
      try {
        socket.close();
      } catch {
        // ignore
      }
      this.sockets.delete(localEventId);
    }
    const timer = this.retryTimers.get(localEventId);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(localEventId);
    this.retryAttempts.delete(localEventId);
    this.states.delete(localEventId);
    this.epochs.set(localEventId, (this.epochs.get(localEventId) ?? 0) + 1);
    this.notify();
  }

  /** The admin is about to purge the event on the server: the resulting `event-purged`/401 must keep the local copy. */
  expectPurge(localEventId: string): void {
    this.expectedPurges.add(localEventId);
  }

  cancelExpectedPurge(localEventId: string): void {
    this.expectedPurges.delete(localEventId);
  }

  // --- state for the UI ---------------------------------------------------

  getState(localEventId: string): EventSyncState {
    return this.states.get(localEventId) ?? { connected: false, syncing: false, lastError: null };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify = () => {
    this.listeners.forEach((listener) => listener());
  };

  private patchState(localEventId: string, patch: Partial<EventSyncState>): void {
    const prev = this.getState(localEventId);
    this.states.set(localEventId, { ...prev, ...patch });
    this.notify();
  }

  // --- sockets ------------------------------------------------------------

  private bindSocket(localEventId: string, socket: SocketLike): void {
    socket.on("connect", () => {
      this.patchState(localEventId, { connected: true });
      // A reconnect may have missed role changes and ops: refresh both.
      this.fire(this.refreshMe(localEventId));
      this.fire(this.syncNow(localEventId));
    });
    socket.on("disconnect", () => this.patchState(localEventId, { connected: false }));
    socket.on("connect_error", (err: { data?: { code?: string }; message?: string }) => {
      this.patchState(localEventId, { connected: false });
      const code = err?.data?.code;
      if (code === "device-revoked" || code === "unauthorized") this.fire(this.handleRevoked(localEventId, code));
    });
    socket.on("ops", (payload: { ops?: RemoteOpEnvelope[]; lastSeq?: number }) => this.fire(this.onSocketOps(localEventId, payload)));
    socket.on("roles-changed", () => this.fire(this.refreshMe(localEventId)));
    socket.on("device-revoked", () => this.fire(this.handleRevoked(localEventId, "device-revoked")));
    socket.on("event-purged", () => this.fire(this.handleRevoked(localEventId, "event-purged")));
  }

  private async onSocketOps(localEventId: string, payload: { ops?: RemoteOpEnvelope[] }): Promise<void> {
    const ops = payload?.ops ?? [];
    if (ops.length === 0) return;
    await this.exclusive(localEventId, async () => {
      const link = await this.deps.db.onlineLinks.get(localEventId);
      if (!link || link.status === "revoked") return;
      const sorted = [...ops].sort((a, b) => a.seq - b.seq);
      if (sorted[0].seq > link.lastSeq + 1) {
        // A gap: some ops were missed — fetch them in order instead.
        await this.catchUpLocked(localEventId);
        return;
      }
      for (const envelope of sorted) {
        if ((await this.applyEnvelope(localEventId, envelope)) === "purged") return;
      }
    });
  }

  // --- serialisation ------------------------------------------------------

  /** Runs `fn` after everything previously queued for this event (push, pull and socket ops never interleave). */
  private exclusive<T>(localEventId: string, fn: () => Promise<T>): Promise<T | undefined> {
    const prev = this.chains.get(localEventId) ?? Promise.resolve();
    const epoch = this.epochs.get(localEventId) ?? 0;
    const run = async () => (this.epochs.get(localEventId) ?? 0) === epoch ? fn() : undefined;
    const next = prev.then(run, run);
    this.chains.set(
      localEventId,
      next.catch(() => undefined)
    );
    return next;
  }

  // --- public operations --------------------------------------------------

  /** Catch up on inbound ops, then drain the outbox. */
  async syncNow(localEventId: string): Promise<void> {
    await this.exclusive(localEventId, async () => {
      this.patchState(localEventId, { syncing: true });
      try {
        await this.catchUpLocked(localEventId);
        await this.flushLocked(localEventId);
      } finally {
        this.patchState(localEventId, { syncing: false });
      }
    });
  }

  async syncAll(): Promise<void> {
    const links = await this.deps.db.onlineLinks.toArray();
    await Promise.all(links.filter((l) => l.status !== "revoked").map((l) => this.syncNow(l.localEventId)));
  }

  /** Drain the outbox only. */
  async flush(localEventId: string): Promise<void> {
    await this.exclusive(localEventId, async () => {
      this.patchState(localEventId, { syncing: true });
      try {
        await this.flushLocked(localEventId);
      } finally {
        this.patchState(localEventId, { syncing: false });
      }
    });
  }

  async catchUp(localEventId: string): Promise<void> {
    await this.exclusive(localEventId, () => this.catchUpLocked(localEventId));
  }

  /** "تلاش دوباره": clears rejections so the treasurer can resend (e.g. after a role change) and forces a sync. */
  async retryRejected(localEventId: string): Promise<void> {
    await this.deps.db.outbox
      .where("localEventId")
      .equals(localEventId)
      .filter((row) => Boolean(row.rejected))
      .modify({ rejected: null, attempts: 0, lastError: null });
    await this.syncNow(localEventId);
  }

  async refreshMe(localEventId: string): Promise<void> {
    const link = await this.deps.db.onlineLinks.get(localEventId);
    if (!link || link.status === "revoked") return;
    try {
      const me = await this.deps.api.me(link.deviceToken);
      await this.deps.db.onlineLinks.update(localEventId, { roles: me.roles as OnlineRole[], deviceId: me.deviceId });
      this.notify();
      // New role may unblock queued ops.
      this.fire(this.flush(localEventId));
    } catch (err) {
      await this.handleFailure(localEventId, err);
    }
  }

  // --- inbound ------------------------------------------------------------

  private async applyEnvelope(localEventId: string, envelope: RemoteOpEnvelope): Promise<string> {
    const result = await applyRemoteOperation(localEventId, envelope, this.deps.db);
    if (result === "purged") await this.handleRevoked(localEventId, "event-purged");
    return result;
  }

  private async catchUpLocked(localEventId: string): Promise<void> {
    try {
      for (;;) {
        const link = await this.deps.db.onlineLinks.get(localEventId);
        if (!link || link.status === "revoked") return;
        const page: PullResult = await this.deps.api.pullOps(link.deviceToken, link.serverEventId, link.lastSeq, MAX_BATCH_OPS);
        for (const envelope of page.ops) {
          if ((await this.applyEnvelope(localEventId, envelope)) === "purged") return;
        }
        // Even an empty page may move the cursor (e.g. only our own ops).
        const fresh = await this.deps.db.onlineLinks.get(localEventId);
        if (fresh && page.lastSeq > fresh.lastSeq && page.ops.length === 0) await this.deps.db.onlineLinks.update(localEventId, { lastSeq: page.lastSeq });
        if (!page.hasMore) break;
      }
      this.clearRetry(localEventId);
      this.patchState(localEventId, { lastError: null });
    } catch (err) {
      await this.handleFailure(localEventId, err);
    }
  }

  // --- outbound -----------------------------------------------------------

  /** Registers event members that the server does not know yet (needed before they can be invited). */
  async registerMembers(localEventId: string): Promise<void> {
    const link = await this.deps.db.onlineLinks.get(localEventId);
    if (!link || link.status === "revoked" || !canWriteLedger(link.roles)) return;
    const registered = new Set(link.registeredPersonIds ?? []);
    const members = await this.deps.db.eventMembers.where("eventId").equals(localEventId).filter((m) => m.active && !m.deleted).toArray();
    for (const member of members) {
      if (registered.has(member.personId)) continue;
      const person = await this.deps.db.persons.get(member.personId);
      if (!person) continue;
      const displayName = `${person.firstName} ${person.lastName}`.trim().slice(0, 80) || person.firstName;
      try {
        await this.deps.api.addMember(link.deviceToken, link.serverEventId, { memberId: member.personId, displayName });
      } catch (err) {
        if (!(err instanceof ApiError && err.code === "member-exists")) throw err;
      }
      registered.add(member.personId);
      await this.deps.db.onlineLinks.update(localEventId, { registeredPersonIds: [...registered] });
    }
  }

  private async flushLocked(localEventId: string): Promise<void> {
    let link = await this.deps.db.onlineLinks.get(localEventId);
    if (!link || link.status === "revoked") return;
    try {
      await this.registerMembers(localEventId);

      for (;;) {
        link = await this.deps.db.onlineLinks.get(localEventId);
        if (!link || link.status === "revoked") return;
        const queued = await this.deps.db.outbox
          .where("localEventId")
          .equals(localEventId)
          .filter((row) => !row.rejected)
          .sortBy("order");
        if (queued.length === 0) break;
        const [batch] = chunkBySizeAndCount(queued, (row) => JSON.stringify(row.op).length, MAX_BATCH_OPS);
        await this.pushBatch(link, batch);
      }

      const current = await this.deps.db.onlineLinks.get(localEventId);
      if (current && current.status === "uploading") await this.deps.db.onlineLinks.update(localEventId, { status: "online" });
      this.clearRetry(localEventId);
      this.patchState(localEventId, { lastError: null });
    } catch (err) {
      await this.handleFailure(localEventId, err);
    }
  }

  private async pushBatch(link: OnlineLink, batch: OutboxEntry[]): Promise<void> {
    const { db } = this.deps;
    let result;
    try {
      result = await this.deps.api.pushOps(link.deviceToken, link.serverEventId, batch.map((row) => row.op));
    } catch (err) {
      if (err instanceof ApiError && (err.code === "invalid-field" || err.code === "payload-too-large" || err.code === "bad-request")) {
        // The request itself is unacceptable: keep the ops, flagged, so the loop cannot spin forever.
        await db.transaction("rw", db.outbox, async () => {
          for (const row of batch) await db.outbox.update(row.order!, { rejected: { reason: err.code, message: err.message }, attempts: row.attempts + 1, lastError: err.message });
        });
        return;
      }
      await db.transaction("rw", db.outbox, async () => {
        for (const row of batch) await db.outbox.update(row.order!, { attempts: row.attempts + 1, lastError: err instanceof Error ? err.message : "error" });
      });
      throw err;
    }

    const acceptedIds = new Set(result.accepted.map((a) => a.opId));
    const rejected = new Map(result.rejected.map((r) => [r.opId, r]));
    await db.transaction("rw", db.outbox, db.appliedRemoteOps, async () => {
      for (const row of batch) {
        if (acceptedIds.has(row.opId)) {
          const seq = result.accepted.find((a) => a.opId === row.opId)?.seq ?? null;
          // Remember it so the socket echo / catch-up of our own op is skipped.
          await db.appliedRemoteOps.put({ localEventId: row.localEventId, opId: row.opId, seq, appliedAt: new Date().toISOString() });
          await db.outbox.delete(row.order!);
        } else {
          const rej = rejected.get(row.opId);
          const reason = rej?.reason ?? "bad-op";
          await db.outbox.update(row.order!, {
            rejected: { reason, message: onlineErrorMessage(reason, rej?.message) },
            attempts: row.attempts + 1,
            lastError: rej?.message ?? reason
          });
        }
      }
    });
  }

  // --- failures -----------------------------------------------------------

  private clearRetry(localEventId: string): void {
    const timer = this.retryTimers.get(localEventId);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(localEventId);
    this.retryAttempts.delete(localEventId);
  }

  private async handleFailure(localEventId: string, err: unknown): Promise<void> {
    if (err instanceof ApiError && err.isAuthFailure) {
      await this.handleRevoked(localEventId, err.code === "device-revoked" ? "device-revoked" : "unauthorized");
      return;
    }
    const message = err instanceof ApiError || err instanceof NetworkError ? err.message : onlineErrorMessage(null);
    this.patchState(localEventId, { lastError: message });
    this.scheduleRetry(localEventId);
  }

  private scheduleRetry(localEventId: string): void {
    if (this.retryTimers.has(localEventId) || !this.sockets.has(localEventId)) return;
    const attempts = this.retryAttempts.get(localEventId) ?? 0;
    this.retryAttempts.set(localEventId, attempts + 1);
    const timer = setTimeout(() => {
      this.retryTimers.delete(localEventId);
      this.fire(this.syncNow(localEventId));
    }, backoffDelayMs(attempts));
    this.retryTimers.set(localEventId, timer);
  }

  /** Device revoked / event purged / token no longer valid: wipe the local event (unless the admin purged it deliberately) and tell the user. */
  async handleRevoked(localEventId: string, reason: RevokeReason): Promise<void> {
    const { db } = this.deps;
    const link = await db.onlineLinks.get(localEventId);
    if (!link) return;
    const event = await db.events.get(localEventId);
    const title = event?.title ?? "";
    this.detach(localEventId);

    if (this.expectedPurges.has(localEventId)) {
      this.expectedPurges.delete(localEventId);
      await detachOnlineEvent(localEventId, db);
      return;
    }
    await db.onlineLinks.update(localEventId, { status: "revoked" });
    await wipeOnlineEvent(localEventId, db);
    await setOnlineNotice(revokeMessage(reason, title), db);
  }
}

export const syncEngine = new SyncEngine();
