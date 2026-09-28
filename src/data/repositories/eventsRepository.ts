import { db } from "../db";
import type { Event } from "../types";
import { diffFields, logOperation, newBaseFields, touchBaseFields } from "./operationLog";

const DEFAULT_CURRENCY_LABEL = "تومان";

export interface EventInput {
  title: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  currencyLabel?: string;
}

function normalize(input: Partial<EventInput>): Partial<EventInput> {
  const result: Partial<EventInput> = {};
  if (input.title !== undefined) result.title = input.title.trim();
  if (input.startDate !== undefined) result.startDate = input.startDate || undefined;
  if (input.endDate !== undefined) result.endDate = input.endDate || undefined;
  if (input.description !== undefined) result.description = input.description.trim() || undefined;
  if (input.currencyLabel !== undefined) result.currencyLabel = input.currencyLabel.trim() || DEFAULT_CURRENCY_LABEL;
  return result;
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
      currencyLabel: normalized.currencyLabel ?? DEFAULT_CURRENCY_LABEL,
      archived: false,
      closedAt: null,
      reopenedAt: null,
      reopenReason: null
    };
    await db.transaction("rw", db.events, db.operations, async () => {
      await db.events.add(event);
      await logOperation(
        db,
        "events",
        event.id,
        "create",
        diffFields(undefined, event, ["title", "startDate", "endDate", "description", "currencyLabel", "archived"])
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
      const diff = diffFields(existing, updated, ["title", "startDate", "endDate", "description", "currencyLabel"]);
      if (Object.keys(diff).length === 0) return;
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

  /** Reopens a closed event ("بازگشایی ایونت"). Requires a non-empty reason and is always logged. */
  async reopen(id: string, reason: string): Promise<void> {
    const trimmedReason = reason.trim();
    if (!trimmedReason) throw new Error("دلیل بازگشایی الزامی است");

    await db.transaction("rw", db.events, db.operations, async () => {
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
    });
  }
};
