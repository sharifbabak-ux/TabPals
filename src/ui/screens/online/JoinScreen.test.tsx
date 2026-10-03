import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  standalone: false,
  os: "android" as "android" | "ios" | "other",
  join: vi.fn(async (_input: { inviteToken?: string; shortCode?: string }) => "EVENT1"),
  copy: vi.fn(async (_text: string) => true)
}));

vi.mock("@/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform")>();
  return {
    ...actual,
    platform: { getInfo: () => ({ kind: "web", isStandalone: mocks.standalone, os: mocks.os, deviceLabel: "test" }) },
    clipboardService: { copyText: mocks.copy }
  };
});
vi.mock("@/data/online/onlineService", () => ({ onlineService: { joinWithInvite: mocks.join } }));

import { JoinScreen } from "./JoinScreen";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname}</output>;
}

async function renderAt(url: string) {
  await act(async () => {
    root.render(
      <StrictMode>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/join" element={<JoinScreen />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>
    );
  });
}

beforeEach(() => {
  mocks.join.mockClear();
  mocks.copy.mockClear();
  mocks.standalone = false;
  mocks.os = "android";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const text = () => container.textContent ?? "";
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));

describe("#/join in a browser tab (not installed)", () => {
  it("asks to install first, with Android and iPhone steps, the big short code and a continue-in-browser option — and does not redeem", async () => {
    await renderAt("/join?t=tok-browser&c=ABCD2345");
    expect(text()).toContain("ابتدا برنامه را نصب کنید");
    expect(text()).toContain("اندروید");
    expect(text()).toContain("آیفون");
    expect(text()).toContain("Add to Home Screen");
    expect(text()).toContain("Install app");
    expect(container.querySelector(".invite-code")?.textContent).toBe("ABCD-2345");
    expect(text()).toContain("«پیوستن با دعوت» را بزنید و این کد را وارد کنید");
    expect(button("ادامه در همین مرورگر")).toBeTruthy();
    expect(mocks.join).not.toHaveBeenCalled();

    await act(async () => button("کپی کد")!.click());
    expect(mocks.copy).toHaveBeenCalledWith("ABCD2345");
  });

  it("puts the iPhone steps first on iOS", async () => {
    mocks.os = "ios";
    await renderAt("/join?t=tok-ios");
    const titles = [...container.querySelectorAll(".online-card h3")].map((h) => h.textContent);
    expect(titles[0]).toBe("آیفون");
    expect(container.querySelector(".invite-code")).toBeNull(); // no code in this link
  });

  it("«ادامه در همین مرورگر» redeems the token exactly once and opens the event", async () => {
    await renderAt("/join?t=tok-continue");
    await act(async () => button("ادامه در همین مرورگر")!.click());
    expect(mocks.join).toHaveBeenCalledTimes(1);
    expect(mocks.join).toHaveBeenCalledWith({ inviteToken: "tok-continue" });
    expect(container.querySelector("[data-testid=where]")?.textContent).toBe("/events/EVENT1");
  });
});

describe("#/join in the installed app", () => {
  it("redeems directly — once, even under StrictMode double effects", async () => {
    mocks.standalone = true;
    await renderAt("/join?t=tok-standalone&c=ABCD2345");
    expect(text()).not.toContain("ابتدا برنامه را نصب کنید");
    expect(mocks.join).toHaveBeenCalledTimes(1);
    expect(mocks.join).toHaveBeenCalledWith({ inviteToken: "tok-standalone" });
    expect(container.querySelector("[data-testid=where]")?.textContent).toBe("/events/EVENT1");
  });

  it("shows the Persian server error when the invite is no longer valid", async () => {
    mocks.standalone = true;
    mocks.join.mockRejectedValueOnce(new Error("این دعوت‌نامه قبلاً استفاده شده است."));
    await renderAt("/join?t=tok-used");
    expect(text()).toContain("این دعوت‌نامه قبلاً استفاده شده است.");
  });
});

describe("#/join without a token", () => {
  it("shows an invalid-link message and the manual join entry", async () => {
    await renderAt("/join");
    expect(text()).toContain("لینک دعوت معتبر نیست");
    expect(button("پیوستن با کد دعوت")).toBeTruthy();
  });
});
