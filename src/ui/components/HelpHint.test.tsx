import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HelpHint } from "./HelpHint";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function setCompact(compact: boolean) {
  window.matchMedia = ((query: string) => ({ matches: compact, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
}

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<HelpHint title="عنوان راهنما" body="متن کوتاه راهنما" />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

const button = () => container.querySelector<HTMLButtonElement>("button.help-hint__button")!;
const tooltip = () => document.body.querySelector('[role="tooltip"]');
const sheet = () => document.body.querySelector('[role="dialog"]');
const esc = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

describe("HelpHint — phone (touch / narrow)", () => {
  beforeEach(() => setCompact(true));

  it("is a real button with an accessible name", () => {
    expect(button().tagName).toBe("BUTTON");
    expect(button().getAttribute("type")).toBe("button");
    expect(button().getAttribute("aria-label")).toContain("عنوان راهنما");
  });

  it("tap opens a bottom sheet with title and body; × and Esc close it and focus returns to the button", async () => {
    await act(async () => button().click());
    expect(sheet()?.getAttribute("aria-label")).toBe("عنوان راهنما");
    expect(sheet()?.textContent).toContain("متن کوتاه راهنما");
    expect(tooltip()).toBeNull();

    await act(async () => esc());
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(button());

    await act(async () => button().click());
    await act(async () => document.body.querySelector<HTMLButtonElement>(".sheet__close")!.click());
    expect(sheet()).toBeNull();
  });
});

describe("HelpHint — desktop", () => {
  beforeEach(() => setCompact(false));

  it("shows a tooltip on hover and hides it on leave", async () => {
    expect(tooltip()).toBeNull();
    await act(async () => button().dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(tooltip()?.textContent).toContain("عنوان راهنما");
    expect(tooltip()?.textContent).toContain("متن کوتاه راهنما");
    expect(button().getAttribute("aria-describedby")).toBe(tooltip()?.id);
    await act(async () => button().dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    expect(tooltip()).toBeNull();
    expect(sheet()).toBeNull();
  });

  it("shows on keyboard focus, hides on blur, and Esc closes it", async () => {
    await act(async () => button().focus());
    expect(tooltip()).not.toBeNull();
    await act(async () => esc());
    expect(tooltip()).toBeNull();
    await act(async () => button().blur());
    await act(async () => button().focus());
    expect(tooltip()).not.toBeNull();
    await act(async () => button().blur());
    expect(tooltip()).toBeNull();
  });

  it("click toggles it open and closed", async () => {
    await act(async () => button().click());
    expect(tooltip()).not.toBeNull();
    await act(async () => button().click());
    expect(tooltip()).toBeNull();
  });
});
