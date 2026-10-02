import { describe, expect, it } from "vitest";
import { buildSmsUrl, buildTelegramUrl, buildWhatsAppUrl } from "./sendUrls";

describe("buildWhatsAppUrl", () => {
  it("targets the member's phone when known", () => {
    expect(buildWhatsAppUrl("989123456789", "سلام")).toBe("https://wa.me/989123456789?text=%D8%B3%D9%84%D8%A7%D9%85");
  });

  it("falls back to the chat picker when no phone is on file", () => {
    expect(buildWhatsAppUrl(null, "سلام")).toBe("https://wa.me/?text=%D8%B3%D9%84%D8%A7%D9%85");
  });
});

describe("buildTelegramUrl", () => {
  it("includes both the statement link and the summary text", () => {
    const url = buildTelegramUrl("https://tabpals.app/#/s/abc", "خلاصه");
    expect(url).toBe(`https://t.me/share/url?url=${encodeURIComponent("https://tabpals.app/#/s/abc")}&text=${encodeURIComponent("خلاصه")}`);
  });

  it("omits the url param when there is no link", () => {
    const url = buildTelegramUrl(null, "خلاصه");
    expect(url).toBe(`https://t.me/share/url?text=${encodeURIComponent("خلاصه")}`);
  });
});

describe("buildSmsUrl", () => {
  it("uses ?body= on Android", () => {
    expect(buildSmsUrl("989123456789", "متن", false)).toBe(`sms:989123456789?body=${encodeURIComponent("متن")}`);
  });

  it("uses &body= on iOS", () => {
    expect(buildSmsUrl("989123456789", "متن", true)).toBe(`sms:989123456789&body=${encodeURIComponent("متن")}`);
  });

  it("leaves the phone slot empty when unknown", () => {
    expect(buildSmsUrl(null, "متن", false)).toBe(`sms:?body=${encodeURIComponent("متن")}`);
  });
});
