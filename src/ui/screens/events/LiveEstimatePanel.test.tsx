import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/data/db";
import { eventMembersRepository, eventsRepository, personsRepository } from "@/data/repositories";
import { orderSessionsRepository } from "@/data/repositories/orderSessionsRepository";
import { settlementGroupsRepository as repo } from "@/data/repositories/settlementGroupsRepository";
import { vouchersRepository } from "@/data/repositories/vouchersRepository";
import { computeBalances } from "@/domain/balanceEngine";
import { formatAmount } from "@/domain/format";
import { LiveEstimatePanel } from "./LiveEstimatePanel";

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

/** آرمان paid 600 for آرمان,بهرام,جمشید,داریوش (150 each); صندوق and هومن are at 0. */
async function seed() {
  for (const table of db.tables) await table.clear();
  const ids: Record<string, string> = {};
  for (const n of ["صندوق", "آرمان", "بهرام", "جمشید", "داریوش", "هومن"]) ids[n] = (await personsRepository.create({ firstName: n, lastName: "نمونه" })).id;
  const event = await eventsRepository.create({ title: "سفر", treasurerPersonId: ids["صندوق"] });
  await eventMembersRepository.addMembers(event.id, Object.values(ids));
  await vouchersRepository.createExpense({
    eventId: event.id,
    expenseDate: "2025-01-01",
    description: "شام",
    totalAmount: 600,
    payers: [{ personId: ids["آرمان"], amount: 600 }],
    split: { mode: "equal_selected", participantPersonIds: [ids["آرمان"], ids["بهرام"], ids["جمشید"], ids["داریوش"]] }
  });
  return { event, ids };
}

const text = () => container.textContent ?? "";
async function wait(ms = 120) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
async function show(eventId: string, treasurer: string | null) {
  await act(async () => root.render(<LiveEstimatePanel eventId={eventId} treasurerPersonId={treasurer} currency="تومان" />));
  await wait();
}
const click = async (el: Element | undefined) => {
  await act(async () => (el as HTMLElement).click());
  await wait(30);
};
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));

describe("LiveEstimatePanel", () => {
  it("shows the provisional header, badge, line and calculation time", async () => {
    const { event, ids } = await seed();
    await show(event.id, ids["صندوق"]);
    expect(text()).toContain("برآورد وضعیت حساب تا این لحظه");
    expect(text()).toContain("موقت — تا لحظه‌ی حال");
    expect(text()).toContain("با ثبت اسناد جدید تغییر می‌کند؛ صورت‌حساب رسمی بعد از بستن رویداد صادر می‌شود.");
    expect(text()).toContain("زمان محاسبه:");
    expect(text()).not.toContain("ایونت");
  });

  it("people view (no groups): figures equal the engine output, with the creditor/debtor wording", async () => {
    const { event, ids } = await seed();
    await show(event.id, ids["صندوق"]);
    const vouchers = await db.vouchers.where("eventId").equals(event.id).toArray();
    const engine = computeBalances(Object.values(ids), vouchers);
    const rows = [...container.querySelectorAll('[data-testid="live-person"]')];
    expect(rows).toHaveLength(6);
    for (const b of engine) {
      const name = [...Object.entries(ids)].find(([, id]) => id === b.personId)![0];
      const row = rows.find((r) => r.textContent?.includes(name))!;
      expect(row.textContent).toContain(formatAmount(Math.abs(b.balance)));
      if (b.balance > 0) expect(row.textContent).toContain("طلبکار");
      if (b.balance < 0) expect(row.textContent).toContain("بدهکار");
    }
    expect(container.querySelector('[data-testid="live-group"]')).toBeNull();
    expect(button("گروه‌ها")).toBeUndefined();
  });

  it("group view: balance = exact member sum, internal cancellation, representative, count, expandable members, ungrouped people individually", async () => {
    const { event, ids } = await seed();
    await repo.create({ eventId: event.id, name: "خانواده", memberIds: [ids["آرمان"], ids["بهرام"]], representativeId: ids["بهرام"] });
    await show(event.id, ids["صندوق"]);
    const group = container.querySelector('[data-testid="live-group"]')!;
    expect(group.textContent).toContain("خانواده");
    expect(group.textContent).toContain("نماینده");
    expect(group.textContent).toContain("۲ نفر");
    expect(group.textContent).toContain(formatAmount(300)); // 450 − 150
    expect(group.textContent).toContain("طلبکار");
    expect(group.textContent).toContain(formatAmount(150)); // internally cancelled min(450,150)
    expect(group.textContent).toContain("بدهی و طلب داخل گروه");
    expect(group.textContent).not.toContain("آرمان"); // members are collapsed
    await click(group.querySelector(".eu-toggle")!);
    expect(group.textContent).toContain("آرمان");
    expect(group.textContent).toContain(formatAmount(450));
    // ungrouped people stay individual units; grouped ones do not
    const people = [...container.querySelectorAll('[data-testid="live-person"]')].map((r) => r.textContent ?? "");
    expect(people).toHaveLength(4);
    expect(people.some((t) => t.includes("جمشید"))).toBe(true);
    expect(people.some((t) => t.includes("بهرام"))).toBe(false);

    // toggle to people view lists everyone individually
    await click(button("افراد"));
    expect(container.querySelector('[data-testid="live-group"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="live-person"]')).toHaveLength(6);
    await click(button("گروه‌ها"));
    expect(container.querySelector('[data-testid="live-group"]')).not.toBeNull();
  });

  it("invalid groups fall back to the people view with the same warning", async () => {
    const { event, ids } = await seed();
    await repo.create({ eventId: event.id, name: "خانواده", memberIds: [ids["آرمان"], ids["بهرام"]], representativeId: ids["بهرام"] });
    const row = await db.eventMembers.filter((m) => m.personId === ids["بهرام"]).first();
    await db.eventMembers.delete(row!.id); // a concurrent edit removed a member → unknown-person
    await show(event.id, ids["صندوق"]);
    expect(text()).toContain("گروه‌های این رویداد الان معتبر نیستند");
    expect(container.querySelector('[data-testid="live-group"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="live-person"]').length).toBeGreaterThan(0);
    expect(button("افراد")).toBeUndefined();
  });

  it("notes unfinalized sessions only when there are some", async () => {
    const { event, ids } = await seed();
    await show(event.id, ids["صندوق"]);
    expect(text()).not.toContain("نشست باز");
    await orderSessionsRepository.create({ eventId: event.id, title: "ناهار", scheduledAt: "2025-09-28T12:00:00.000Z" });
    const s2 = await orderSessionsRepository.create({ eventId: event.id, title: "شام", scheduledAt: "2025-09-28T18:00:00.000Z" });
    await orderSessionsRepository.transition(s2.id, "cancelled", "تست");
    await show(event.id, ids["صندوق"]);
    expect(text()).toContain("۱ نشست باز؛ سفارش‌های آن‌ها هنوز در حساب نیست");
  });

  it("offers no statement / payment / settlement actions", async () => {
    const { event, ids } = await seed();
    await repo.create({ eventId: event.id, name: "خانواده", memberIds: [ids["آرمان"], ids["بهرام"]], representativeId: ids["بهرام"] });
    await show(event.id, ids["صندوق"]);
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent ?? "");
    for (const l of labels) expect(l).not.toMatch(/صورت‌حساب|ارسال|پرداخت|ثبت|صدور|تسویه/);
    expect(text()).not.toContain("مسئول صندوق ←");
  });
});
