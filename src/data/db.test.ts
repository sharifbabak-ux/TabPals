import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MESSAGE_TEMPLATES } from "@/domain/messageTemplateDefaults";
import { TabPalDB } from "./db";

const TEST_DB_NAME = "tabpal-migration-test";

afterEach(async () => {
  await Dexie.delete(TEST_DB_NAME);
});

describe("TabPalDB schema v1 -> v2 migration", () => {
  it("preserves existing meta data when upgrading an existing v1 database", async () => {
    // Simulate a device that already has a v1-only install by writing data
    // through a Dexie instance that only knows about version 1.
    class LegacyDB extends Dexie {
      meta!: Dexie.Table<{ key: string; value: string }, string>;
      constructor() {
        super(TEST_DB_NAME);
        this.version(1).stores({ meta: "key" });
      }
    }
    const legacy = new LegacyDB();
    await legacy.meta.put({ key: "onboarded", value: "true" });
    legacy.close();

    // Opening the real (current) schema against that same database name
    // exercises Dexie's actual version(1) -> version(2) upgrade path.
    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();

    const meta = await upgraded.meta.get("onboarded");
    expect(meta?.value).toBe("true");

    upgraded.close();
  });

  it("adds empty Stage 1 tables that are immediately usable", async () => {
    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();

    expect(await upgraded.persons.count()).toBe(0);
    expect(await upgraded.events.count()).toBe(0);
    expect(await upgraded.eventMembers.count()).toBe(0);
    expect(await upgraded.groups.count()).toBe(0);
    expect(await upgraded.operations.count()).toBe(0);

    await upgraded.persons.put({
      id: "p1",
      firstName: "Test",
      lastName: "Person",
      archived: false,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      deviceId: "device-1",
      version: 1,
      deleted: false
    });
    expect(await upgraded.persons.count()).toBe(1);

    upgraded.close();
  });

  it("rejects a second membership for the same person in the same event", async () => {
    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();

    const base = {
      eventId: "e1",
      personId: "p1",
      defaultWeight: 1,
      active: true,
      sortOrder: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      deviceId: "device-1",
      version: 1,
      deleted: false
    };
    await upgraded.eventMembers.add({ ...base, id: "m1" });
    await expect(upgraded.eventMembers.add({ ...base, id: "m2" })).rejects.toThrow();

    upgraded.close();
  });
});

describe("TabPalDB schema v2 -> v3 migration", () => {
  it("backfills currencyLabel/closedAt/reopenedAt/reopenReason on existing v2 events", async () => {
    class V2DB extends Dexie {
      events!: Dexie.Table<Record<string, unknown>, string>;
      constructor() {
        super(TEST_DB_NAME);
        this.version(2).stores({
          meta: "key",
          persons: "id, name, archived, deleted",
          events: "id, archived, deleted, startDate",
          eventMembers: "id, eventId, personId, &[eventId+personId], active, deleted",
          groups: "id, name, archived, deleted",
          operations: "id, entity, entityId, timestamp"
        });
      }
    }
    const legacy = new V2DB();
    await legacy.events.put({
      id: "e1",
      title: "سفر شمال",
      archived: false,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      deviceId: "device-1",
      version: 1,
      deleted: false
    });
    legacy.close();

    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();

    const event = await upgraded.events.get("e1");
    expect(event?.currency).toBe("تومان");
    expect(event?.closedAt).toBeNull();
    expect(event?.reopenedAt).toBeNull();
    expect(event?.reopenReason).toBeNull();

    upgraded.close();
  });

  it("adds an empty, immediately usable vouchers table with a per-event unique voucher number", async () => {
    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();

    expect(await upgraded.vouchers.count()).toBe(0);

    const base = {
      eventId: "e1",
      type: "expense" as const,
      recordedAt: "2025-01-01T00:00:00.000Z",
      expenseDate: "2025-01-01",
      description: "شام",
      totalAmount: 100,
      payers: [{ personId: "p1", amount: 100 }],
      participants: [{ personId: "p1", weight: 1 }],
      shares: [{ personId: "p1", share: 100 }],
      status: "active" as const,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      deviceId: "device-1",
      version: 1,
      deleted: false
    };
    await upgraded.vouchers.add({ ...base, id: "v1", number: 1 });
    await expect(upgraded.vouchers.add({ ...base, id: "v2", number: 1 })).rejects.toThrow();

    upgraded.close();
  });
});

