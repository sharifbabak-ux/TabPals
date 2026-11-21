import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { deactivateEventMember } from "./memberDeactivation";
import { eventMembersRepository } from "./repositories/eventMembersRepository";
import { eventsRepository } from "./repositories/eventsRepository";
import { settlementGroupsRepository as groups } from "./repositories/settlementGroupsRepository";

beforeEach(async () => {
  await Promise.all([db.events.clear(), db.eventMembers.clear(), db.settlementGroups.clear(), db.operations.clear()]);
});

async function setup() {
  const event = await eventsRepository.create({ title: "سفر", treasurerPersonId: "t" });
  await eventMembersRepository.addMembers(event.id, ["t", "a", "b", "c", "d"]);
  const rows = await db.eventMembers.where("eventId").equals(event.id).toArray();
  const row = (personId: string) => rows.find((r) => r.personId === personId)!;
  return { event, row };
}

describe("deactivateEventMember", () => {
  it("repairs the group first, then deactivates (person in a group)", async () => {
    const { event, row } = await setup();
    const g = await groups.create({ eventId: event.id, name: "خانواده", memberIds: ["a", "b", "c"], representativeId: "a" });
    const result = await deactivateEventMember(row("a").id, event.id, "a");
    expect(result.status).toBe("done");
    expect((await groups.get(g.id))?.memberIds).toEqual(["b", "c"]);
    expect((await groups.get(g.id))?.representativeId).toBe("b");
    expect((await db.eventMembers.get(row("a").id))?.active).toBe(false);
  });

  it("dissolves a 2-person group", async () => {
    const { event, row } = await setup();
    const g = await groups.create({ eventId: event.id, name: "زوج", memberIds: ["a", "b"], representativeId: "a" });
    const result = await deactivateEventMember(row("b").id, event.id, "b");
    expect(result).toMatchObject({ status: "done", groupOutcome: { notice: "dissolved" } });
    expect(await groups.get(g.id)).toBeUndefined();
  });

  it("behaves as before for a person in no group", async () => {
    const { event, row } = await setup();
    await groups.create({ eventId: event.id, name: "زوج", memberIds: ["a", "b"], representativeId: "a" });
    const result = await deactivateEventMember(row("d").id, event.id, "d");
    expect(result).toEqual({ status: "done", groupOutcome: null });
    expect((await db.eventMembers.get(row("d").id))?.active).toBe(false);
    expect((await groups.listByEvent(event.id)).length).toBe(1);
  });

  it("is blocked by the treasurer rule: nothing changes, member stays active", async () => {
    const { event, row } = await setup();
    // Treasurer changed to "b" after the group (representative "a") was made: the stored group now breaks the rule.
    const g = await groups.create({ eventId: event.id, name: "الف", memberIds: ["a", "b", "c"], representativeId: "a" });
    await db.events.update(event.id, { treasurerPersonId: "b" });
    const result = await deactivateEventMember(row("c").id, event.id, "c");
    expect(result).toEqual({ status: "blocked", codes: ["treasurer-must-represent"] });
    expect((await db.eventMembers.get(row("c").id))?.active).toBe(true);
    expect((await groups.get(g.id))?.memberIds).toEqual(["a", "b", "c"]);
  });
});
