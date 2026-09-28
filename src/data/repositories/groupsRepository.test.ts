import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { groupsRepository } from "./groupsRepository";

beforeEach(async () => {
  await db.groups.clear();
  await db.operations.clear();
});

describe("groupsRepository", () => {
  it("creates a group, trims its name, and logs a create operation", async () => {
    const group = await groupsRepository.create({ name: " خانواده ", personIds: ["p1", "p2"] });
    expect(group.name).toBe("خانواده");
    expect(group.personIds).toEqual(["p1", "p2"]);

    const ops = await db.operations.where("entityId").equals(group.id).toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("create");
  });

  it("updates a group and logs field-level changes", async () => {
    const group = await groupsRepository.create({ name: "خانواده", personIds: ["p1"] });
    await groupsRepository.update(group.id, { personIds: ["p1", "p2"] });

    const updated = await db.groups.get(group.id);
    expect(updated?.personIds).toEqual(["p1", "p2"]);
  });

  it("archives a group and logs an archive operation", async () => {
    const group = await groupsRepository.create({ name: "خانواده", personIds: ["p1"] });
    await groupsRepository.setArchived(group.id, true);

    const archived = await db.groups.get(group.id);
    expect(archived?.archived).toBe(true);
  });

  it("blocks creating a group with a name that normalizes to an existing non-archived group's name", async () => {
    await groupsRepository.create({ name: "کوهنوردی", personIds: ["p1"] });
    await expect(groupsRepository.create({ name: "كوهنوردي", personIds: ["p2"] })).rejects.toThrow();
  });

  it("allows creating a group whose name matches an archived group's name", async () => {
    const group = await groupsRepository.create({ name: "خانواده", personIds: ["p1"] });
    await groupsRepository.setArchived(group.id, true);
    await expect(groupsRepository.create({ name: "خانواده", personIds: ["p2"] })).resolves.toBeTruthy();
  });

  it("blocks renaming a group to another existing group's name", async () => {
    await groupsRepository.create({ name: "خانواده", personIds: ["p1"] });
    const other = await groupsRepository.create({ name: "دوستان", personIds: ["p2"] });
    await expect(groupsRepository.update(other.id, { name: "خانواده" })).rejects.toThrow();
  });
});
