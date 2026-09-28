// Renders the source brand SVGs (src/ui/assets/) into the PWA icon PNGs and
// favicon.svg under public/. Uses Playwright + the container's pre-installed
// Chromium (see docs/design-preview screenshot script for the same pattern).
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const assetsDir = path.join(root, "src/ui/assets");
const publicDir = path.join(root, "public");
const iconsDir = path.join(publicDir, "icons");

const CHROME_CANDIDATES = [
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  process.env.PLAYWRIGHT_CHROMIUM_PATH
].filter(Boolean);

function resolveExecutablePath() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function renderSvgToPng(browser, svgPath, size, outPath) {
  const svg = readFileSync(svgPath, "utf-8");
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<!doctype html><html><head><style>
      html,body{margin:0;padding:0;background:transparent;}
      svg{display:block;width:${size}px;height:${size}px;}
    </style></head><body>${svg}</body></html>`
  );
  await page.locator("svg").screenshot({ path: outPath, omitBackground: true });
  await page.close();
}

async function main() {
  mkdirSync(iconsDir, { recursive: true });
  const executablePath = resolveExecutablePath();
  const browser = await chromium.launch({ executablePath });

  const iconLight = path.join(assetsDir, "logo-icon-light.svg");
  const iconMaskable = path.join(assetsDir, "logo-icon-maskable.svg");

  await renderSvgToPng(browser, iconLight, 192, path.join(iconsDir, "icon-192.png"));
  await renderSvgToPng(browser, iconLight, 512, path.join(iconsDir, "icon-512.png"));
  await renderSvgToPng(browser, iconMaskable, 512, path.join(iconsDir, "icon-maskable-512.png"));
  await renderSvgToPng(browser, iconLight, 180, path.join(publicDir, "apple-touch-icon.png"));

  writeFileSync(path.join(publicDir, "favicon.svg"), readFileSync(iconLight, "utf-8"));

  await browser.close();
  console.log("Icons generated.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
