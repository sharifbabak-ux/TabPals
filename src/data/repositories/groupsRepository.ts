import { normalizeName } from "@/domain/nameNormalization";
import { db } from "../db";
import type { Group } from "../types";
import { diffFields, logOperation, newBaseFields, touchBaseFields } from "./operationLog";

export interface GroupInput {
  name: string;
  personIds: string[];
}

/** Blocks creating/renaming a group whose normalized name matches an existing non-archived one (see CLAUDE.md). */
async function assertNameAvailable(name: string, excludeGroupId?: string): Promise<void> {
  const target = normalizeName(name);
  const others = await db.groups.filter((g) => !g.deleted && !g.archived && g.id !== excludeGroupId).toArray();
  const clash = others.find((g) => normalizeName(g.name) === target);
  if (clash) {
    throw new Error(`گروه دیگری با نام «${clash.name}» وجود دارد. یک ویژگی متمایزکننده اضافه کنید، مثلاً «${name} (کرج)».`);
  }
}

export const groupsRepository = {
  async create(input: GroupInput): Promise<Group> {
    const name = input.name.trim();
    await assertNameAvailable(name);
    const group: Group = {
      ...newBaseFields(),
      name,
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
    if (changes.name !== undefined) {
      await assertNameAvailable(changes.name.trim(), id);
    }
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
