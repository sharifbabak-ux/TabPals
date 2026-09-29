import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { eventMembersRepository } from "./eventMembersRepository";
import { eventsRepository } from "./eventsRepository";
import { personsRepository } from "./personsRepository";

beforeEach(async () => {
  await db.persons.clear();
  await db.events.clear();
  await db.eventMembers.clear();
  await db.vouchers.clear();
  await db.operations.clear();
});

describe("personsRepository", () => {
  it("creates a person, trims names, and logs a create operation", async () => {
    const person = await personsRepository.create({ firstName: " Ali ", lastName: " Rezaei " });
    expect(person.firstName).toBe("Ali");
    expect(person.lastName).toBe("Rezaei");
    expect(person.archived).toBe(false);
    expect(person.needsNameReview).toBe(false);

    const stored = await db.persons.get(person.id);
    expect(stored?.firstName).toBe("Ali");

    const ops = await db.operations.where("entityId").equals(person.id).toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("create");
    expect(ops[0].entity).toBe("persons");
  });

  it("rejects creating a person with an empty last name", async () => {
    await expect(personsRepository.create({ firstName: "Ali", lastName: "" })).rejects.toThrow();
  });

  it("updates a person, bumps its version, and logs field-level changes", async () => {
    const person = await personsRepository.create({ firstName: "Ali", lastName: "Rezaei" });
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

  it("validates and normalizes bank details on update", async () => {
    const person = await personsRepository.create({ firstName: "Ali", lastName: "Rezaei" });
    await personsRepository.update(person.id, { cardNumber: "6037-9912-3456-7802", bankName: "بانک ملی ایران" });

    const updated = await db.persons.get(person.id);
    expect(updated?.cardNumber).toBe("6037991234567802");
    expect(updated?.bankName).toBe("بانک ملی ایران");
  });

  it("rejects an invalid card number", async () => {
    const person = await personsRepository.create({ firstName: "Ali", lastName: "Rezaei" });
    await expect(personsRepository.update(person.id, { cardNumber: "1234" })).rejects.toThrow();
  });

  it("archives a person and logs an archive operation", async () => {
    const person = await personsRepository.create({ firstName: "Ali", lastName: "Rezaei" });
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
    const person = await personsRepository.create({ firstName: "Ali", lastName: "Rezaei" });
    await personsRepository.update(person.id, { firstName: "Ali", lastName: "Rezaei" });

    const ops = await db.operations.where("entityId").equals(person.id).toArray();
    expect(ops).toHaveLength(1);
  });

  it("blocks creating a person whose first+last name normalizes to an existing non-archived person's", async () => {
    await personsRepository.create({ firstName: "علی", lastName: "رضایی" });
    await expect(personsRepository.create({ firstName: "علي", lastName: "رضايي" })).rejects.toThrow();
  });

  it("allows creating a person whose name matches an archived person's name", async () => {
    const person = await personsRepository.create({ firstName: "Ali", lastName: "Rezaei" });
    await personsRepository.setArchived(person.id, true);
    await expect(personsRepository.create({ firstName: "Ali", lastName: "Rezaei" })).resolves.toBeTruthy();
  });

  it("blocks renaming a person to another existing person's name", async () => {
    await personsRepository.create({ firstName: "Ali", lastName: "Rezaei" });
    const sara = await personsRepository.create({ firstName: "Sara", lastName: "Ahmadi" });
    await expect(personsRepository.update(sara.id, { firstName: "Ali", lastName: "Rezaei" })).rejects.toThrow();
  });

  it("allows renaming a person to their own unchanged name", async () => {
    const person = await personsRepository.create({ firstName: "Ali", lastName: "Rezaei" });
    await expect(personsRepository.update(person.id, { firstName: "Ali", lastName: "Rezaei", phone: "0912" })).resolves.toBeUndefined();
  });

  it("confirmNameReview accepts an empty last name and clears needsNameReview", async () => {
    const person = await personsRepository.create({ firstName: "Ali", lastName: "Rezaei" });
    await db.persons.update(person.id, { needsNameReview: true, lastName: "" });

    await personsRepository.confirmNameReview(person.id, { firstName: "Ali", lastName: "" });

    const updated = await db.persons.get(person.id);
    expect(updated?.needsNameReview).toBe(false);
    expect(updated?.lastName).toBe("");
  });

  it("permanentlyDelete rejects a non-archived person", async () => {
    const person = await personsRepository.create({ firstName: "Ali", lastName: "Rezaei" });
    await expect(personsRepository.permanentlyDelete(person.id)).rejects.toThrow();
  });

  it("permanentlyDelete rejects an archived person referenced by an event", async () => {
    const person = await personsRepository.create({ firstName: "Ali", lastName: "Rezaei" });
    const event = await eventsRepository.create({ title: "سفر", treasurerPersonId: person.id });
    await eventMembersRepository.addMember(event.id, person.id);
    await personsRepository.setArchived(person.id, true);

    await expect(personsRepository.permanentlyDelete(person.id)).rejects.toThrow();
    expect(await personsRepository.referencingEvents(person.id)).toEqual([{ eventId: event.id, title: "سفر" }]);
  });

  it("permanentlyDelete removes an archived, unreferenced person and writes a purge tombstone", async () => {
    const person = await personsRepository.create({ firstName: "Ali", lastName: "Rezaei" });
    await personsRepository.setArchived(person.id, true);

    await personsRepository.permanentlyDelete(person.id);

    expect(await db.persons.get(person.id)).toBeUndefined();
    const ops = await db.operations.where("entityId").equals(person.id).filter((o) => o.type === "purge").toArray();
    expect(ops).toHaveLength(1);
  });
});