describe("TabPalDB schema v3 -> v4 migration", () => {
  class V3DB extends Dexie {
    events!: Dexie.Table<Record<string, unknown>, string>;
    eventMembers!: Dexie.Table<Record<string, unknown>, string>;
    constructor(name: string) {
      super(name);
      this.version(3).stores({
        meta: "key",
        persons: "id, name, archived, deleted",
        events: "id, archived, deleted, startDate, closedAt",
        eventMembers: "id, eventId, personId, &[eventId+personId], active, deleted",
        groups: "id, name, archived, deleted",
        vouchers: "id, eventId, &[eventId+number], type, status, deleted, recordedAt",
        operations: "id, entity, entityId, timestamp"
      });
    }
  }

  const baseFields = {
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    deviceId: "device-1",
    version: 1,
    deleted: false
  };

  it("converts currencyLabel into the currency enum, defaulting unknown labels to تومان", async () => {
    const legacy = new V3DB(TEST_DB_NAME);
    await legacy.events.bulkPut([
      { id: "e1", title: "سفر شمال", archived: false, currencyLabel: "ریال", closedAt: null, reopenedAt: null, reopenReason: null, ...baseFields },
      { id: "e2", title: "سفر جنوب", archived: false, currencyLabel: "دلار", closedAt: null, reopenedAt: null, reopenReason: null, ...baseFields },
      { id: "e3", title: "سفر غرب", archived: false, currencyLabel: "تومان", closedAt: null, reopenedAt: null, reopenReason: null, ...baseFields }
    ]);
    legacy.close();

    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();

    expect((await upgraded.events.get("e1"))?.currency).toBe("ریال");
    expect((await upgraded.events.get("e2"))?.currency).toBe("تومان");
    expect((await upgraded.events.get("e3"))?.currency).toBe("تومان");
    expect((await upgraded.events.get("e1")) as unknown as { currencyLabel?: string }).not.toHaveProperty("currencyLabel");
    expect((await upgraded.events.get("e1"))?.treasurerPersonId).toBeNull();

    upgraded.close();
  });

  it("assigns sortOrder to existing eventMembers by creation order, per event", async () => {
    const legacy = new V3DB(TEST_DB_NAME);
    await legacy.eventMembers.bulkPut([
      { id: "m2", eventId: "e1", personId: "p2", defaultWeight: 1, active: true, ...baseFields, createdAt: "2025-01-02T00:00:00.000Z" },
      { id: "m1", eventId: "e1", personId: "p1", defaultWeight: 1, active: true, ...baseFields, createdAt: "2025-01-01T00:00:00.000Z" },
      { id: "m3", eventId: "e2", personId: "p3", defaultWeight: 1, active: true, ...baseFields, createdAt: "2025-01-01T00:00:00.000Z" }
    ]);
    legacy.close();

    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();

    expect((await upgraded.eventMembers.get("m1"))?.sortOrder).toBe(0);
    expect((await upgraded.eventMembers.get("m2"))?.sortOrder).toBe(1);
    expect((await upgraded.eventMembers.get("m3"))?.sortOrder).toBe(0);

    upgraded.close();
  });
});

