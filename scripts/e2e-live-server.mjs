// Starts the REAL TabPals API server (sharifbabak-ux/Tabpals-Live) on an ephemeral port with an in-memory
// Postgres (pg-mem) and prints `PORT <n>`. Used only by the optional end-to-end test:
//   git clone https://github.com/sharifbabak-ux/Tabpals-Live.git && (cd Tabpals-Live && npm ci)
//   TABPALS_LIVE_DIR=$PWD/Tabpals-Live npm test -- realServer
import { pathToFileURL } from "node:url";
import path from "node:path";

const dir = process.env.TABPALS_LIVE_DIR;
if (!dir) {
  console.error("TABPALS_LIVE_DIR is required");
  process.exit(1);
}
const load = (file) => import(pathToFileURL(path.join(dir, file)).href);
const { createApp } = await load("src/app.js");
const { loadConfig } = await load("src/config.js");
const { migrate, wrapPool } = await load("src/db.js");
const { newDb } = await import(pathToFileURL(path.join(dir, "node_modules/pg-mem/index.js")).href).catch(() => import("pg-mem"));

const { Pool } = newDb().adapters.createPg();
const db = wrapPool(new Pool());
await migrate(db);
const config = loadConfig({}, { log: false, allowedOrigins: ["http://localhost"] });
const { httpServer } = createApp({ db, config });
httpServer.listen(0, () => console.log(`PORT ${httpServer.address().port}`));
