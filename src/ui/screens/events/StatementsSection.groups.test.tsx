import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/data/db";
import { eventMembersRepository, eventsRepository, personsRepository, statementsRepository } from "@/data/repositories";
import { settlementGroupsRepository } from "@/data/repositories/settlementGroupsRepository";
import { vouchersRepository } from "@/data/repositories/vouchersRepository";
import { StatementsSection } from "./StatementsSection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  for (const table of db.tables) if (table.name !== "messageTemplates") await table.clear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function seed() {
  const ids: Record<string, string> = {};
  for (const n of ["ت", "الف", "ب", "ج"]) ids[n] = (await personsRepository.create({ firstName: n, lastName: "نمونه" })).id;
  const event = await eventsRepository.create({ title: "سفر نمونه", treasurerPersonId: ids["ت"] });
  await eventMembersRepository.addMembers(event.id, Object.values(ids));
  await vouchersRepository.createSettlement({ eventId: event.id, expenseDate: "2025-01-01", description: "نمونه", totalAmount: 400, fromPersonId: ids["الف"], toPersonId: ids["ب"] });
  await vouchersRepository.createSettlement({ eventId: event.id, expenseDate: "2025-01-01", description: "نمونه", totalAmount: 50, fromPersonId: ids["ت"], toPersonId: ids["ب"] });
  return { event, ids };
}

const text = () => container.textContent ?? "";
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
async function wait(ms = 150) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
async function show(event: { id: string; title: string }, treasurer: string) {
  const members = (await db.eventMembers.where("eventId").equals(event.id).toArray()).map((m) => ({ personId: m.personId, name: m.personId }));
  await act(async () =>
    root.render(
      <MemoryRouter>
        <StatementsSection eventId={event.id} eventTitle={event.title} eventClosed treasurerPersonId={treasurer} activeMembers={members} onRequestSetTreasurer={() => undefined} />
      </MemoryRouter>
    )
  );
  await wait();
}

describe("StatementsSection — group statements (SG-5)", () => {
  it("shows the group buttons only when the event has valid groups", async () => {
    const { event, ids } = await seed();
    await eventsRepository.close(event.id);
    await show(event, ids["ت"]);
    expect(button("صدور صورت‌حساب همه‌ی اعضا")).toBeDefined();
    expect(button("صدور صورت‌حساب گروه‌ها")).toBeUndefined();
    expect(button("صدور برای یک گروه")).toBeUndefined();

    await settlementGroupsRepository.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["ب"] });
    await wait();
    expect(button("صدور صورت‌حساب گروه‌ها")).toBeDefined();
    expect(button("صدور برای یک گروه")).toBeDefined();
  });

  it("an invalid group gets a short Persian reason and no buttons", async () => {
    const { event, ids } = await seed();
    const g = await settlementGroupsRepository.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["ب"] });
    await eventsRepository.close(event.id);
    await db.settlementGroups.update(g.id, { memberIds: [ids["الف"]], representativeId: ids["الف"] });
    await show(event, ids["ت"]);
    expect(button("صدور صورت‌حساب گروه‌ها")).toBeUndefined();
    const note = container.querySelector('[data-testid="group-statement-invalid"]')!;
    expect(note.textContent).toContain("گروه «خانواده» معتبر نیست");
    expect(note.textContent).toContain("حداقل ۲ عضو");
  });

  it("issued group statements are listed with the group name, and become «نیازمند صدور مجدد» when the group changes", async () => {
    const { event, ids } = await seed();
    const g = await settlementGroupsRepository.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["ب"] });
    await eventsRepository.close(event.id);
    await show(event, ids["ت"]);
    await act(async () => button("صدور صورت‌حساب گروه‌ها")!.click());
    await wait();
    expect(text()).toContain("صورت‌حساب گروه · خانواده");
    expect(text()).toContain("معتبر");
    expect(text()).not.toContain("نیازمند صدور مجدد");

    await settlementGroupsRepository.update(g.id, { name: "نام جدید" });
    await wait();
    expect(text()).toContain("نیازمند صدور مجدد");

    // issuing for one group from the picker re-issues it
    await act(async () => button("صدور برای یک گروه")!.click());
    await wait(30);
    await act(async () => ([...document.querySelectorAll(".list-item")].find((el) => el.textContent?.includes("نام جدید")) as HTMLElement).click());
    await wait();
    expect((await statementsRepository.list(event.id)).filter((s) => s.kind === "group" && s.status === "current")).toHaveLength(1);
    // the superseded version stays listed as outdated; the new one is valid
    expect(container.querySelectorAll(".statement-status-chip--current")).toHaveLength(1);
    expect(container.querySelectorAll(".statement-status-chip--outdated")).toHaveLength(1);
  });
});
