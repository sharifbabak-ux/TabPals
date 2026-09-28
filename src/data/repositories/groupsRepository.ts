import { db } from "../db";
import type { Group } from "../types";
import { diffFields, logOperation, newBaseFields, touchBaseFields } from "./operationLog";

export interface GroupInput {
  name: string;
  personIds: string[];
}

export const groupsRepository = {
  async create(input: GroupInput): Promise<Group> {
    const group: Group = {
      ...newBaseFields(),
      name: input.name.trim(),
      personIds: [...input.personIds],
      archived: false
    };
    await db.transaction("rw", db.groups, db.operations, async () => {
      await db.groups.add(group);
      await logOperation(db, "groups", group.id, "create", diffFields(undefined, group, ["name", "personIds", "archived"]));
    });
    return group;
  },

  async update(id: string, changes: Partial<GroupInput>): Promise<void> {
    await db.transaction("rw", db.groups, db.operations, async () => {
      const existing = await db.groups.get(id);
      if (!existing) throw new Error(`Group ${id} not found`);
      const updated: Group = {
        ...existing,
        ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
        ...(changes.personIds !== undefined ? { personIds: [...changes.personIds] } : {}),
        ...touchBaseFields(existing)
      };
      const diff = diffFields(existing, updated, ["name", "personIds"]);
      if (Object.keys(diff).length === 0) return;
      await db.groups.put(updated);
      await logOperation(db, "groups", id, "update", diff);
    });
  },

  async setArchived(id: string, archived: boolean): Promise<void> {
    await db.transaction("rw", db.groups, db.operations, async () => {
      const existing = await db.groups.get(id);
      if (!existing) throw new Error(`Group ${id} not found`);
      if (existing.archived === archived) return;
      const updated: Group = { ...existing, archived, ...touchBaseFields(existing) };
      await db.groups.put(updated);
      await logOperation(db, "groups", id, "archive", diffFields(existing, updated, ["archived"]));
    });
  }
};
