import type { OnlineRole } from "@/data/types";
import { ROLE_LABELS_FA, ONLINE_ROLES } from "@/domain/onlinePermissions";
import "./online.css";

/** Small «آنلاین» badge plus this device's role chip(s) (docs/PLAN.md "Go online"). */
export function OnlineBadge({ roles }: { roles: OnlineRole[] }) {
  const main = ONLINE_ROLES.filter((r) => roles.includes(r));
  return (
    <>
      <span className="badge badge--online">آنلاین</span>
      {main.map((role) => (
        <span key={role} className="badge" title="نقش شما در این ایونت">
          {ROLE_LABELS_FA[role]}
        </span>
      ))}
    </>
  );
}
