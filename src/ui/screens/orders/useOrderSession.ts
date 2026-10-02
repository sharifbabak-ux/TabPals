import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import type { OrderLine, OrderPersonTotal, OrderSession, SessionExtra, SessionMenuItem } from "@/data/types";

export interface OrderSessionData {
  session: OrderSession;
  menuItems: SessionMenuItem[];
  lines: OrderLine[];
  totals: OrderPersonTotal[];
  extras: SessionExtra[];
}

/** One session with all its live (non-deleted) child records; undefined while loading, null if it doesn't exist. */
export function useOrderSession(sessionId: string): OrderSessionData | null | undefined {
  return useLiveQuery(async () => {
    const session = await db.orderSessions.get(sessionId);
    if (!session || session.deleted) return null;
    const [menuItems, lines, totals, extras] = await Promise.all([
      db.sessionMenuItems.where("sessionId").equals(sessionId).filter((r) => !r.deleted).toArray(),
      db.orderLines.where("sessionId").equals(sessionId).filter((r) => !r.deleted).toArray(),
      db.orderPersonTotals.where("sessionId").equals(sessionId).filter((r) => !r.deleted).toArray(),
      db.sessionExtras.where("sessionId").equals(sessionId).filter((r) => !r.deleted).toArray()
    ]);
    menuItems.sort((a, b) => a.sortOrder - b.sortOrder);
    lines.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    extras.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { session, menuItems, lines, totals, extras };
  }, [sessionId]);
}
