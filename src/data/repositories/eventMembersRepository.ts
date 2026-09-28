import { db } from "../db";
import type { EventMember } from "../types";
import { diffFields, logOperation, newBaseFields, touchBaseFields } from "./operationLog";

export const eventMembersRepository = {
  /**
   * Adds a person to an event, or reactivates their membership if they
   * were previously deactivated. No-op if already an active member.
   * A person can only ever have one membership row per event (enforced
   * by the `&[eventId+personId]` unique index in db.ts).
   */
  async addMember(eventId: string, personId: string, defaultWeight = 1): Promise<void> {
    await db.transaction("rw", db.eventMembers, db.operations, async () => {
      const existing = await db.eventMembers.where("[eventId+personId]").equals([eventId, personId]).first();

      if (existing) {
        if (existing.active) return;
        const updated: EventMember = { ...existing, active: true, ...touchBaseFields(existing) };
        await db.eventMembers.put(updated);
        await logOperation(db, "eventMembers", existing.id, "update", diffFields(existing, updated, ["active"]));
        return;
      }

      const member: EventMember = { ...newBaseFields(), eventId, personId, defaultWeight, active: true };
      await db.eventMembers.add(member);
      await logOperation(
        db,
        "eventMembers",
        member.id,
        "create",
        diffFields(undefined, member, ["eventId", "personId", "defaultWeight", "active"])
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
    await db.transaction("rw", db.eventMembers, db.operations, async () => {
      const existing = await db.eventMembers.get(id);
      if (!existing) throw new Error(`Event member ${id} not found`);
      if (existing.active === active) return;
      const updated: EventMember = { ...existing, active, ...touchBaseFields(existing) };
      await db.eventMembers.put(updated);
      await logOperation(db, "eventMembers", id, active ? "update" : "archive", diffFields(existing, updated, ["active"]));
    });
  }
};
