import { isEventClosed } from "@/domain/eventStatus";
import { db } from "../db";
import type { EventMember } from "../types";
import { diffFields, logOperation, newBaseFields, touchBaseFields } from "./operationLog";

/** Blocks member changes (add, import, add group, deactivate, reorder) on a closed event — see CLAUDE.md. */
async function assertEventOpenForMemberChange(eventId: string): Promise<void> {
  const event = await db.events.get(eventId);
  if (!event) throw new Error(`Event ${eventId} not found`);
  if (isEventClosed(event, new Date())) {
    throw new Error("این ایونت پایان‌یافته است؛ برای تغییر، ابتدا آن را بازگشایی کنید.");
  }
}

async function nextSortOrder(eventId: string): Promise<number> {
  const members = await db.eventMembers.where("eventId").equals(eventId).toArray();
  return members.reduce((max, m) => Math.max(max, m.sortOrder ?? -1), -1) + 1;
}

export const eventMembersRepository = {
  /**
   * Adds a person to an event, or reactivates their membership if they
   * were previously deactivated. No-op if already an active member.
   * A person can only ever have one membership row per event (enforced
   * by the `&[eventId+personId]` unique index in db.ts).
   */
  async addMember(eventId: string, personId: string, defaultWeight = 1): Promise<void> {
    await db.transaction("rw", db.events, db.eventMembers, db.operations, async () => {
      await assertEventOpenForMemberChange(eventId);
      const existing = await db.eventMembers.where("[eventId+personId]").equals([eventId, personId]).first();

      if (existing) {
        if (existing.active) return;
        const updated: EventMember = { ...existing, active: true, ...touchBaseFields(existing) };
        await db.eventMembers.put(updated);
        await logOperation(db, "eventMembers", existing.id, "update", diffFields(existing, updated, ["active"]));
        return;
      }

      const sortOrder = await nextSortOrder(eventId);
      const member: EventMember = { ...newBaseFields(), eventId, personId, defaultWeight, active: true, sortOrder };
      await db.eventMembers.add(member);
      await logOperation(
        db,
        "eventMembers",
        member.id,
        "create",
        diffFields(undefined, member, ["eventId", "personId", "defaultWeight", "active", "sortOrder"])
      );
    });
  },

  /** Adds several persons to an event in one call (used for group add / import). */
  async addMembers(eventId: string, personIds: string[], defaultWeight = 1): Promise<void> {
    for (const personId of personIds) {
      await this.addMember(eventId, personId, defaultWeight);
    }
  },

  /** Deactivates (or reactivates) a membership. Never deletes the row — see CLAUDE.md. */
  async setActive(id: string, active: boolean): Promise<void> {
    await db.transaction("rw", db.events, db.eventMembers, db.operations, async () => {
      const existing = await db.eventMembers.get(id);
      if (!existing) throw new Error(`Event member ${id} not found`);
      await assertEventOpenForMemberChange(existing.eventId);
      if (existing.active === active) return;
      const updated: EventMember = { ...existing, active, ...touchBaseFields(existing) };
      await db.eventMembers.put(updated);
      await logOperation(db, "eventMembers", id, active ? "update" : "archive", diffFields(existing, updated, ["active"]));
    });
  },

  /** Persists a new drag-and-drop member order (docs/PLAN.md Stage 3A UI #5). `orderedMemberIds` are eventMembers row ids, first-to-last. */
  async reorder(eventId: string, orderedMemberIds: string[]): Promise<void> {
    await db.transaction("rw", db.events, db.eventMembers, db.operations, async () => {
      await assertEventOpenForMemberChange(eventId);
      for (let i = 0; i < orderedMemberIds.length; i++) {
        const existing = await db.eventMembers.get(orderedMemberIds[i]);
        if (!existing || existing.eventId !== eventId || existing.sortOrder === i) continue;
        const updated: EventMember = { ...existing, sortOrder: i, ...touchBaseFields(existing) };
        await db.eventMembers.put(updated);
        await logOperation(db, "eventMembers", existing.id, "update", diffFields(existing, updated, ["sortOrder"]));
      }
    });
  }
};
