/**
 * Single source of truth for the application name and global feature flags.
 * All UI text, the PWA manifest, and Settings must read from here rather
 * than hard-coding the app name.
 */
export const APP_NAME = "TabPals";

/** Persian display name, shown in the app header/logo wordmark area. */
export const APP_NAME_FA = "حساب دوستانه";

/** Persian tagline, shown under the logo on the events screen header. */
export const TAGLINE_FA = "ضامن پایداری جمع‌های دوستانه";

/**
 * Online events (Stage ONLINE-1B) talk to the TabPals API server (see
 * src/config/online.ts). Build with `VITE_ONLINE_ENABLED=false` to ship a
 * fully offline build; every online-capable UI path checks this flag.
 */
export const ONLINE_ENABLED: boolean = import.meta.env.VITE_ONLINE_ENABLED !== "false";

/**
 * package.json "version" injected at build time via Vite's `define`
 * (see vite.config.ts -> __APP_VERSION__).
 */
export const APP_VERSION: string = __APP_VERSION__;
