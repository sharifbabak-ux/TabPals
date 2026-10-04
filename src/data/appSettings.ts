/** App-level settings kept in the `meta` table (device-local, never synced). */
import { db as defaultDb, type TabPalDB } from "./db";

const HIDE_PAYMENT_KEY = "settings.hidePaymentInExports";

/** «عدم چاپ شماره‌کارت و شبا در خروجی‌ها»: when on, exports/prints show only the treasurer's name. */
export async function getHidePaymentInExports(db: TabPalDB = defaultDb): Promise<boolean> {
  return (await db.meta.get(HIDE_PAYMENT_KEY))?.value === "1";
}

export async function setHidePaymentInExports(value: boolean, db: TabPalDB = defaultDb): Promise<void> {
  await db.meta.put({ key: HIDE_PAYMENT_KEY, value: value ? "1" : "0" });
}
