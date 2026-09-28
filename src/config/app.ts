/**
 * Single source of truth for the application name and global feature flags.
 * All UI text, the PWA manifest, and Settings must read from here rather
 * than hard-coding the app name.
 */
export const APP_NAME = "TabPal";

/**
 * Stage 0-7 build with no server. Flip only when a real backend (Stage 8)
 * is wired up; every online-capable code path must check this flag.
 */
export const ONLINE_ENABLED = false;

/**
 * package.json "version" injected at build time via Vite's `define`
 * (see vite.config.ts -> __APP_VERSION__).
 */
export const APP_VERSION: string = __APP_VERSION__;
