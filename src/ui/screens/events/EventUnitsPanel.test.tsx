import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/data/db";
import { eventMembersRepository, eventsRepository, personsRepository } from "@/data/repositories";
import { settlementGroupsRepository as repo } from "@/data/repositories/settlementGroupsRepository";
import { vouchersRepository } from "@/data/repositories/vouchersRepository";
import { EventUnitsPanel } from "./EventUnitsPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Balances: الف +400, ب −450, صندوق +50, ج 0. */
async function seed() {
  for (const table of db.tables) await table.clear();
  const ids: Record<string, string> = {};
  for (const n of ["صندوق", "الف", "ب", "ج"]) ids[n] = (await personsRepository.create({ firstName: n, lastName: "نمونه" })).id;
  const event = await eventsRepository.create({ title: "سفر", treasurerPersonId: ids["صندوق"] });
  await eventMembersRepository.addMembers(event.id, Object.values(ids));
  const pay = (from: string, to: string, totalAmount: number) =>
    vouchersRepository.createSettlement({ eventId: event.id, expenseDate: "2025-01-01", description: "نمونه", totalAmount, fromPersonId: ids[from], toPersonId: ids[to] });
  await pay("الف", "ب", 400);
  await pay("صندوق", "ب", 50);
  return { event, ids };
}

const text = () => container.textContent ?? "";
async function wait(ms = 120) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
async function show(eventId: string, treasurer: string | null) {
  await act(async () => root.render(<EventUnitsPanel eventId={eventId} treasurerPersonId={treasurer} currency="تومان" />));
  await wait();
}
const click = async (el: Element | undefined) => {
  await act(async () => (el as HTMLElement).click());
  await wait(30);
};
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));

describe("EventUnitsPanel", () => {
  it("renders nothing when the event has no groups (individual mode unchanged)", async () => {
    const { event, ids } = await seed();
    await show(event.id, ids["صندوق"]);
    expect(container.innerHTML).toBe("");
  });

  it("group block: one unit per group with total, representative, and expandable breakdown + cancelled amount", async () => {
    const { event, ids } = await seed();
    await repo.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["ب"] });
    await show(event.id, ids["صندوق"]);
    const card = container.querySelector('[data-testid="eu-group"]')!;
    expect(card.textContent).toContain("خانواده");
    expect(card.textContent).toContain("نماینده: ب");
    expect(card.textContent).toContain("۵۰");
    expect(card.textContent).toContain("بدهکار");
    expect(card.textContent).not.toContain("۴۵۰");
    await click(card.querySelector(".eu-toggle")!);
    expect(card.textContent).toContain("۴۵۰");
    expect(card.textContent).toContain("۴۰۰");
    expect(card.textContent).toContain("بدهی و طلب داخل گروه که با هم صفر شد: ۴۰۰");
    // people outside any group appear as their own unit
    expect(text()).toContain("صندوق");
  });

  it("settlement: switch is present and defaults to groups; transfer goes through the representative; individual mode still available", async () => {
    const { event, ids } = await seed();
    await repo.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["ب"] });
    await show(event.id, ids["صندوق"]);
    expect(button("تسویه: گروه‌ها")?.getAttribute("aria-selected")).toBe("true");
    const transfers = [...container.querySelectorAll('[data-testid="eu-transfer"]')];
    expect(transfers).toHaveLength(1);
    expect(transfers[0].textContent).toContain("نمایندهٔ گروه «خانواده» (ب) ← مسئول صندوق (صندوق)");
    expect(transfers[0].textContent).toContain("۵۰");
    await click(transfers[0].querySelector(".eu-toggle")!);
    expect(transfers[0].textContent).toContain("۴۵۰");

    await click(button("تسویه: افراد"));
    const individual = [...container.querySelectorAll('[data-testid="eu-transfer"]')].map((t) => t.textContent ?? "");
    expect(individual).toHaveLength(2);
    expect(individual.join("|")).toContain("ب ← مسئول صندوق");
    expect(individual.join("|")).toContain("۴۵۰");
    expect(individual.join("|")).toContain("مسئول صندوق (صندوق) ← الف");
  });

  it("has ⓘ help on the group block and on the settlement switch", async () => {
    const { event, ids } = await seed();
    await repo.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["ب"] });
    await show(event.id, ids["صندوق"]);
    expect(container.querySelectorAll(".help-hint, button[aria-label^='راهنما']").length).toBeGreaterThanOrEqual(2);
  });

  it("zero-sum group is marked settled and creates no transfer", async () => {
    const { event, ids } = await seed();
    const d = (await personsRepository.create({ firstName: "د", lastName: "نمونه" })).id;
    await eventMembersRepository.addMembers(event.id, [d]);
    // ج +100, د −100 → the group {ج, د} nets to zero
    await vouchersRepository.createSettlement({ eventId: event.id, expenseDate: "2025-01-01", description: "ن", totalAmount: 100, fromPersonId: ids["ج"], toPersonId: d });
    await repo.create({ eventId: event.id, name: "صفر", memberIds: [ids["ج"], d], representativeId: d });
    await show(event.id, ids["صندوق"]);
    expect(container.querySelector('[data-testid="eu-group"]')?.textContent).toContain("تسویه‌شده");
    // only الف and ب (individuals) still have transfers
    expect(container.querySelectorAll('[data-testid="eu-transfer"]').length).toBe(2);
  });

  it("treasurer inside a group: explanation about the part settled outside the app", async () => {
    const { event, ids } = await seed();
    await repo.create({ eventId: event.id, name: "خانواده", memberIds: [ids["صندوق"], ids["ج"]], representativeId: ids["صندوق"] });
    await show(event.id, ids["صندوق"]);
    expect(text()).toContain("مسئول صندوق عضو گروه «خانواده» است");
    expect(text()).toContain("بیرون از برنامه تسویه می‌شود");
  });

  it("invalid groups (legacy data): warning shown, no switch, individual transfers", async () => {
    const { event, ids } = await seed();
    const g = await repo.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["ب"] });
    // legacy/invalid: write directly, bypassing the repository validation
    await db.settlementGroups.update(g.id, { memberIds: [ids["الف"], ids["صندوق"]], representativeId: ids["الف"] });
    await show(event.id, ids["صندوق"]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("معتبر نیستند");
    expect(button("تسویه: گروه‌ها")).toBeUndefined();
    expect(container.querySelector('[data-testid="eu-group"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="eu-transfer"]').length).toBe(2);
  });
});
