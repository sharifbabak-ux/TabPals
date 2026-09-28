import type { Platform, PlatformInfo } from "../types";

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const mql = window.matchMedia?.("(display-mode: standalone)");
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone;
  return Boolean(mql?.matches || iosStandalone);
}

export class WebPlatform implements Platform {
  getInfo(): PlatformInfo {
    return {
      kind: "web",
      isStandalone: isStandaloneDisplay()
    };
  }
}
