import Dexie, { type EntityTable } from "dexie";
import { ulid } from "ulid";
import { DEFAULT_MESSAGE_TEMPLATES } from "@/domain/messageTemplateDefaults";
import { getDeviceId } from "./deviceId";
import type { Event, EventMember, Group, MessageTemplate, Operation, Person, Statement, Voucher } from "./types";

/** Default currency label backfilled onto events created before Stage 2. */
const DEFAULT_CURRENCY_LABEL = "تومان";
const VALID_CURRENCIES = new Set(["تومان", "ریال"]);

/** Builds fresh MessageTemplate rows from the default set, ready to insert. Shared by the v5 upgrade path and the fresh-install `populate` path. */
function buildDefaultMessageTemplateRows(): MessageTemplate[] {
  const now = new Date().toISOString();
  const deviceId = getDeviceId();
  return DEFAULT_MESSAGE_TEMPLATES.map((template) => ({
    id: ulid(),
    category: template.category,
    text: template.text,
    enabled: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    deviceId,
    version: 1,
    deleted: false
  }));
}

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
  statements!: EntityTable<Statement, "id">;
  messageTemplates!: EntityTable<MessageTemplate, "id">;
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

    // Stage 3A — treasurer, member ordering, and the currency enum. Renames
    // the free-text currencyLabel into a constrained currency enum,
    // backfills treasurerPersonId (null until set on existing events), and
    // assigns eventMembers.sortOrder from existing creation order so
    // drag-and-drop reordering has a stable starting point.
    this.version(4)
      .stores({
        meta: "key",
        persons: "id, name, archived, deleted",
        events: "id, archived, deleted, startDate, closedAt, treasurerPersonId",
        eventMembers: "id, eventId, personId, &[eventId+personId], active, deleted, sortOrder",
        groups: "id, name, archived, deleted",
        vouchers: "id, eventId, &[eventId+number], type, status, deleted, recordedAt",
        operations: "id, entity, entityId, timestamp"
      })
      .upgrade(async (tx) => {
        await tx
          .table("events")
          .toCollection()
          .modify((event) => {
            const label = event.currencyLabel;
            event.currency = VALID_CURRENCIES.has(label) ? label : DEFAULT_CURRENCY_LABEL;
            delete event.currencyLabel;
            if (event.treasurerPersonId === undefined) event.treasurerPersonId = null;
          });

        const membersByEvent = new Map<string, { id: string; createdAt: string }[]>();
        await tx
          .table("eventMembers")
          .toCollection()
          .each((member) => {
            const list = membersByEvent.get(member.eventId) ?? [];
            list.push({ id: member.id, createdAt: member.createdAt });
            membersByEvent.set(member.eventId, list);
          });

        for (const members of membersByEvent.values()) {
          members.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          for (let i = 0; i < members.length; i++) {
            await tx.table("eventMembers").update(members[i].id, { sortOrder: i });
          }
        }
      });

    // Stage 3B — statements, comprehensive report, treasurer-hub
    // settlement, message templates. Adds the statements and
    // messageTemplates tables (seeded with the default closing-message
    // templates), and backfills splitMode on existing expense vouchers
    // from their stored participant weights: all-equal weights means the
    // expense was split equally, anything else means a weighted split
    // (percent/exact splits didn't exist before Stage 3B, so there's
    // nothing to distinguish them from "weight" in old data).
    this.version(5)
      .stores({
        meta: "key",
        persons: "id, name, archived, deleted",
        events: "id, archived, deleted, startDate, closedAt, treasurerPersonId",
        eventMembers: "id, eventId, personId, &[eventId+personId], active, deleted, sortOrder",
        groups: "id, name, archived, deleted",
        vouchers: "id, eventId, &[eventId+number], type, status, deleted, recordedAt",
        statements: "id, eventId, kind, personId, &[eventId+number], status, deleted",
        messageTemplates: "id, category, enabled, isDefault, deleted",
        operations: "id, entity, entityId, timestamp"
      })
      .upgrade(async (tx) => {
        await tx
          .table("vouchers")
          .toCollection()
          .modify((voucher) => {
            if (voucher.type !== "expense" || voucher.splitMode !== undefined) return;
            const weights: number[] = (voucher.participants ?? []).map((p: { weight: number }) => p.weight);
            const allEqual = weights.length > 0 && weights.every((w) => w === weights[0]);
            voucher.splitMode = allEqual ? "equal" : "weight";
          });

        await tx.table("messageTemplates").bulkAdd(buildDefaultMessageTemplateRows());
      });

    // Stage 3B.1 — first/last names + name review, person bank details,
    // multi-payer split mode, treasurer bank name/holder, and event trash.
    // Existing persons only ever had a single free-text `name`; it's split
    // on the FIRST space so "Ali Rezaei Pour" -> firstName "Ali",
    // lastName "Rezaei Pour" (a name with no space at all -> lastName "").
    // Every migrated person is flagged `needsNameReview` so the one-time
    // "بررسی نام‌ها" screen can surface it. Vouchers with more than one
    // payer had no recorded split mode before this stage, so they're
    // backfilled to "exact" (the raw amounts are all that's known).
    this.version(6)
      .stores({
        meta: "key",
        persons: "id, archived, deleted, needsNameReview",
        events: "id, archived, deleted, startDate, closedAt, treasurerPersonId, deletedAt",
        eventMembers: "id, eventId, personId, &[eventId+personId], active, deleted, sortOrder",
        groups: "id, name, archived, deleted",
        vouchers: "id, eventId, &[eventId+number], type, status, deleted, recordedAt",
        statements: "id, eventId, kind, personId, &[eventId+number], status, deleted",
        messageTemplates: "id, category, enabled, isDefault, deleted",
        operations: "id, entity, entityId, timestamp"
      })
      .upgrade(async (tx) => {
        await tx
          .table("persons")
          .toCollection()
          .modify((person) => {
            const rawName: string = typeof person.name === "string" ? person.name.trim() : "";
            const spaceIndex = rawName.indexOf(" ");
            if (spaceIndex === -1) {
              person.firstName = rawName;
              person.lastName = "";
            } else {
              person.firstName = rawName.slice(0, spaceIndex);
              person.lastName = rawName.slice(spaceIndex + 1).trim();
            }
            person.needsNameReview = true;
            delete person.name;
          });

        await tx
          .table("events")
          .toCollection()
          .modify((event) => {
            if (event.deletedAt === undefined) event.deletedAt = null;
          });

        await tx
          .table("vouchers")
          .toCollection()
          .modify((voucher) => {
            if (Array.isArray(voucher.payers) && voucher.payers.length > 1 && voucher.payerSplitMode === undefined) {
              voucher.payerSplitMode = "exact";
            }
          });
      });

    // Stage 3C — export & sending. Statements gain `sendLog` (append-only
    // history of shares/sends, docs/PLAN.md Stage 3C); existing statements
    // predate the field, so it's backfilled to an empty array. Purely
    // additive otherwise, so the stores() shape is unchanged from v6.
    this.version(7)
      .stores({
        meta: "key",
        persons: "id, archived, deleted, needsNameReview",
        events: "id, archived, deleted, startDate, closedAt, treasurerPersonId, deletedAt",
        eventMembers: "id, eventId, personId, &[eventId+personId], active, deleted, sortOrder",
        groups: "id, name, archived, deleted",
        vouchers: "id, eventId, &[eventId+number], type, status, deleted, recordedAt",
        statements: "id, eventId, kind, personId, &[eventId+number], status, deleted",
        messageTemplates: "id, category, enabled, isDefault, deleted",
        operations: "id, entity, entityId, timestamp"
      })
      .upgrade(async (tx) => {
        await tx
          .table("statements")
          .toCollection()
          .modify((statement) => {
            if (statement.sendLog === undefined) statement.sendLog = [];
          });
      });

    // Dexie only runs version().upgrade() when migrating an EXISTING
    // database; a brand-new install goes straight to the latest schema
    // with no upgrade() calls at all, so first-run seeding needs this
    // separate `populate` hook (fires exactly once, only for a database
    // that never existed before).
    this.on("populate", async () => {
      await this.messageTemplates.bulkAdd(buildDefaultMessageTemplateRows());
    });
  }
}

export const db = new TabPalDB();
