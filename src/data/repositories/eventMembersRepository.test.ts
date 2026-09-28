import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { eventMembersRepository } from "./eventMembersRepository";
import { eventsRepository } from "./eventsRepository";

beforeEach(async () => {
  await db.events.clear();
  await db.eventMembers.clear();
  await db.operations.clear();
});

async function createOpenEvent() {
  return eventsRepository.create({ title: "سفر شمال" });
}

describe("eventMembersRepository", () => {
  it("adds a member once and is idempotent when called again while active", async () => {
    const event = await createOpenEvent();
    await eventMembersRepository.addMember(event.id, "p1");
    await eventMembersRepository.addMember(event.id, "p1");

    const members = await db.eventMembers.where({ eventId: event.id, personId: "p1" }).toArray();
    expect(members).toHaveLength(1);
    expect(members[0].active).toBe(true);

    const createOps = await db.operations.where("entityId").equals(members[0].id).filter((o) => o.type === "create").toArray();
    expect(createOps).toHaveLength(1);
  });

  it("reactivates a previously deactivated member instead of creating a duplicate row", async () => {
    const event = await createOpenEvent();
    await eventMembersRepository.addMember(event.id, "p1");
    const [member] = await db.eventMembers.where({ eventId: event.id, personId: "p1" }).toArray();
    await eventMembersRepository.setActive(member.id, false);

    await eventMembersRepository.addMember(event.id, "p1");

    const members = await db.eventMembers.where({ eventId: event.id, personId: "p1" }).toArray();
    expect(members).toHaveLength(1);
    expect(members[0].active).toBe(true);
    expect(members[0].id).toBe(member.id);
  });

  it("adds several members in bulk", async () => {
    const event = await createOpenEvent();
    await eventMembersRepository.addMembers(event.id, ["p1", "p2", "p3"]);
    const members = await db.eventMembers.where("eventId").equals(event.id).toArray();
    expect(members).toHaveLength(3);
  });

  it("logs an archive operation when deactivating a member", async () => {
    const event = await createOpenEvent();
    await eventMembersRepository.addMember(event.id, "p1");
    const [member] = await db.eventMembers.where({ eventId: event.id, personId: "p1" }).toArray();

    await eventMembersRepository.setActive(member.id, false);

    const updated = await db.eventMembers.get(member.id);
    expect(updated?.active).toBe(false);

    const archiveOps = await db.operations.where("entityId").equals(member.id).filter((o) => o.type === "archive").toArray();
    expect(archiveOps).toHaveLength(1);
  });

  it("assigns increasing sortOrder as members are added", async () => {
    const event = await createOpenEvent();
    await eventMembersRepository.addMembers(event.id, ["p1", "p2", "p3"]);
    const members = (await db.eventMembers.where("eventId").equals(event.id).toArray()).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(members.map((m) => m.personId)).toEqual(["p1", "p2", "p3"]);
    expect(members.map((m) => m.sortOrder)).toEqual([0, 1, 2]);
  });

  it("reorders members and logs the change", async () => {
    const event = await createOpenEvent();
    await eventMembersRepository.addMembers(event.id, ["p1", "p2", "p3"]);
    const members = (await db.eventMembers.where("eventId").equals(event.id).toArray()).sort((a, b) => a.sortOrder - b.sortOrder);
    const [m1, m2, m3] = members;

    await eventMembersRepository.reorder(event.id, [m3.id, m1.id, m2.id]);

    expect((await db.eventMembers.get(m3.id))?.sortOrder).toBe(0);
    expect((await db.eventMembers.get(m1.id))?.sortOrder).toBe(1);
    expect((await db.eventMembers.get(m2.id))?.sortOrder).toBe(2);

    const ops = await db.operations
      .where("entityId")
      .equals(m3.id)
      .filter((o) => o.type === "update" && "sortOrder" in o.changes)
      .toArray();
    expect(ops).toHaveLength(1);
  });

  it("blocks adding, deactivating and reordering members on a closed event", async () => {
    const event = await createOpenEvent();
    await eventMembersRepository.addMember(event.id, "p1");
    const [member] = await db.eventMembers.where({ eventId: event.id, personId: "p1" }).toArray();
    await eventsRepository.close(event.id);

    await expect(eventMembersRepository.addMember(event.id, "p2")).rejects.toThrow();
    await expect(eventMembersRepository.setActive(member.id, false)).rejects.toThrow();
    await expect(eventMembersRepository.reorder(event.id, [member.id])).rejects.toThrow();
  });
});
