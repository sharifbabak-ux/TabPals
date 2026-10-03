import { describe, expect, it } from "vitest";
import { can, canWriteLedger, checkOp, LEDGER_ENTITIES } from "./onlinePermissions";

const member = { memberId: "m1", roles: ["member" as const] };
const treasurer = { memberId: "t1", roles: ["treasurer" as const, "member" as const] };
const admin = { memberId: "a1", roles: ["admin" as const] };

describe("permission matrix (mirrors Tabpals-Live src/permissions.js)", () => {
  it("members cannot write any ledger entity", () => {
    for (const entity of LEDGER_ENTITIES) {
      expect(checkOp(member, { entity, entityId: "x", type: "create" })).toEqual({ ok: false, reason: "forbidden-entity" });
    }
  });
  it("treasurer and admin can write ledger entities", () => {
    for (const actor of [treasurer, admin]) {
      for (const entity of LEDGER_ENTITIES) expect(checkOp(actor, { entity, entityId: "x", type: "update" }).ok).toBe(true);
    }
  });
  it("only admin may purge an event", () => {
    expect(checkOp(treasurer, { entity: "events", entityId: "e", type: "purge" })).toEqual({ ok: false, reason: "forbidden-purge" });
    expect(checkOp(admin, { entity: "events", entityId: "e", type: "purge" }).ok).toBe(true);
  });
  it("memberProfile: own id or admin", () => {
    expect(checkOp(member, { entity: "memberProfile", entityId: "m1", type: "update" }).ok).toBe(true);
    expect(checkOp(member, { entity: "memberProfile", entityId: "m2", type: "update" })).toEqual({ ok: false, reason: "forbidden-profile" });
    expect(checkOp(treasurer, { entity: "memberProfile", entityId: "m2", type: "update" }).ok).toBe(false);
    expect(checkOp(admin, { entity: "memberProfile", entityId: "m2", type: "update" }).ok).toBe(true);
  });
  it("rejects unknown entity / type", () => {
    expect(checkOp(admin, { entity: "groups", entityId: "x", type: "create" })).toEqual({ ok: false, reason: "unknown-entity" });
    expect(checkOp(admin, { entity: "vouchers", entityId: "x", type: "close" })).toEqual({ ok: false, reason: "unknown-type" });
  });
  it("action roles", () => {
    expect(can(["member"], "ops.read")).toBe(true);
    expect(can(["treasurer"], "members.add")).toBe(true);
    expect(can(["treasurer"], "roles.set")).toBe(false);
    expect(can(["admin"], "audit.read")).toBe(true);
    expect(canWriteLedger(["member"])).toBe(false);
  });
});
