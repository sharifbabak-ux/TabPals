import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { personsRepository } from "./personsRepository";

beforeEach(async () => {
  await db.persons.clear();
  await db.operations.clear();
});

describe("personsRepository", () => {
  it("creates a person, trims its name, and logs a create operation", async () => {
    const person = await personsRepository.create({ name: " Ali " });
    expect(person.name).toBe("Ali");
    expect(person.archived).toBe(false);

    const stored = await db.persons.get(person.id);
    expect(stored?.name).toBe("Ali");

    const ops = await db.operations.where("entityId").equals(person.id).toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("create");
    expect(ops[0].entity).toBe("persons");
  });

  it("updates a person, bumps its version, and logs field-level changes", async () => {
    const person = await personsRepository.create({ name: "Ali" });
    await personsRepository.update(person.id, { phone: "0912" });

    const updated = await db.persons.get(person.id);
    expect(updated?.phone).toBe("0912");
    expect(updated?.version).toBe(2);

    const ops = await db.operations
      .where("entityId")
      .equals(person.id)
      .filter((o) => o.type === "update")
      .toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0].changes.phone).toEqual({ before: undefined, after: "0912" });
  });

  it("archives a person and logs an archive operation", async () => {
    const person = await personsRepository.create({ name: "Ali" });
    await personsRepository.setArchived(person.id, true);

    const archived = await db.persons.get(person.id);
    expect(archived?.archived).toBe(true);

    const ops = await db.operations
      .where("entityId")
      .equals(person.id)
      .filter((o) => o.type === "archive")
      .toArray();
    expect(ops).toHaveLength(1);
  });

  it("does not write an operation for a no-op update", async () => {
    const person = await personsRepository.create({ name: "Ali" });
    await personsRepository.update(person.id, { name: "Ali" });

    const ops = await db.operations.where("entityId").equals(person.id).toArray();
    expect(ops).toHaveLength(1);
  });

  it("blocks creating a person with a name that normalizes to an existing non-archived person's name", async () => {
    await personsRepository.create({ name: "علی رضایی" });
    await expect(personsRepository.create({ name: "علي رضايي" })).rejects.toThrow();
  });

  it("allows creating a person whose name matches an archived person's name", async () => {
    const person = await personsRepository.create({ name: "Ali" });
    await personsRepository.setArchived(person.id, true);
    await expect(personsRepository.create({ name: "Ali" })).resolves.toBeTruthy();
  });

  it("blocks renaming a person to another existing person's name", async () => {
    await personsRepository.create({ name: "Ali" });
    const sara = await personsRepository.create({ name: "Sara" });
    await expect(personsRepository.update(sara.id, { name: "Ali" })).rejects.toThrow();
  });

  it("allows renaming a person to their own unchanged name", async () => {
    const person = await personsRepository.create({ name: "Ali" });
    await expect(personsRepository.update(person.id, { name: "Ali", phone: "0912" })).resolves.toBeUndefined();
  });
});
