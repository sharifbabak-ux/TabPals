import Dexie, { type EntityTable } from "dexie";
import type { Event, EventMember, Group, Operation, Person } from "./types";

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
  persons!: EntityTable<Person, "id">;
  events!: EntityTable<Event, "id">;
  eventMembers!: EntityTable<EventMember, "id">;
  groups!: EntityTable<Group, "id">;
  operations!: EntityTable<Operation, "id">;

  constructor(name = "tabpal") {
    super(name);

    this.version(1).stores({
      meta: "key"
    });

    // Stage 1 — People & Events. Purely additive: new empty tables, the
    // existing meta store is untouched, so Dexie preserves all existing
    // data with no upgrade() function needed.
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

export const db = new TabPalDB();
