/**
 * Session model helpers (docs/PLAN.md "ONLINE-2", stage O2-1). Pure.
 *
 * Lifecycle wording vs the unchanged state machine (orderSessionState.ts):
 *   «شروع نشست»  = draft → open     (ordering is running; supplementary lines stay allowed)
 *   «پایان نشست» = open  → locked   (ordering is over; the admin can still reopen it,
 *                                    then pricing → finalized as before)
 * Nothing in the state machine changed; only the labels did.
 */
import type { OrderSession, SessionMode, SessionSettlement } from "@/data/types";

export const DEFAULT_SESSION_MODE: SessionMode = "admin-entered";
export const DEFAULT_SESSION_SETTLEMENT: SessionSettlement = "event";

export const SESSION_MODE_LABELS: Record<SessionMode, string> = {
  "admin-entered": "مدیر سفارش‌ها را وارد می‌کند",
  collaborative: "اعضا خودشان سفارش می‌دهند"
};

export const SESSION_SETTLEMENT_LABELS: Record<SessionSettlement, string> = {
  event: "جزو تسویه‌ی ایونت",
  own: "تسویه‌ی جداگانه"
};

export function sessionMode(session: Pick<OrderSession, "mode">): SessionMode {
  return session.mode === "collaborative" ? "collaborative" : DEFAULT_SESSION_MODE;
}

export function sessionSettlement(session: Pick<OrderSession, "settlement">): SessionSettlement {
  return session.settlement === "own" ? "own" : DEFAULT_SESSION_SETTLEMENT;
}

/** Participant ids with duplicates and blanks removed, keeping order. */
export function normalizeParticipants(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
}

/**
 * The people who appear in the session's order grid: the stored participants
 * (everyone active when none are stored), restricted to people still in the
 * event, plus anyone who already has an order (so nobody's lines vanish).
 */
export function sessionParticipantIds(
  session: Pick<OrderSession, "participants">,
  activeMemberIds: readonly string[],
  personIdsWithOrders: readonly string[] = []
): string[] {
  const stored = normalizeParticipants(session.participants ?? []);
  const base = stored.length === 0 ? [...activeMemberIds] : stored.filter((id) => activeMemberIds.includes(id));
  return normalizeParticipants([...base, ...personIdsWithOrders]);
}
