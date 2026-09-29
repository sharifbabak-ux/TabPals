import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
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
      name: "Test Person",
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
