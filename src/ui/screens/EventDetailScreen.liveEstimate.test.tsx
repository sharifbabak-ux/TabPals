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
  if (roles) await db.onlineLinks.put({ localEventId: event.id, serverEventId: event.id, memberId: sara.id, roles, deviceToken: "t", lastSeq: 1, status: "online", createdAt: "x" });
  return event;
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
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
}
const text = () => container.textContent ?? "";
async function until(cond: () => boolean) {
  for (let i = 0; i < 60 && !cond(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }
}

describe("EventDetailScreen — LIVE-1 estimate gating", () => {
  it("open event shows the estimate with the engine's figures (50 / −50)", async () => {
    const event = await seed(null);
    await show(event.id);
    await until(() => container.querySelector('[data-testid="live-estimate"]') !== null);
    const section = container.querySelector('[data-testid="live-estimate"]')!;
    expect(section).not.toBeNull();
    expect(section.textContent).toContain("طلبکار");
    expect(section.textContent).toContain("بدهکار");
    expect(section.textContent).toContain("۵۰");
  });

  it("closed event is unchanged: no estimate", async () => {
    const event = await seed(null);
    await eventsRepository.close(event.id);
    await show(event.id);
    await until(() => text().includes("تراز افراد"));
    expect(container.querySelector('[data-testid="live-estimate"]')).toBeNull();
    expect(text()).not.toContain("برآورد وضعیت حساب");
    expect(text()).toContain("تراز افراد");
  });

  it("plain online member sees it read-only, with no actions", async () => {
    const event = await seed(["member"]);
    await show(event.id);
    await until(() => container.querySelector('[data-testid="live-estimate"]') !== null);
    const section = container.querySelector('[data-testid="live-estimate"]')!;
    expect(section).not.toBeNull();
    expect(section.querySelectorAll("button")).toHaveLength(0);
  });
});
