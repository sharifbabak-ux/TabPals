import { db } from "../db";
import type { Person } from "../types";
import { diffFields, logOperation, newBaseFields, touchBaseFields } from "./operationLog";

export interface PersonInput {
  name: string;
  phone?: string;
  note?: string;
}

function normalize(input: Partial<PersonInput>): Partial<PersonInput> {
  const result: Partial<PersonInput> = {};
  if (input.name !== undefined) result.name = input.name.trim();
  if (input.phone !== undefined) result.phone = input.phone.trim() || undefined;
  if (input.note !== undefined) result.note = input.note.trim() || undefined;
  return result;
}

export const personsRepository = {
  async create(input: PersonInput): Promise<Person> {
    const normalized = normalize(input) as PersonInput;
    const person: Person = {
      ...newBaseFields(),
      name: normalized.name,
      phone: normalized.phone,
      note: normalized.note,
      archived: false
    };
    await db.transaction("rw", db.persons, db.operations, async () => {
      await db.persons.add(person);
      await logOperation(db, "persons", person.id, "create", diffFields(undefined, person, ["name", "phone", "note", "archived"]));
    });
    return person;
  },

  async update(id: string, changes: Partial<PersonInput>): Promise<void> {
    const normalized = normalize(changes);
    await db.transaction("rw", db.persons, db.operations, async () => {
      const existing = await db.persons.get(id);
      if (!existing) throw new Error(`Person ${id} not found`);
      const updated: Person = { ...existing, ...normalized, ...touchBaseFields(existing) };
      const diff = diffFields(existing, updated, ["name", "phone", "note"]);
      if (Object.keys(diff).length === 0) return;
      await db.persons.put(updated);
      await logOperation(db, "persons", id, "update", diff);
    });
  },

  async setArchived(id: string, archived: boolean): Promise<void> {
    await db.transaction("rw", db.persons, db.operations, async () => {
      const existing = await db.persons.get(id);
      if (!existing) throw new Error(`Person ${id} not found`);
      if (existing.archived === archived) return;
      const updated: Person = { ...existing, archived, ...touchBaseFields(existing) };
      await db.persons.put(updated);
      await logOperation(db, "persons", id, "archive", diffFields(existing, updated, ["archived"]));
    });
  }
};