describe("TabPalDB schema v4 -> v5 migration", () => {
  class V4DB extends Dexie {
    vouchers!: Dexie.Table<Record<string, unknown>, string>;
    constructor(name: string) {
      super(name);
      this.version(4).stores({
        meta: "key",
        persons: "id, name, archived, deleted",
        events: "id, archived, deleted, startDate, closedAt, treasurerPersonId",
        eventMembers: "id, eventId, personId, &[eventId+personId], active, deleted, sortOrder",
        groups: "id, name, archived, deleted",
        vouchers: "id, eventId, &[eventId+number], type, status, deleted, recordedAt",
        operations: "id, entity, entityId, timestamp"
      });
    }
  }

  const baseFields = {
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    deviceId: "device-1",
    version: 1,
    deleted: false
  };

  it("backfills splitMode on existing expense vouchers from participant weights", async () => {
    const legacy = new V4DB(TEST_DB_NAME);
    await legacy.vouchers.bulkPut([
      {
        id: "v1",
        eventId: "e1",
        number: 1,
        type: "expense",
        recordedAt: "2025-01-01T00:00:00.000Z",
        expenseDate: "2025-01-01",
        description: "شام",
        totalAmount: 100,
        payers: [{ personId: "p1", amount: 100 }],
        participants: [
          { personId: "p1", weight: 1 },
          { personId: "p2", weight: 1 }
        ],
        shares: [
          { personId: "p1", share: 50 },
          { personId: "p2", share: 50 }
        ],
        status: "active",
        ...baseFields
      },
      {
        id: "v2",
        eventId: "e1",
        number: 2,
        type: "expense",
        recordedAt: "2025-01-01T00:00:00.000Z",
        expenseDate: "2025-01-01",
        description: "تاکسی",
        totalAmount: 90,
        payers: [{ personId: "p1", amount: 90 }],
        participants: [
          { personId: "p1", weight: 2 },
          { personId: "p2", weight: 1 }
        ],
        shares: [
          { personId: "p1", share: 60 },
          { personId: "p2", share: 30 }
        ],
        status: "active",
        ...baseFields
      },
      {
        id: "v3",
        eventId: "e1",
        number: 3,
        type: "settlement",
        recordedAt: "2025-01-01T00:00:00.000Z",
        expenseDate: "2025-01-01",
        description: "تسویه",
        totalAmount: 30,
        payers: [],
        participants: [],
        fromPersonId: "p2",
        toPersonId: "p1",
        shares: [],
        status: "active",
        ...baseFields
      }
    ]);
    legacy.close();

    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();

    expect((await upgraded.vouchers.get("v1"))?.splitMode).toBe("equal");
    expect((await upgraded.vouchers.get("v2"))?.splitMode).toBe("weight");
    expect((await upgraded.vouchers.get("v3"))?.splitMode).toBeUndefined();

    upgraded.close();
  });

  it("seeds the default message templates for an existing install being upgraded", async () => {
    const legacy = new V4DB(TEST_DB_NAME);
    await legacy.open();
    legacy.close();

    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();

    const templates = await upgraded.messageTemplates.toArray();
    expect(templates.length).toBe(15);
    expect(templates.every((t) => t.isDefault && t.enabled)).toBe(true);
    expect(new Set(templates.map((t) => t.category))).toEqual(new Set(["debtor", "creditor", "settled", "treasurer"]));

    upgraded.close();
  });

  it("seeds the default message templates for a brand-new install (populate hook)", async () => {
    const fresh = new TabPalDB(TEST_DB_NAME);
    await fresh.open();

    const templates = await fresh.messageTemplates.toArray();
    expect(templates.length).toBe(15);

    fresh.close();
  });
});

