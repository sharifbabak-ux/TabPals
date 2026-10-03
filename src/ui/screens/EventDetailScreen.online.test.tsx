import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/data/db";
import { eventMembersRepository, eventsRepository, personsRepository, vouchersRepository } from "@/data/repositories";
import type { OnlineRole } from "@/data/types";
import { EventDetailScreen } from "./EventDetailScreen";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  for (const table of db.tables) if (table.name !== "messageTemplates") await table.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function seed(roles: OnlineRole[] | null) {
  const ali = await personsRepository.create({ firstName: "علی", lastName: "رضایی" });
  const sara = await personsRepository.create({ firstName: "سارا", lastName: "احمدی" });
  const event = await eventsRepository.create({ title: "سفر شمال", treasurerPersonId: ali.id });
  await eventMembersRepository.addMembers(event.id, [ali.id, sara.id]);
  await vouchersRepository.createExpense({ eventId: event.id, expenseDate: "2026-01-01", description: "شام", totalAmount: 100, payers: [{ personId: ali.id, amount: 100 }], split: { mode: "equal_all" } });
  if (roles) {
    await db.onlineLinks.put({ localEventId: event.id, serverEventId: event.id, memberId: sara.id, roles, deviceToken: "t", lastSeq: 1, status: "online", createdAt: "x" });
  }
  return { event, ali, sara };
}

async function show(eventId: string, tab = "members") {
  // a fresh root per call: the tab is read from the URL once, at mount
  act(() => root.unmount());
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/events/${eventId}?tab=${tab}`]}>
        <Routes>
          <Route path="/events/:eventId" element={<EventDetailScreen />} />
        </Routes>
      </MemoryRouter>
    );
  });
  // let live queries resolve
  await act(async () => {
    await new Promise((r) => setTimeout(r, 120));
  });
}

const text = () => container.textContent ?? "";
async function waitForText(expected: string) {
  for (let i = 0; i < 40 && !text().includes(expected); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }
  expect(text()).toContain(expected);
}
const buttons = () => [...container.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
const hasButton = (label: string) => buttons().some((b) => b.includes(label));

describe("EventDetailScreen — online roles", () => {
  it("offline event: unchanged controls plus «آنلاین کردن ایونت»", async () => {
    const { event } = await seed(null);
    await show(event.id);
    expect(hasButton("ویرایش")).toBe(true);
    expect(hasButton("+ افزودن از اشخاص")).toBe(true);
    expect(hasButton("پایان ایونت")).toBe(true);
    expect(hasButton("آنلاین کردن ایونت")).toBe(true);
    expect(text()).not.toContain("وضعیت همگام‌سازی");
  });

  it("member device: badge + role chip, everything visible but every add/edit/close control is hidden", async () => {
    const { event } = await seed(["member"]);
    await show(event.id);
    expect(container.querySelector(".badge--online")?.textContent).toBe("آنلاین");
    expect(text()).toContain("عضو"); // role chip
    expect(text()).toContain("علی");
    expect(text()).toContain("سارا");
    for (const label of ["ویرایش", "+ افزودن از اشخاص", "+ شخص جدید", "وارد کردن از ایونت قبلی", "+ افزودن گروه", "پایان ایونت", "بازگشایی ایونت", "غیرفعال کردن", "آنلاین کردن ایونت", "دعوت", "اعضا و دسترسی‌ها"]) {
      expect(hasButton(label), label).toBe(false);
    }
    expect(container.querySelector(".member-row__handle")).toBeNull();
    expect(hasButton("خروج از ایونت آنلاین")).toBe(true);
    expect(text()).toContain("فقط‌خواندنی");

    await show(event.id, "vouchers");
    await waitForText("شام");
    expect(container.querySelector('button[aria-label="سند جدید"]')).toBeNull();

    await show(event.id, "orders");
    expect(hasButton("+ نشست جدید")).toBe(false);

    await show(event.id, "statements");
    expect(hasButton("صورت‌حساب من (پیش‌نمایش زنده)")).toBe(true);
    expect(hasButton("صدور صورت‌حساب همه‌ی اعضا")).toBe(false);
  });

  it("treasurer device keeps full write controls", async () => {
    const { event } = await seed(["treasurer", "member"]);
    await show(event.id);
    expect(hasButton("ویرایش")).toBe(true);
    expect(hasButton("+ افزودن از اشخاص")).toBe(true);
    expect(hasButton("پایان ایونت")).toBe(true);
    expect(hasButton("اعضا و دسترسی‌ها")).toBe(false); // admin only
    expect(hasButton("آنلاین کردن ایونت")).toBe(false); // already online
    expect(text()).toContain("مسئول صندوق");
  });

  it("admin sees «اعضا و دسترسی‌ها»", async () => {
    const { event } = await seed(["admin", "treasurer"]);
    await show(event.id);
    expect(hasButton("اعضا و دسترسی‌ها")).toBe(true);
  });
});
