import { describe, expect, it } from "vitest";
import { buildProfileOp, sanitizeOutboundOp, scrubValue, toServerOpType, type LocalOpLike } from "./outboundSanitizer";

const base = { id: "op1", entityId: "e1", timestamp: "2026-01-01T00:00:00.000Z", deviceId: "d1" };
const op = (over: Partial<LocalOpLike>): LocalOpLike => ({ ...base, entity: "persons", type: "create", changes: {}, ...over });
const ch = (after: unknown) => ({ before: undefined, after });

/** Every private value used below; none may appear anywhere in the serialized outbound op. */
const SECRETS = ["6037991234567890", "IR120170000000123456789012", "بانک ملی", "علی رضایی", "09121234567", "SECRET-PHOTO"];

describe("outbound sanitizer — private data never leaves the device", () => {
  it("person create: bank, phone and photo fields are dropped (allow-list)", () => {
    const out = sanitizeOutboundOp(
      op({
        changes: {
          firstName: ch("علی"),
          lastName: ch("رضایی"),
          phone: ch("09121234567"),
          cardNumber: ch("6037991234567890"),
          iban: ch("IR120170000000123456789012"),
          bankName: ch("بانک ملی"),
          accountHolder: ch("علی رضایی"),
          photo: ch(new Blob(["SECRET-PHOTO"])),
          note: ch("یادداشت خصوصی"),
          archived: ch(false)
        }
      })
    )!;
    expect(Object.keys(out.changes).sort()).toEqual(["archived", "firstName", "lastName"]);
    const text = JSON.stringify(out);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(text).not.toContain("یادداشت خصوصی");
  });

  it("person update that only touches private fields produces no op at all", () => {
    expect(sanitizeOutboundOp(op({ type: "update", changes: { phone: { before: "1", after: "2" }, cardNumber: { before: "a", after: "b" } } }))).toBeNull();
  });

  it("event: treasurer bank fields stay in the op (the engine encrypts them), nothing else private does", () => {
    const out = sanitizeOutboundOp(
      op({
        entity: "events",
        type: "update",
        changes: {
          title: { before: "a", after: "سفر" },
          treasurerPersonId: { before: null, after: "p1" },
          treasurerCardNumber: { before: undefined, after: "6037991234567890" },
          treasurerIban: { before: undefined, after: "IR120170000000123456789012" },
          treasurerBankName: { before: undefined, after: "بانک ملی" },
          treasurerAccountHolder: { before: undefined, after: "علی رضایی" }
        }
      })
    )!;
    expect(Object.keys(out.changes).sort()).toEqual(["title", "treasurerAccountHolder", "treasurerBankName", "treasurerCardNumber", "treasurerIban", "treasurerPersonId"]);
    // photos / notes of the event owner still never travel
    const withPhoto = sanitizeOutboundOp(op({ entity: "events", type: "update", changes: { photo: ch(new Blob(["x"])), phone: ch("0912") } }));
    expect(withPhoto).toBeNull();
  });

  it("Blobs and binary values are removed everywhere, including menu photos", () => {
    const out = sanitizeOutboundOp(
      op({
        entity: "orderSessions",
        changes: {
          title: ch("ناهار"),
          menuPhoto: ch(new Blob(["SECRET-PHOTO"])),
          nested: ch({ keep: 1, blob: new Blob(["x"]), bytes: new Uint8Array([1, 2]) })
        }
      })
    )!;
    expect(out.changes.menuPhoto).toBeUndefined();
    expect(out.changes.nested.after).toEqual({ keep: 1 });
    // the "menuPhoto: boolean" flag some update ops carry is private-ish metadata too
    expect(sanitizeOutboundOp(op({ entity: "orderSessions", type: "update", changes: { menuPhoto: { before: false, after: true } } }))).toBeNull();
  });

  it("statement snapshot JSON is parsed and bank details scrubbed at any depth", () => {
    const snapshot = JSON.stringify({
      member: { name: "سارا" },
      treasurerCardNumberGrouped: "6037 9912 3456 7890",
      treasurerIbanGrouped: "IR12 0170 0000 0012 3456 7890 12",
      treasurerBankName: "بانک ملی",
      treasurerAccountHolder: "علی رضایی",
      hubSettlement: { paysFromTreasurer: [{ name: "رضا", amount: 5, cardNumberGrouped: "6037 9912 3456 7890", bankName: "بانک ملی", accountHolder: "رضا" }] },
      summary: { balance: 100 }
    });
    const out = sanitizeOutboundOp(op({ entity: "statements", changes: { snapshot: ch(snapshot), number: ch(1) } }))!;
    const parsed = JSON.parse(out.changes.snapshot.after as string);
    expect(parsed.member.name).toBe("سارا");
    expect(parsed.summary.balance).toBe(100);
    // creditor members' bank details never leave; the treasurer's own payment info is kept (the whole snapshot is encrypted at push time)
    expect(parsed.hubSettlement.paysFromTreasurer[0]).toEqual({ name: "رضا", amount: 5 });
    expect(parsed.treasurerCardNumberGrouped).toBe("6037 9912 3456 7890");
    expect(parsed.treasurerAccountHolder).toBe("علی رضایی");
    expect(JSON.stringify(out)).not.toContain("رضا\",\"amount\":5,\"cardNumberGrouped");
    expect(out.changes.snapshot.after).not.toContain('"cardNumberGrouped"');
  });

  it("person create with bank data: persons op has no private field, a separate memberProfile op carries them", () => {
    const local = op({
      changes: { firstName: ch("علی"), lastName: ch("رضایی"), cardNumber: ch("6037991234567890"), iban: ch(""), phone: ch("09121234567"), photo: ch(new Blob(["x"])) }
    });
    const personOp = sanitizeOutboundOp(local)!;
    const profile = buildProfileOp(local)!;
    expect(JSON.stringify(personOp)).not.toMatch(/6037|0912/);
    expect(profile.entity).toBe("memberProfile");
    expect(profile.entityId).toBe("e1");
    expect(profile.id).toBe("op1.mp");
    expect(Object.keys(profile.changes).sort()).toEqual(["cardNumber", "phone"]);
    expect(JSON.stringify(profile)).not.toContain("SECRET");
  });

  it("clearing a bank field on update is a profile change (empty value), names are not", () => {
    const profile = buildProfileOp(op({ type: "update", changes: { iban: { before: "IR1", after: undefined }, firstName: { before: "a", after: "b" } } }))!;
    expect(profile.changes.iban.after).toBe("");
    expect(profile.changes.firstName).toBeUndefined();
    expect(buildProfileOp(op({ type: "update", changes: { firstName: { before: "a", after: "b" } } }))).toBeNull();
    expect(buildProfileOp(op({ entity: "vouchers", changes: { cardNumber: ch("1") } }))).toBeNull();
  });

  it("logSend ops carry targetMemberId and channel", () => {
    const sendLog = [{ channel: "whatsapp", at: "2026-01-01T00:00:00.000Z", target: "p9" }];
    const out = sanitizeOutboundOp(op({ entity: "statements", type: "update", changes: { sendLog: { before: [], after: sendLog } } }))!;
    expect(out.type).toBe("logSend");
    expect(out.changes.targetMemberId.after).toBe("p9");
    expect(out.changes.channel.after).toBe("whatsapp");
  });

  it("a non-JSON snapshot is never shipped", () => {
    const out = sanitizeOutboundOp(op({ entity: "statements", changes: { snapshot: ch("not json 6037991234567890") } }))!;
    expect(JSON.stringify(out)).not.toContain("6037991234567890");
  });

  it("device-local entities (groups, messageTemplates) and unknown ones are never synced", () => {
    for (const entity of ["groups", "messageTemplates", "memberProfileX", "meta"]) {
      expect(sanitizeOutboundOp(op({ entity, changes: { name: ch("x") } }))).toBeNull();
    }
  });

  it("keeps ordinary ledger data untouched", () => {
    const out = sanitizeOutboundOp(
      op({ entity: "vouchers", changes: { totalAmount: ch(1200), payers: ch([{ personId: "p1", amount: 1200 }]), description: ch("شام") } })
    )!;
    expect(out.changes.totalAmount.after).toBe(1200);
    expect(out.changes.payers.after).toEqual([{ personId: "p1", amount: 1200 }]);
  });

  it("scrubValue drops forbidden keys case-insensitively", () => {
    expect(scrubValue({ a: 1, CardNumber: "x", PHONE: "y", ok: { IBANValue: "z", fine: 2 } })).toEqual({ a: 1, ok: { fine: 2 } });
  });
});

describe("local → server op type mapping", () => {
  it("maps state transitions to update and statement send logs to logSend", () => {
    expect(toServerOpType("close", "events", {})).toBe("update");
    expect(toServerOpType("reopen", "events", {})).toBe("update");
    expect(toServerOpType("trash", "events", {})).toBe("update");
    expect(toServerOpType("finalize", "orderSessions", {})).toBe("update");
    expect(toServerOpType("cancel", "orderSessions", {})).toBe("update");
    expect(toServerOpType("outdate", "statements", { status: ch("outdated") })).toBe("update");
    expect(toServerOpType("update", "statements", { sendLog: ch([]) })).toBe("logSend");
    for (const t of ["create", "update", "delete", "archive", "restore", "purge"] as const) expect(toServerOpType(t, "vouchers", {})).toBe(t);
  });
});
