import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/data/db";
import { eventMembersRepository, eventsRepository, personsRepository } from "@/data/repositories";
import { settlementGroupsRepository as groups } from "@/data/repositories/settlementGroupsRepository";
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

async function seed() {
  const ids: Record<string, string> = {};
  for (const n of ["صندوق", "الف", "ب", "ج", "د"]) ids[n] = (await personsRepository.create({ firstName: n, lastName: "نمونه" })).id;
  const event = await eventsRepository.create({ title: "سفر", treasurerPersonId: ids["صندوق"] });
  await eventMembersRepository.addMembers(event.id, Object.values(ids));
  return { event, ids };
}

async function show(eventId: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/events/${eventId}`]}>
        <Routes>
          <Route path="/events/:eventId" element={<EventDetailScreen />} />
        </Routes>
      </MemoryRouter>
    );
  });
  for (let i = 0; i < 40 && !text().includes("گروه‌های تسویه"); i++) await wait(50);
}
async function wait(ms = 120) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
const text = () => container.textContent ?? "";
async function deactivate(name: string) {
  const row = [...container.querySelectorAll("li")].find((li) => li.querySelector(".member-row__name, .list-item__title")?.textContent?.trim() === name);
  const btn = [...(row?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.includes("غیرفعال"))!;
  await act(async () => btn.click());
}
const confirmBtn = () => container.querySelector<HTMLButtonElement>(".confirm-dialog__confirm")!;
const activeOf = async (personId: string) => (await db.eventMembers.filter((m) => m.personId === personId).first())?.active;

describe("EventDetailScreen — deactivating a member who is in a settlement group", () => {
  it("shows the group in the confirmation, then repairs the group and deactivates", async () => {
    const { event, ids } = await seed();
    const g = await groups.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"], ids["ج"]], representativeId: ids["الف"] });
    await show(event.id);
    await deactivate("الف");
    expect(container.querySelector(".confirm-dialog")?.textContent).toContain("این نفر عضو گروه «خانواده» است؛ از گروه خارج می‌شود.");
    await act(async () => confirmBtn().click());
    await wait();
    expect(await activeOf(ids["الف"])).toBe(false);
    expect(await groups.get(g.id)).toMatchObject({ memberIds: [ids["ب"], ids["ج"]], representativeId: ids["ب"] });
  });

  it("a person in no group: plain dialog (no group text) and deactivation exactly as before", async () => {
    const { event, ids } = await seed();
    await groups.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["الف"] });
    await show(event.id);
    await deactivate("د");
    expect(container.querySelector(".confirm-dialog")?.textContent).not.toContain("گروه «");
    await act(async () => confirmBtn().click());
    await wait();
    expect(await activeOf(ids["د"])).toBe(false);
    expect((await groups.listByEvent(event.id)).length).toBe(1);
  });

  it("a treasurer-rule error blocks the deactivation and tells the admin what to change", async () => {
    const { event, ids } = await seed();
    const g = await groups.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"], ids["ج"]], representativeId: ids["الف"] });
    await db.events.update(event.id, { treasurerPersonId: ids["ب"] }); // treasurer changed afterwards
    await show(event.id);
    await deactivate("ج");
    await act(async () => confirmBtn().click());
    await wait();
    expect(await activeOf(ids["ج"])).toBe(true);
    expect((await groups.get(g.id))?.memberIds).toHaveLength(3);
    const alert = container.querySelector(".confirm-dialog")?.textContent ?? "";
    expect(alert).toContain("خارج کردن ممکن نیست");
    expect(alert).toContain("نماینده‌ی گروه یا مسئول صندوق ایونت را عوض کنید");
    expect(alert).not.toMatch(/Error|SettlementGroup/);
  });
});

describe("EventDetailScreen — settlement groups section", () => {
  it("is shown in the members tab with an add button for an offline event", async () => {
    const { event } = await seed();
    await show(event.id);
    expect(text()).toContain("گروه‌های تسویه");
    expect(container.querySelector('button[aria-label="گروه جدید"]')).not.toBeNull();
  });

  it("an online non-admin member sees the list but no add button", async () => {
    const { event, ids } = await seed();
    await groups.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["ب"] });
    await db.onlineLinks.put({ localEventId: event.id, serverEventId: event.id, memberId: ids["ج"], roles: ["member"], deviceToken: "t", lastSeq: 1, status: "online", createdAt: "x" });
    await show(event.id);
    expect(text()).toContain("خانواده");
    expect(container.querySelector('button[aria-label="گروه جدید"]')).toBeNull();
  });
});

const scrollSpy = vi.fn();
beforeEach(() => {
  scrollSpy.mockClear();
  // jsdom has no scrollIntoView
  Element.prototype.scrollIntoView = scrollSpy;
});

describe("EventDetailScreen — changing the treasurer when settlement groups exist (SG-4)", () => {
  it("blocks the change, names the group under the treasurer field, and keeps the treasurer", async () => {
    const { event, ids } = await seed();
    await groups.create({ eventId: event.id, name: "خانواده", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["الف"] });
    await show(event.id);
    const editBtn = container.querySelector<HTMLButtonElement>('button[aria-label="ویرایش ایونت"]')!;
    await act(async () => editBtn.click());
    await wait();
    const select = document.querySelector<HTMLSelectElement>("#event-treasurer")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, ids["ب"]);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const form = select.closest("form")!;
    await act(async () => {
      form.requestSubmit();
    });
    await wait();
    const alert = select.parentElement!.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("ابتدا نمایندهٔ گروه «خانواده»");
    expect((await db.events.get(event.id))!.treasurerPersonId).toBe(ids["صندوق"]);

    // Prominent alert block (Fix A): styled class, icon, bold title, explanation; scrolled into view; sits directly under the field.
    expect(alert?.classList.contains("event-form-alert")).toBe(true);
    expect(alert?.querySelector(".event-form-alert__icon")).not.toBeNull();
    expect(alert?.querySelector("strong")?.textContent).toBe("تغییر انجام نشد");
    expect(alert?.querySelector(".event-form-alert__text")?.textContent).toContain("ابتدا نمایندهٔ گروه «خانواده»");
    expect(select.nextElementSibling).toBe(alert);
    expect(scrollSpy).toHaveBeenCalled();

    // It stays until the field changes.
    expect(select.parentElement!.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, ids["صندوق"]);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(select.parentElement!.querySelector('[role="alert"]')).toBeNull();
  });
});
