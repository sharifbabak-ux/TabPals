/**
 * Client-side mirror of the server permission matrix (Tabpals-Live
 * `src/permissions.js`, docs/API.md). The server stays the authority; this
 * only lets the app refuse / hide what it already knows would be rejected.
 */
import type { OnlineRole } from "@/data/types";

export const ONLINE_ROLES: OnlineRole[] = ["admin", "treasurer", "member"];

export const SERVER_OP_TYPES = ["create", "update", "delete", "archive", "restore", "purge", "logSend"] as const;

/** Entities only a treasurer/admin may write. */
export const LEDGER_ENTITIES = [
  "events",
  "persons",
  "eventMembers",
  "vouchers",
  "statements",
  "orderSessions",
  "sessionMenuItems",
  "orderLines",
  "orderPersonTotals",
  "sessionExtras"
] as const;

export const PROFILE_ENTITY = "memberProfile";

const ALL_ENTITIES: readonly string[] = [...LEDGER_ENTITIES, PROFILE_ENTITY];

export type OnlineAction =
  | "ops.read"
  | "members.read"
  | "members.add"
  | "roles.set"
  | "invites.manage"
  | "devices.listAll"
  | "devices.revokeAny"
  | "audit.read"
  | "event.purge";

const ACTION_ROLES: Record<OnlineAction, readonly OnlineRole[]> = {
  "ops.read": ONLINE_ROLES,
  "members.read": ONLINE_ROLES,
  "members.add": ["admin", "treasurer"],
  "roles.set": ["admin"],
  "invites.manage": ["admin"],
  "devices.listAll": ["admin"],
  "devices.revokeAny": ["admin"],
  "audit.read": ["admin"],
  "event.purge": ["admin"]
};

export function hasAny(roles: readonly OnlineRole[], allowed: readonly OnlineRole[]): boolean {
  return allowed.some((role) => roles.includes(role));
}

export function can(roles: readonly OnlineRole[], action: OnlineAction): boolean {
  return hasAny(roles, ACTION_ROLES[action]);
}

/** Ledger entities (everything the app syncs) are writable by treasurer/admin only. */
export function canWriteLedger(roles: readonly OnlineRole[]): boolean {
  return hasAny(roles, ["admin", "treasurer"]);
}

export type OpCheck = { ok: true } | { ok: false; reason: string };

export function checkOp(actor: { memberId: string; roles: readonly OnlineRole[] }, op: { entity: string; entityId: string; type: string }): OpCheck {
  if (!ALL_ENTITIES.includes(op.entity)) return { ok: false, reason: "unknown-entity" };
  if (!(SERVER_OP_TYPES as readonly string[]).includes(op.type)) return { ok: false, reason: "unknown-type" };
  const isAdmin = actor.roles.includes("admin");
  if (op.entity === PROFILE_ENTITY) {
    return isAdmin || op.entityId === actor.memberId ? { ok: true } : { ok: false, reason: "forbidden-profile" };
  }
  if (op.entity === "events" && op.type === "purge" && !isAdmin) return { ok: false, reason: "forbidden-purge" };
  return canWriteLedger(actor.roles) ? { ok: true } : { ok: false, reason: "forbidden-entity" };
}

/** Persian label for a role chip. */
export const ROLE_LABELS_FA: Record<OnlineRole, string> = {
  admin: "مدیر",
  treasurer: "مسئول صندوق",
  member: "عضو"
};

export function roleLabels(roles: readonly OnlineRole[]): string {
  return ONLINE_ROLES.filter((r) => roles.includes(r))
    .map((r) => ROLE_LABELS_FA[r])
    .join("، ");
}
