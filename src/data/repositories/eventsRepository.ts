import { canDeleteEvent, canTrashEvent } from "@/domain/deletionGuards";
import { isEventClosed } from "@/domain/eventStatus";
import { validateCardNumber, validateIban } from "@/domain/paymentValidation";
import { db } from "../db";
import type { Event, EventCurrency } from "../types";
import { diffFields, logOperation, newBaseFields, touchBaseFields } from "./operationLog";

const DEFAULT_CURRENCY: EventCurrency = "تومان";
const VALID_CURRENCIES: EventCurrency[] = ["تومان", "ریال"];

/** Fields that describe the treasurer — changing any of these on a closed event is rejected (see CLAUDE.md). */
const TREASURER_FIELDS = ["treasurerPersonId", "treasurerCardNumber", "treasurerIban", "treasurerBankName", "treasurerAccountHolder"] as const;

export interface EventInput {
  title: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  currency?: EventCurrency;
  treasurerPersonId?: string | null;
  treasurerCardNumber?: string;
  treasurerIban?: string;
  treasurerBankName?: string;
  treasurerAccountHolder?: string;
}

function normalize(input: Partial<EventInput>): Partial<EventInput> {
  const result: Partial<EventInput> = {};
  if (input.title !== undefined) result.title = input.title.trim();
  if (input.startDate !== undefined) result.startDate = input.startDate || undefined;
  if (input.endDate !== undefined) result.endDate = input.endDate || undefined;
  if (input.description !== undefined) result.description = input.description.trim() || undefined;
  if (input.currency !== undefined) {
    result.currency = VALID_CURRENCIES.includes(input.currency) ? input.currency : DEFAULT_CURRENCY;
  }
  if (input.treasurerPersonId !== undefined) result.treasurerPersonId = input.treasurerPersonId || null;
  if (input.treasurerCardNumber !== undefined) {
    const trimmed = input.treasurerCardNumber.trim();
    if (!trimmed) {
      result.treasurerCardNumber = undefined;
    } else {
      const validation = validateCardNumber(trimmed);
      if (!validation.valid) throw new Error(validation.error);
      result.treasurerCardNumber = validation.normalized;
    }
  }
  if (input.treasurerIban !== undefined) {
    const trimmed = input.treasurerIban.trim();
    if (!trimmed) {
      result.treasurerIban = undefined;
    } else {
      const validation = validateIban(trimmed);
      if (!validation.valid) throw new Error(validation.error);
      result.treasurerIban = validation.normalized;
    }
  }
  if (input.treasurerBankName !== undefined) result.treasurerBankName = input.treasurerBankName.trim() || undefined;
  if (input.treasurerAccountHolder !== undefined) result.treasurerAccountHolder = input.treasurerAccountHolder.trim() || undefined;
  return result;
}

/**
 * Blocks treasurer changes on a closed event — only reopening is allowed
 * (see CLAUDE.md) — EXCEPT setting a treasurer for the first time
 * (existing.treasurerPersonId still null), which docs/PLAN.md Stage 3B
 * explicitly allows on a closed event so a statement can be issued.
 */
function assertTreasurerEditableIfClosed(existing: Event, diff: Record<string, unknown>): void {
  const touchesTreasurer = TREASURER_FIELDS.some((field) => field in diff);
  if (!touchesTreasurer || !isEventClosed(existing, new Date())) return;
  if (existing.treasurerPersonId === null) return;
  throw new Error("این ایونت پایان‌یافته است؛ برای تغییر مسئول صندوق، ابتدا آن را بازگشایی کنید.");
}

