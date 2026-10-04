import { useLiveQuery } from "dexie-react-hooks";
import { getHidePaymentInExports } from "@/data/appSettings";

/** Live value of the «عدم چاپ شماره‌کارت و شبا در خروجی‌ها» setting (false while loading). */
export function useHidePaymentInExports(): boolean {
  return useLiveQuery(() => getHidePaymentInExports(), []) ?? false;
}
