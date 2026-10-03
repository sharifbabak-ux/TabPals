/**
 * Online-mode endpoints. Both are build-time configurable; the API base can
 * additionally be overridden at runtime from Settings (dev setting).
 */
export const DEFAULT_API_BASE = "https://api.tabpals.ir";
export const DEFAULT_APP_BASE_URL = "https://sharifbabak-ux.github.io/TabPals/";

const API_BASE_OVERRIDE_KEY = "tabpal:apiBaseOverride";

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Base URL of the API server (no trailing slash): dev override → VITE_API_BASE → production default. */
export function getApiBase(): string {
  try {
    const override = localStorage.getItem(API_BASE_OVERRIDE_KEY);
    if (override) return trimTrailingSlashes(override);
  } catch {
    // storage unavailable — fall through
  }
  const fromEnv = import.meta.env.VITE_API_BASE as string | undefined;
  return trimTrailingSlashes(fromEnv || DEFAULT_API_BASE);
}

export function getApiBaseOverride(): string | null {
  try {
    return localStorage.getItem(API_BASE_OVERRIDE_KEY);
  } catch {
    return null;
  }
}

/** Sets (or, with an empty value, clears) the dev override. The URL is not a secret, so localStorage is fine here. */
export function setApiBaseOverride(url: string | null): void {
  try {
    const trimmed = url?.trim();
    if (trimmed) localStorage.setItem(API_BASE_OVERRIDE_KEY, trimTrailingSlashes(trimmed));
    else localStorage.removeItem(API_BASE_OVERRIDE_KEY);
  } catch {
    // ignore
  }
}

/** Public URL of the web app, used to build invite links (`<base>#/join?t=<token>`). */
export function getAppBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_APP_BASE_URL as string | undefined;
  return fromEnv || DEFAULT_APP_BASE_URL;
}