export const eventsRepository = {
  async create(input: EventInput): Promise<Event> {
    const normalized = normalize(input) as EventInput;
    const event: Event = {
      ...newBaseFields(),
      title: normalized.title,
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      description: normalized.description,
      currency: normalized.currency ?? DEFAULT_CURRENCY,
      treasurerPersonId: normalized.treasurerPersonId ?? null,
      treasurerCardNumber: normalized.treasurerCardNumber,
      treasurerIban: normalized.treasurerIban,
      treasurerBankName: normalized.treasurerBankName,
      treasurerAccountHolder: normalized.treasurerAccountHolder,
      archived: false,
      closedAt: null,
      reopenedAt: null,
      reopenReason: null,
      deletedAt: null
    };
    await db.transaction("rw", db.events, db.operations, async () => {
      await db.events.add(event);
      await logOperation(
        db,
        "events",
        event.id,
        "create",
        diffFields(undefined, event, [
          "title",
          "startDate",
          "endDate",
          "description",
          "currency",
          "treasurerPersonId",
          "treasurerCardNumber",
          "treasurerIban",
          "treasurerBankName",
          "treasurerAccountHolder",
          "archived"
        ])
      );
    });
    return event;
  },

  async update(id: string, changes: Partial<EventInput>): Promise<void> {
    const normalized = normalize(changes);
    await db.transaction("rw", db.events, db.operations, async () => {
      const existing = await db.events.get(id);
      if (!existing) throw new Error(`Event ${id} not found`);
      const updated: Event = { ...existing, ...normalized, ...touchBaseFields(existing) };
      const diff = diffFields(existing, updated, [
        "title",
        "startDate",
        "endDate",
        "description",
        "currency",
        "treasurerPersonId",
        "treasurerCardNumber",
        "treasurerIban",
        "treasurerBankName",
        "treasurerAccountHolder"
      ]);
      if (Object.keys(diff).length === 0) return;
      assertTreasurerEditableIfClosed(existing, diff);
      await db.events.put(updated);
      await logOperation(db, "events", id, "update", diff);
    });
  },

  async setArchived(id: string, archived: boolean): Promise<void> {
    await db.transaction("rw", db.events, db.operations, async () => {
      const existing = await db.events.get(id);
      if (!existing) throw new Error(`Event ${id} not found`);
      if (existing.archived === archived) return;
      const updated: Event = { ...existing, archived, ...touchBaseFields(existing) };
      await db.events.put(updated);
      await logOperation(db, "events", id, "archive", diffFields(existing, updated, ["archived"]));
    });
  },

  /** Manually closes an event ("پایان ایونت"). No-op if already closed. */
  async close(id: string): Promise<void> {
    await db.transaction("rw", db.events, db.operations, async () => {
      const existing = await db.events.get(id);
      if (!existing) throw new Error(`Event ${id} not found`);
      if (existing.closedAt) return;
      const updated: Event = { ...existing, closedAt: new Date().toISOString(), ...touchBaseFields(existing) };
      await db.events.put(updated);
      await logOperation(db, "events", id, "close", diffFields(existing, updated, ["closedAt"]));
    });
  },

  /** Reopens a closed event ("بازگشایی ایونت"). Requires a non-empty reason, is always logged, and marks all of the event's current statements "outdated" (docs/PLAN.md Stage 3B). */
  async reopen(id: string, reason: string): Promise<void> {
    const trimmedReason = reason.trim();
    if (!trimmedReason) throw new Error("دلیل بازگشایی الزامی است");

    await db.transaction("rw", db.events, db.statements, db.operations, async () => {
      const existing = await db.events.get(id);
      if (!existing) throw new Error(`Event ${id} not found`);
      const updated: Event = {
        ...existing,
        closedAt: null,
        reopenedAt: new Date().toISOString(),
        reopenReason: trimmedReason,
        ...touchBaseFields(existing)
      };
      await db.events.put(updated);
      await logOperation(db, "events", id, "reopen", diffFields(existing, updated, ["closedAt", "reopenedAt", "reopenReason"]));

      const currentStatements = await db.statements
        .where("eventId")
        .equals(id)
        .filter((s) => !s.deleted && s.status === "current")
        .toArray();
      for (const statement of currentStatements) {
        const updatedStatement = { ...statement, status: "outdated" as const, ...touchBaseFields(statement) };
        await db.statements.put(updatedStatement);
        await logOperation(db, "statements", statement.id, "outdate", diffFields(statement, updatedStatement, ["status"]));
      }
    });
  },

  /** "حذف ایونت": moves a CLOSED event to trash by setting deletedAt (docs/PLAN.md Stage 3B.1). */
  async moveToTrash(id: string): Promise<void> {
    await db.transaction("rw", db.events, db.operations, async () => {
      const existing = await db.events.get(id);
      if (!existing) throw new Error(`Event ${id} not found`);
      const check = canTrashEvent(existing);
      if (!check.allowed) throw new Error(check.reason ?? "این ایونت قابل انتقال به سطل بازیافت نیست.");
      const updated: Event = { ...existing, deletedAt: new Date().toISOString(), ...touchBaseFields(existing) };
      await db.events.put(updated);
      await logOperation(db, "events", id, "trash", diffFields(existing, updated, ["deletedAt"]));
    });
  },

  /** "بازگردانی": clears deletedAt, moving a trashed event back to the closed-events list. */
  async restoreFromTrash(id: string): Promise<void> {
    await db.transaction("rw", db.events, db.operations, async () => {
      const existing = await db.events.get(id);
      if (!existing) throw new Error(`Event ${id} not found`);
      if (!existing.deletedAt) return;
      const updated: Event = { ...existing, deletedAt: null, ...touchBaseFields(existing) };
      await db.events.put(updated);
      await logOperation(db, "events", id, "restore", diffFields(existing, updated, ["deletedAt"]));
    });
  },

  /**
   * Permanent delete from trash: removes the event and everything
   * belonging to it (eventMembers, vouchers, statements) in one
   * transaction and writes a tombstone operation (docs/PLAN.md Stage
   * 3B.1) — only an event already in trash can be purged.
   */
  async permanentlyDelete(id: string): Promise<void> {
    await db.transaction("rw", db.events, db.eventMembers, db.vouchers, db.statements, db.operations, async () => {
      const existing = await db.events.get(id);
      if (!existing) throw new Error(`Event ${id} not found`);
      const check = canDeleteEvent(existing);
      if (!check.allowed) throw new Error(check.reason ?? "این ایونت قابل حذف دائمی نیست.");

      const memberIds = await db.eventMembers.where("eventId").equals(id).primaryKeys();
      const voucherIds = await db.vouchers.where("eventId").equals(id).primaryKeys();
      const statementIds = await db.statements.where("eventId").equals(id).primaryKeys();

      await db.eventMembers.bulkDelete(memberIds);
      await db.vouchers.bulkDelete(voucherIds);
      await db.statements.bulkDelete(statementIds);
      await db.events.delete(id);

      await logOperation(db, "events", id, "purge", {});
    });
  }
};
