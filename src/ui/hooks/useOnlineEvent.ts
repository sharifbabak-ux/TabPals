import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import type { OnlineLink, OnlineRole } from "@/data/types";
import { can, canWriteLedger } from "@/domain/onlinePermissions";

export interface OnlineEventInfo {
  /** False while the link is still being read. */
  loaded: boolean;
  link: OnlineLink | null;
  /** The event is shared online (offline events behave exactly as before). */
  online: boolean;
  roles: OnlineRole[];
  /** May write ledger data (always true for offline events). */
  canWrite: boolean;
  /** Online event and this device's roles do not allow writing: every add/edit/close/issue control must be hidden. */
  readOnly: boolean;
  isAdmin: boolean;
}

/** Online status and role flags of one local event. */
export function useOnlineEvent(eventId: string): OnlineEventInfo {
  const link = useLiveQuery(async () => (await db.onlineLinks.get(eventId)) ?? null, [eventId]);
  const active = link && link.status !== "revoked" ? link : null;
  const roles = active?.roles ?? [];
  const canWrite = !active || canWriteLedger(roles);
  return {
    loaded: link !== undefined,
    link: active,
    online: Boolean(active),
    roles,
    canWrite,
    readOnly: Boolean(active) && !canWrite,
    isAdmin: Boolean(active) && can(roles, "roles.set")
  };
}
