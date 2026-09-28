import { db } from "../db";
import type { Event } from "../types";
import { diffFields, logOperation, newBaseFields, touchBaseFields } from "./operationLog";

export interface EventInput {
  title: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

function normalize(input: Partial<EventInput>): Partial<EventInput> {
  const result: Partial<EventInput> = {};
  if (input.title !== undefined) result.title = input.title.trim();
  if (input.startDate !== undefined) result.startDate = input.startDate || undefined;
  if (input.endDate !== undefined) result.endDate = input.endDate || undefined;
  if (input.description !== undefined) result.description = input.description.trim() || undefined;
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
      archived: false
    };
    await db.transaction("rw", db.events, db.operations, async () => {
      await db.events.add(event);
      await logOperation(
        db,
        "events",
        event.id,
        "create",
        diffFields(undefined, event, ["title", "startDate", "endDate", "description", "archived"])
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
      const diff = diffFields(existing, updated, ["title", "startDate", "endDate", "description"]);
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
  }
};
