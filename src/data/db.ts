import Dexie, { type EntityTable } from "dexie";

/**
 * Simple key/value table for app-level settings that aren't accounting
 * records (e.g. onboarding flags). Entity tables (people, events,
 * vouchers, ...) are added starting Stage 1, each with its own
 * `this.version(n).stores(...)` migration that preserves existing data —
 * never edit a past version's stores() in place.
 */
export interface MetaRecord {
  key: string;
  value: string;
}

export class TabPalDB extends Dexie {
  meta!: EntityTable<MetaRecord, "key">;

  constructor() {
    super("tabpal");

    this.version(1).stores({
      meta: "key"
    });
  }
}

export const db = new TabPalDB();
