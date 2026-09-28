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
