import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/data/db";
import { getHidePaymentInExports } from "@/data/appSettings";
import { MaskedValue } from "@/ui/components/MaskedValue";
import { PrivacyScreen } from "@/ui/screens/PrivacyScreen";
import { SettingsScreen } from "@/ui/screens/SettingsScreen";
import { ThemeProvider } from "@/ui/theme";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? "";

beforeEach(async () => {
  await db.meta.clear();
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
}

describe("masked card numbers and IBANs", () => {
  it("shows ۵۸۵۹ ●●●● ●●●● ۳۷۲۴ by default and reveals the number on tap", async () => {
    await render(<MaskedValue kind="card" value="5859831012343724" />);
    expect(container.querySelector(".masked-value__text")?.textContent).toBe("۵۸۵۹ ●●●● ●●●● ۳۷۲۴");
    const button = container.querySelector<HTMLButtonElement>(".masked-value__toggle")!;
    await act(async () => button.click());
    expect(container.querySelector(".masked-value__text")?.textContent).toBe("5859 8310 1234 3724");
    await act(async () => button.click());
    expect(container.querySelector(".masked-value__text")?.textContent).toBe("۵۸۵۹ ●●●● ●●●● ۳۷۲۴");
  });

  it("an IBAN is masked too, and ciphertext shows the lock marker instead of a number", async () => {
    await render(
      <>
        <MaskedValue kind="iban" value="IR820540102680020817909002" />
        <MaskedValue kind="card" value="enc:v1:abc:def" />
      </>
    );
    expect(text()).toContain("●●●●");
    expect(container.querySelector(".masked-value__text")?.textContent).not.toContain("0540102680");
    expect(text()).toContain("🔒 در انتظار دریافت کلید");
  });
});

describe("privacy page and setting", () => {
  it("explains what is stored, what is encrypted, who sees what and the backup-key responsibility", async () => {
    await render(<PrivacyScreen />);
    for (const phrase of ["چه چیزی ذخیره می‌شود؟", "چه چیزی رمزگذاری می‌شود؟", "چه کسی چه چیزی می‌بیند؟", "کلید پشتیبان؛ مسئولیت شما", "غیرقابل‌بازیابی"]) {
      expect(text()).toContain(phrase);
    }
  });

  it("settings has the «عدم چاپ شماره‌کارت و شبا در خروجی‌ها» toggle, persisted, and a link to the privacy page", async () => {
    await render(
      <ThemeProvider>
        <SettingsScreen />
      </ThemeProvider>
    );
    expect(text()).toContain("حریم خصوصی");
    const toggle = container.querySelector<HTMLInputElement>('input[aria-label="عدم چاپ شماره‌کارت و شبا در خروجی‌ها"]')!;
    expect(toggle.checked).toBe(false);
    await act(async () => toggle.click());
    expect(await getHidePaymentInExports()).toBe(true);
    // the live query re-renders the controlled switch asynchronously
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(toggle.checked).toBe(true);
    await act(async () => toggle.click());
    expect(await getHidePaymentInExports()).toBe(false);
  });
});