describe("TabPalDB schema v5 -> v6 migration", () => {
  class V5DB extends Dexie {
    persons!: Dexie.Table<Record<string, unknown>, string>;
    events!: Dexie.Table<Record<string, unknown>, string>;
    vouchers!: Dexie.Table<Record<string, unknown>, string>;
    constructor(name: string) {
      super(name);
      this.version(5).stores({
        meta: "key",
        persons: "id, name, archived, deleted",
        events: "id, archived, deleted, startDate, closedAt, treasurerPersonId",
        eventMembers: "id, eventId, personId, &[eventId+personId], active, deleted, sortOrder",
        groups: "id, name, archived, deleted",
        vouchers: "id, eventId, &[eventId+number], type, status, deleted, recordedAt",
        statements: "id, eventId, kind, personId, &[eventId+number], status, deleted",
        messageTemplates: "id, category, enabled, isDefault, deleted",
        operations: "id, entity, entityId, timestamp"
      });
    }
  }

  const baseFields = {
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    deviceId: "device-1",
    version: 1,
    deleted: false
  };

  it("splits an existing person's name on the first space and flags needsNameReview", async () => {
    const legacy = new V5DB(TEST_DB_NAME);
    await legacy.persons.bulkPut([
      { id: "p1", name: "Ali Rezaei Pour", archived: false, ...baseFields },
      { id: "p2", name: "Solo", archived: false, ...baseFields },
      { id: "p3", name: "  Sara   Ahmadi  ", archived: false, ...baseFields }
    ]);
    legacy.close();

    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();

    const p1 = await upgraded.persons.get("p1");
    expect(p1?.firstName).toBe("Ali");
    expect(p1?.lastName).toBe("Rezaei Pour");
    expect(p1?.needsNameReview).toBe(true);
    expect((p1 as unknown as { name?: string })).not.toHaveProperty("name");

    const p2 = await upgraded.persons.get("p2");
    expect(p2?.firstName).toBe("Solo");
    expect(p2?.lastName).toBe("");
    expect(p2?.needsNameReview).toBe(true);

    const p3 = await upgraded.persons.get("p3");
    expect(p3?.firstName).toBe("Sara");
    expect(p3?.lastName).toBe("Ahmadi");

    upgraded.close();
  });

  it("backfills events.deletedAt to null", async () => {
    const legacy = new V5DB(TEST_DB_NAME);
    await legacy.events.put({
      id: "e1",
      title: "سفر شمال",
      archived: false,
      currency: "تومان",
      treasurerPersonId: null,
      closedAt: null,
      reopenedAt: null,
      reopenReason: null,
      ...baseFields
    });
    legacy.close();

    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();

    expect((await upgraded.events.get("e1"))?.deletedAt).toBeNull();

    upgraded.close();
  });

  it("backfills payerSplitMode to exact on existing multi-payer vouchers only", async () => {
    const legacy = new V5DB(TEST_DB_NAME);
    await legacy.vouchers.bulkPut([
      {
        id: "v1",
        eventId: "e1",
        number: 1,
        type: "expense",
        recordedAt: "2025-01-01T00:00:00.000Z",
        expenseDate: "2025-01-01",
        description: "شام",
        totalAmount: 100,
        payers: [
          { personId: "p1", amount: 60 },
          { personId: "p2", amount: 40 }
        ],
        participants: [{ personId: "p1", weight: 1 }],
        shares: [{ personId: "p1", share: 100 }],
        status: "active",
        splitMode: "equal",
        ...baseFields
      },
      {
        id: "v2",
        eventId: "e1",
        number: 2,
        type: "expense",
        recordedAt: "2025-01-01T00:00:00.000Z",
        expenseDate: "2025-01-01",
        description: "تاکسی",
        totalAmount: 90,
        payers: [{ personId: "p1", amount: 90 }],
        participants: [{ personId: "p1", weight: 1 }],
        shares: [{ personId: "p1", share: 90 }],
        status: "active",
        splitMode: "equal",
        ...baseFields
      }
    ]);
    legacy.close();

    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();

    expect((await upgraded.vouchers.get("v1"))?.payerSplitMode).toBe("exact");
    expect((await upgraded.vouchers.get("v2"))?.payerSplitMode).toBeUndefined();

    upgraded.close();
  });
});

