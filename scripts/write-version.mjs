// Writes public version.json into the build output so a running app
// (or a future update-checker) can detect that a newer build exists.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: node scripts/write-version.mjs <outDir>");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));

const versionInfo = {
  version: pkg.version,
  buildDate: new Date().toISOString()
};

const outPath = resolve(process.cwd(), outDir, "version.json");
writeFileSync(outPath, JSON.stringify(versionInfo, null, 2) + "\n");
console.log(`wrote ${outPath}`, versionInfo);
