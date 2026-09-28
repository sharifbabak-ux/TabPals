import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { eventMembersRepository } from "./eventMembersRepository";

beforeEach(async () => {
  await db.eventMembers.clear();
  await db.operations.clear();
});

describe("eventMembersRepository", () => {
  it("adds a member once and is idempotent when called again while active", async () => {
    await eventMembersRepository.addMember("e1", "p1");
    await eventMembersRepository.addMember("e1", "p1");

    const members = await db.eventMembers.where({ eventId: "e1", personId: "p1" }).toArray();
    expect(members).toHaveLength(1);
    expect(members[0].active).toBe(true);

    const createOps = await db.operations.where("entityId").equals(members[0].id).filter((o) => o.type === "create").toArray();
    expect(createOps).toHaveLength(1);
  });

  it("reactivates a previously deactivated member instead of creating a duplicate row", async () => {
    await eventMembersRepository.addMember("e1", "p1");
    const [member] = await db.eventMembers.where({ eventId: "e1", personId: "p1" }).toArray();
    await eventMembersRepository.setActive(member.id, false);

    await eventMembersRepository.addMember("e1", "p1");

    const members = await db.eventMembers.where({ eventId: "e1", personId: "p1" }).toArray();
    expect(members).toHaveLength(1);
    expect(members[0].active).toBe(true);
    expect(members[0].id).toBe(member.id);
  });

  it("adds several members in bulk", async () => {
    await eventMembersRepository.addMembers("e1", ["p1", "p2", "p3"]);
    const members = await db.eventMembers.where("eventId").equals("e1").toArray();
    expect(members).toHaveLength(3);
  });

  it("logs an archive operation when deactivating a member", async () => {
    await eventMembersRepository.addMember("e1", "p1");
    const [member] = await db.eventMembers.where({ eventId: "e1", personId: "p1" }).toArray();

    await eventMembersRepository.setActive(member.id, false);

    const updated = await db.eventMembers.get(member.id);
    expect(updated?.active).toBe(false);

    const archiveOps = await db.operations.where("entityId").equals(member.id).filter((o) => o.type === "archive").toArray();
    expect(archiveOps).toHaveLength(1);
  });
});