describe("TabPalDB schema v6 -> v7 migration", () => {
  class V6DB extends Dexie {
    statements!: Dexie.Table<Record<string, unknown>, string>;
    constructor(name: string) {
      super(name);
      this.version(6).stores({
        meta: "key",
        persons: "id, archived, deleted, needsNameReview",
        events: "id, archived, deleted, startDate, closedAt, treasurerPersonId, deletedAt",
        eventMembers: "id, eventId, personId, &[eventId+personId], active, deleted, sortOrder",
        groups: "id, name, archived, deleted",
        vouchers: "id, eventId, &[eventId+number], type, status, deleted, recordedAt",
        statements: "id, eventId, kind, personId, &[eventId+number], status, deleted",
        messageTemplates: "id, category, enabled, isDefault, deleted",
        operations: "id, entity, entityId, timestamp"
      });
    }
  }

  const baseFields = {
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    deviceId: "device-1",
    version: 1,
    deleted: false
  };

  it("backfills sendLog to an empty array on existing statements", async () => {
    const legacy = new V6DB(TEST_DB_NAME);
    await legacy.statements.put({
      id: "s1",
      eventId: "e1",
      kind: "member",
      personId: "p1",
      number: 1,
      issueVersion: 1,
      issuedAt: "2025-01-01T00:00:00.000Z",
      snapshot: "{}",
      templateId: null,
      closingText: "",
      verificationCode: "AAAA-BBBB",
      status: "current",
      ...baseFields
    });
    legacy.close();

    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();

    expect((await upgraded.statements.get("s1"))?.sendLog).toEqual([]);

    upgraded.close();
  });
});

describe("TabPalDB schema v7 -> v8 migration (Group Order)", () => {
  class V7DB extends Dexie {
    events!: Dexie.Table<Record<string, unknown>, string>;
    vouchers!: Dexie.Table<Record<string, unknown>, string>;
    constructor(name: string) {
      super(name);
      this.version(7).stores({
        meta: "key",
        persons: "id, archived, deleted, needsNameReview",
        events: "id, archived, deleted, startDate, closedAt, treasurerPersonId, deletedAt",
        eventMembers: "id, eventId, personId, &[eventId+personId], active, deleted, sortOrder",
        groups: "id, name, archived, deleted",
        vouchers: "id, eventId, &[eventId+number], type, status, deleted, recordedAt",
        statements: "id, eventId, kind, personId, &[eventId+number], status, deleted",
        messageTemplates: "id, category, enabled, isDefault, deleted",
        operations: "id, entity, entityId, timestamp"
      });
    }
  }

  const baseFields = {
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    deviceId: "device-1",
    version: 1,
    deleted: false
  };

  it("keeps existing events and vouchers untouched and adds the empty group-order tables", async () => {
    const legacy = new V7DB(TEST_DB_NAME);
    await legacy.events.put({ id: "e1", title: "سفر شمال", archived: false, currency: "تومان", treasurerPersonId: "p1", closedAt: null, reopenedAt: null, reopenReason: null, deletedAt: null, ...baseFields });
    await legacy.vouchers.put({
      id: "v1",
      eventId: "e1",
      number: 1,
      type: "expense",
      recordedAt: "2025-01-01T00:00:00.000Z",
      expenseDate: "2025-01-01",
      description: "شام",
      totalAmount: 100,
      payers: [{ personId: "p1", amount: 100 }],
      participants: [{ personId: "p1", weight: 1 }],
      shares: [{ personId: "p1", share: 100 }],
      status: "active",
      splitMode: "equal",
      ...baseFields
    });
    legacy.close();

    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();

    expect((await upgraded.events.get("e1"))?.title).toBe("سفر شمال");
    const voucher = await upgraded.vouchers.get("v1");
    expect(voucher?.totalAmount).toBe(100);
    expect(voucher?.splitMode).toBe("equal");
    expect(voucher?.itemizedSnapshot).toBeUndefined();

    expect(await upgraded.orderSessions.count()).toBe(0);
    expect(await upgraded.sessionMenuItems.count()).toBe(0);
    expect(await upgraded.orderLines.count()).toBe(0);
    expect(await upgraded.orderPersonTotals.count()).toBe(0);
    expect(await upgraded.sessionExtras.count()).toBe(0);

    await upgraded.orderSessions.put({
      id: "s1",
      eventId: "e1",
      title: "شام",
      scheduledAt: "2025-01-02T18:00:00.000Z",
      status: "draft",
      adminPersonId: "p1",
      deputyPersonId: null,
      billTotal: null,
      expenseDate: "2025-01-02",
      payers: [],
      voucherId: null,
      ...baseFields
    });
    expect((await upgraded.orderSessions.where("eventId").equals("e1").toArray()).map((s) => s.id)).toEqual(["s1"]);

    upgraded.close();
  });
});

