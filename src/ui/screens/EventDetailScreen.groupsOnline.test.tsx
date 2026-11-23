import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/data/db";
import { eventMembersRepository, eventsRepository, personsRepository } from "@/data/repositories";
import { settlementGroupsRepository as groups } from "@/data/repositories/settlementGroupsRepository";
import { applyRemoteOperation } from "@/data/online/applyRemoteOperation";
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
  const ids: Record<string, string> = {};
  for (const n of ["صندوق", "الف", "ب", "ج"]) ids[n] = (await personsRepository.create({ firstName: n, lastName: "نمونه" })).id;
  const event = await eventsRepository.create({ title: "سفر", treasurerPersonId: ids["صندوق"] });
  await eventMembersRepository.addMembers(event.id, Object.values(ids));
  if (roles) await db.onlineLinks.put({ localEventId: event.id, serverEventId: event.id, memberId: "m1", roles, deviceToken: "t", lastSeq: 0, status: "online", createdAt: "2026-01-01T00:00:00.000Z" });
  return { event, ids };
}

async function wait(ms = 120) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
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
  await wait();
}
const text = () => container.textContent ?? "";
const addButton = () => container.querySelector('button[aria-label="گروه جدید"]');
const alertBox = () => container.querySelector('[data-testid="sg-invalid-alert"]');

describe("settlement groups in online events: permissions", () => {
  it.each([
    ["admin", ["admin"] as OnlineRole[], true],
    ["treasurer (not admin)", ["treasurer"] as OnlineRole[], true],
    ["plain member", ["member"] as OnlineRole[], false]
  ])("%s: can add = %s", async (_label, roles, canAdd) => {
    const { event } = await seed(roles);
    await show(event.id);
    expect(addButton() !== null).toBe(canAdd);
    // groups are synced now: the "only on this device" note is gone
    expect(text()).not.toContain("فقط روی همین دستگاه");
    if (!canAdd) expect(text()).toContain("فقط مدیر یا مسئول صندوق");
  });

  it("offline event: unchanged (can add, local-only note still shown)", async () => {
    const { event } = await seed(null);
    await show(event.id);
    expect(addButton()).not.toBeNull();
    expect(text()).toContain("فقط روی همین دستگاه");
  });
});

describe("settlement groups in online events: conflicting concurrent edits", () => {
  it("two devices put the same person in different groups → alert + individual fallback; fixing clears it", async () => {
    const { event, ids } = await seed(["treasurer"]);
    const mk = (id: string, name: string, members: string[], rep: string, seq: number) =>
      applyRemoteOperation(event.id, {
        seq,
        serverTs: "2026-01-01T00:00:00.000Z",
        memberId: "x",
        deviceId: "other",
        op: {
          id: `op-${seq}`,
          entity: "settlementGroups",
          entityId: id,
          type: "create",
          timestamp: 1_760_000_000_000 + seq,
          deviceId: "other",
          changes: { eventId: { before: undefined, after: event.id }, name: { before: undefined, after: name }, memberIds: { before: undefined, after: members }, representativeId: { before: undefined, after: rep } }
        }
      });
    await mk("G1", "گروه یک", [ids["الف"], ids["ب"]], ids["الف"], 1);
    await mk("G2", "گروه دو", [ids["ب"], ids["ج"]], ids["ج"], 2);
    await show(event.id);

    expect(alertBox()).not.toBeNull();
    expect(alertBox()!.textContent).toContain("هر نفر در هر رویداد فقط می‌تواند عضو یک گروه باشد.");
    expect(alertBox()!.textContent).toContain("ویرایش");
    // SG-4 fallback: balances/settlement fall back to individual mode with its warning
    expect(container.querySelector(".eu-warning")).not.toBeNull();

    await groups.update("G2", { memberIds: [ids["ج"], ids["صندوق"]], representativeId: ids["صندوق"] });
    await wait(200);
    expect(alertBox()).toBeNull();
    expect(container.querySelector(".eu-warning")).toBeNull();
  });

  it("a plain member sees the alert too, with wording that asks the admin/treasurer to fix it", async () => {
    const { event, ids } = await seed(["member"]);
    const now = new Date().toISOString();
    const base = { eventId: event.id, createdAt: now, updatedAt: now, deviceId: "d", version: 1, deleted: false };
    await db.settlementGroups.bulkAdd([
      { ...base, id: "G1", name: "یک", memberIds: [ids["الف"], ids["ب"]], representativeId: ids["الف"] },
      { ...base, id: "G2", name: "دو", memberIds: [ids["ب"], ids["ج"]], representativeId: ids["ج"] }
    ]);
    await show(event.id);
    expect(alertBox()!.textContent).toContain("از مدیر یا مسئول صندوق بخواهید");
    expect(addButton()).toBeNull();
  });
});
