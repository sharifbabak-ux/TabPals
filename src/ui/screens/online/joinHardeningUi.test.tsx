import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncNow: vi.fn(async (_id: string) => undefined),
  createInvite: vi.fn(async (_eventId: string, _memberId: string) => ({ inviteId: 1, inviteToken: "tok", shortCode: "ABCD2345", expiresAt: "2030-01-01T00:00:00.000Z", url: "https://x/#/join?t=tok&c=ABCD2345" }))
}));
vi.mock("@/data/online/onlineService", () => ({ onlineService: { syncNow: mocks.syncNow, createInvite: mocks.createInvite, saveMyProfile: vi.fn() } }));

import { db } from "@/data/db";
import { InviteSheet } from "./InviteSheet";
import { MyBankSheet } from "./MyBankSheet";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const button = (label: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(label));

beforeEach(async () => {
  for (const table of db.tables) if (table.name !== "messageTemplates") await table.clear();
  mocks.syncNow.mockClear();
  mocks.createInvite.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(<MemoryRouter>{node}</MemoryRouter>);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 120));
  });
}

async function waitFor(condition: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!condition() && Date.now() - start < ms) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

describe("MyBankSheet when the person row is missing", () => {
  it("explains the problem, keeps Save disabled and offers a sync button; the form fills in once the person arrives", async () => {
    await db.onlineLinks.put({ localEventId: "E1", serverEventId: "E1", memberId: "P1", roles: ["member"], deviceToken: "t", lastSeq: 0, status: "online", createdAt: "x" });
    await render(<MyBankSheet open eventId="E1" onClose={() => undefined} />);
    await waitFor(() => text().includes("اطلاعات ایونت هنوز کامل دریافت نشده است"));
    expect(text()).toContain("اطلاعات ایونت هنوز کامل دریافت نشده است");
    expect((button("ذخیره") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => button("همگام‌سازی دوباره")!.click());
    expect(mocks.syncNow).toHaveBeenCalledWith("E1");

    await db.persons.add({ id: "P1", firstName: "سارا", lastName: "احمدی", createdAt: "x", updatedAt: "x", deviceId: "d", version: 1, deleted: false } as never);
    await waitFor(() => !text().includes("اطلاعات ایونت هنوز کامل دریافت نشده است"));
    expect(text()).not.toContain("اطلاعات ایونت هنوز کامل دریافت نشده است");
  });
});

describe("InviteSheet", () => {
  const member = { personId: "P1", name: "سارا" };

  it("does not create a server invite just by opening; creates one on the explicit tap", async () => {
    await render(<InviteSheet open eventId="E1" eventTitle="سفر" member={member} onClose={() => undefined} />);
    expect(mocks.createInvite).not.toHaveBeenCalled();
    expect(button("ساخت دعوت‌نامه")).toBeTruthy();
    await act(async () => button("ساخت دعوت‌نامه")!.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(mocks.createInvite).toHaveBeenCalledTimes(1);
    expect(text()).toContain("ABCD-2345");
  });

  it("autoCreate (after «جایگزینی دستگاه») creates the invite at once", async () => {
    await render(<InviteSheet open autoCreate eventId="E1" eventTitle="سفر" member={member} onClose={() => undefined} />);
    expect(mocks.createInvite).toHaveBeenCalledTimes(1);
    expect(text()).toContain("ABCD-2345");
  });
});
