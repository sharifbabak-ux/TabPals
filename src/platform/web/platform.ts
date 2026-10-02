import type { Platform, PlatformInfo, PlatformOS } from "../types";

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const mql = window.matchMedia?.("(display-mode: standalone)");
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone;
  return Boolean(mql?.matches || iosStandalone);
}

/** Detects the device's actual OS from the user agent (docs/PLAN.md Stage 3C — the sms: URI's body separator differs by OS, even on the web build). */
function detectOS(): PlatformOS {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

export class WebPlatform implements Platform {
  getInfo(): PlatformInfo {
    return {
      kind: "web",
      isStandalone: isStandaloneDisplay(),
      os: detectOS()
    };
  }
}
