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

/** "Android Chrome" / "iPhone Safari" / … — shown to the admin in the devices list. */
function detectDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Web";
  const ua = navigator.userAgent || "";
  const os = /iPhone|iPad|iPod/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "Web";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  return `${os} ${browser}`.slice(0, 40);
}

export class WebPlatform implements Platform {
  getInfo(): PlatformInfo {
    return {
      kind: "web",
      isStandalone: isStandaloneDisplay(),
      os: detectOS(),
      deviceLabel: detectDeviceLabel()
    };
  }
}
