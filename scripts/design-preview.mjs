// Drives the running dev server through a realistic Persian data flow and
// captures docs/design-preview/*.png screenshots (light + dark) for the
// Stage 2.5 visual design review. Sample data is created only inside this
// throwaway browser profile's IndexedDB — never committed as app data.
import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "docs/design-preview");
const base = process.env.PREVIEW_BASE_URL ?? "http://localhost:5183/TabPals/";

const CHROME_CANDIDATES = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", process.env.PLAYWRIGHT_CHROMIUM_PATH].filter(Boolean);
function resolveExecutablePath() {
  for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate;
  return undefined;
}

const PERSONS = ["علی رضایی", "سارا محمدی", "حسین کریمی", "مریم احمدی", "نیما صادقی"];

async function setTheme(page, mode) {
  await page.evaluate((m) => document.documentElement.setAttribute("data-theme", m), mode);
  await page.waitForTimeout(80);
}

async function shot(page, name, locator) {
  await setTheme(page, "light");
  const target = locator ? locator(page) : page;
  await target.screenshot({ path: path.join(outDir, `${name}-light.png`) });
  await setTheme(page, "dark");
  await target.screenshot({ path: path.join(outDir, `${name}-dark.png`) });
  await setTheme(page, "light");
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const executablePath = resolveExecutablePath();
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Disable CSS animations/transitions for the automated flow (reapplied on
  // every navigation) — they only add flakiness to Playwright's actionability
  // checks here, not to the real app.
  await context.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }";
      document.head.appendChild(style);
    });
  });
  const page = await context.newPage();

  // --- Seed: people -------------------------------------------------
  await page.goto(`${base}#/people`);
  for (const name of PERSONS) {
    await page.getByLabel("افزودن شخص").click();
    await page.locator("#person-name").fill(name);
    await page.getByRole("button", { name: "ذخیره" }).click();
    await page.waitForTimeout(80);
  }
  await shot(page, "people-list");

  // --- Seed: event ----------------------------------------------------
  await page.goto(`${base}#/events`);
  await page.getByLabel("ایونت جدید").click();
  await page.locator("#event-title").fill("سفر شمال");
  await page.locator("#event-start").fill("2026-10-02");
  await page.locator("#event-end").fill("2026-10-05");
  await page.getByRole("button", { name: "ایجاد" }).click();
  await page.waitForURL(/#\/events\/.+/);
  const eventUrl = page.url();

  await page.goto(`${base}#/events`);
  await shot(page, "events-list");
  await page.goto(eventUrl);

  // --- Add all persons as members --------------------------------------
  await page.getByRole("button", { name: "+ افزودن از اشخاص" }).click();
  await page.getByRole("button", { name: "انتخاب همه" }).click();
  await page.getByRole("button", { name: /^افزودن/ }).click();
  await page.waitForTimeout(150);

  // --- Seed vouchers: two expenses, a contribution, a settlement -------
  async function newExpense(desc, amount) {
    await page.getByLabel("سند جدید").click();
    await page.getByRole("dialog").locator(".list-item", { hasText: "هزینه" }).first().click();
    await page.locator(".amount-input--large").fill(String(amount));
    await page.getByRole("button", { name: "ادامه" }).click();
    await page.locator(".wizard-step ul.list .list-item").first().click();
    await page.locator("#expense-description").fill(desc);
    await page.getByRole("button", { name: "ادامه" }).click();
    await page.getByRole("button", { name: "بله، ذخیره کن" }).click();
    await page.waitForTimeout(150);
  }

  await page.getByRole("tab", { name: "اسناد" }).click();
  await page.waitForTimeout(80);
  await newExpense("شام رستوران", 480000);
  await newExpense("بلیط بازی", 320000);

  await page.getByLabel("سند جدید").click();
  await page.getByRole("dialog").locator(".list-item", { hasText: "واریز به خزانه‌دار" }).first().click();
  await page.locator("#transfer-amount").fill("1000000");
  await page.locator("#transfer-from").selectOption({ index: 1 });
  await page.locator("#transfer-to").selectOption({ index: 2 });
  await page.locator("#transfer-description").fill("واریز نقدی برای هزینه‌ها");
  await page.getByRole("button", { name: "ذخیره" }).click();
  await page.waitForTimeout(150);

  await page.getByLabel("سند جدید").click();
  await page.getByRole("dialog").locator(".list-item", { hasText: "تسویه" }).first().click();
  await page.locator("#transfer-amount").fill("150000");
  await page.locator("#transfer-from").selectOption({ index: 3 });
  await page.locator("#transfer-to").selectOption({ index: 1 });
  await page.locator("#transfer-description").fill("تسویه حساب تاکسی");
  await page.getByRole("button", { name: "ذخیره" }).click();
  await page.waitForTimeout(150);

  await shot(page, "event-detail-vouchers");

  await page.getByRole("tab", { name: "اعضا" }).click();
  await page.waitForTimeout(80);
  await shot(page, "event-detail-members");
  await shot(page, "balances-panel", (p) => p.locator(".balances-panel"));
  await page.getByRole("tab", { name: "اسناد" }).click();
  await page.waitForTimeout(80);

  // --- New expense flow: amount + split steps (left open, not saved) ---
  await page.getByLabel("سند جدید").click();
  await page.getByRole("dialog").locator(".list-item", { hasText: "هزینه" }).first().click();
  await shot(page, "new-expense-amount");

  await page.locator(".amount-input--large").fill("600000");
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.locator(".wizard-step ul.list .list-item").first().click();
  await page.locator("#expense-description").fill("اجاره ویلا");
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("button", { name: "خیر", exact: true }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("button", { name: "خیر", exact: true }).click();
  await shot(page, "new-expense-split");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);

  // --- Settings ---------------------------------------------------------
  await page.goto(`${base}#/settings`);
  await shot(page, "settings");

  await browser.close();
  console.log("Preview screenshots written to", outDir);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