describe("TabPalDB schema v8 -> v9 migration (GO-1.1)", () => {
  class V8DB extends Dexie {
    sessionMenuItems!: Dexie.Table<Record<string, unknown>, string>;
    orderLines!: Dexie.Table<Record<string, unknown>, string>;
    messageTemplates!: Dexie.Table<Record<string, unknown>, string>;
    constructor(name: string) {
      super(name);
      this.version(8).stores({
        meta: "key",
        persons: "id, archived, deleted, needsNameReview",
        events: "id, archived, deleted, startDate, closedAt, treasurerPersonId, deletedAt",
        eventMembers: "id, eventId, personId, &[eventId+personId], active, deleted, sortOrder",
        groups: "id, name, archived, deleted",
        vouchers: "id, eventId, &[eventId+number], type, status, deleted, recordedAt",
        statements: "id, eventId, kind, personId, &[eventId+number], status, deleted",
        messageTemplates: "id, category, enabled, isDefault, deleted",
        orderSessions: "id, eventId, status, scheduledAt, deleted",
        sessionMenuItems: "id, sessionId, sortOrder, deleted",
        orderLines: "id, sessionId, personId, deleted",
        orderPersonTotals: "id, sessionId, [sessionId+personId], deleted",
        sessionExtras: "id, sessionId, deleted",
        operations: "id, entity, entityId, timestamp"
      });
    }
  }

  const baseFields = {
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    deviceId: "device-1",
    version: 1,
    deleted: false
  };

  it("backfills category 'other' on existing menu items and order lines", async () => {
    const legacy = new V8DB(TEST_DB_NAME);
    await legacy.sessionMenuItems.put({ id: "m1", sessionId: "s1", name: "دوغ", sortOrder: 0, ...baseFields });
    await legacy.orderLines.put({ id: "l1", sessionId: "s1", personId: "p1", itemName: "دوغ", quantity: 1, source: "admin-device", sourceVersion: 1, ...baseFields });
    legacy.close();

    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();
    expect((await upgraded.sessionMenuItems.get("m1"))?.category).toBe("other");
    expect((await upgraded.orderLines.get("l1"))?.category).toBe("other");
    expect((await upgraded.sessionMenuItems.get("m1"))?.name).toBe("دوغ");
    upgraded.close();
  });

  it("strips « » only from unedited default templates, never from edited or custom ones", async () => {
    const seed = DEFAULT_MESSAGE_TEMPLATES[0];
    const legacy = new V8DB(TEST_DB_NAME);
    await legacy.messageTemplates.bulkPut([
      { id: "t-default", category: seed.category, text: `«${seed.text}»`, enabled: true, isDefault: true, ...baseFields },
      { id: "t-edited", category: "debtor", text: "«متن ویرایش‌شده توسط کاربر»", enabled: true, isDefault: true, ...baseFields },
      { id: "t-custom", category: "debtor", text: `«${seed.text}»`, enabled: true, isDefault: false, ...baseFields }
    ]);
    legacy.close();

    const upgraded = new TabPalDB(TEST_DB_NAME);
    await upgraded.open();
    expect((await upgraded.messageTemplates.get("t-default"))?.text).toBe(seed.text);
    expect((await upgraded.messageTemplates.get("t-edited"))?.text).toBe("«متن ویرایش‌شده توسط کاربر»");
    expect((await upgraded.messageTemplates.get("t-custom"))?.text).toBe(`«${seed.text}»`);
    upgraded.close();
  });

  it("seeds default templates without quote marks on a fresh install", async () => {
    const fresh = new TabPalDB(TEST_DB_NAME);
    await fresh.open();
    const templates = await fresh.messageTemplates.toArray();
    expect(templates.length).toBe(DEFAULT_MESSAGE_TEMPLATES.length);
    expect(templates.every((t) => !t.text.includes("«") && !t.text.includes("»"))).toBe(true);
    fresh.close();
  });
});
