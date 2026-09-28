import Dexie, { type EntityTable } from "dexie";
import type { Event, EventMember, Group, Operation, Person, Voucher } from "./types";

/** Default currency label backfilled onto events created before Stage 2. */
const DEFAULT_CURRENCY_LABEL = "تومان";

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
  vouchers!: EntityTable<Voucher, "id">;
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

    // Stage 2 — Vouchers & calculation engine. Adds the vouchers table and
    // three new Event fields (currencyLabel, closedAt, reopenedAt,
    // reopenReason). Existing events predate these fields, so upgrade()
    // backfills them in place rather than leaving them undefined.
    this.version(3)
      .stores({
        meta: "key",
        persons: "id, name, archived, deleted",
        events: "id, archived, deleted, startDate, closedAt",
        eventMembers: "id, eventId, personId, &[eventId+personId], active, deleted",
        groups: "id, name, archived, deleted",
        vouchers: "id, eventId, &[eventId+number], type, status, deleted, recordedAt",
        operations: "id, entity, entityId, timestamp"
      })
      .upgrade(async (tx) => {
        await tx
          .table("events")
          .toCollection()
          .modify((event) => {
            if (event.currencyLabel === undefined) event.currencyLabel = DEFAULT_CURRENCY_LABEL;
            if (event.closedAt === undefined) event.closedAt = null;
            if (event.reopenedAt === undefined) event.reopenedAt = null;
            if (event.reopenReason === undefined) event.reopenReason = null;
          });
      });
  }
}

export const db = new TabPalDB();
