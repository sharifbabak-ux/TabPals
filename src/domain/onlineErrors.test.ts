import { describe, expect, it } from "vitest";
import { auditActionLabel } from "./onlineErrors";

describe("auditActionLabel", () => {
  it("«key.delivered» says the key was sent, never that the recipient received/unwrapped it", () => {
    expect(auditActionLabel("key.delivered")).toBe("کلید رمزگذاری برای یک دستگاه ارسال شد");
    expect(auditActionLabel("key.delivered")).not.toContain("رسید");
  });
  it("falls back to the raw action name", () => {
    expect(auditActionLabel("something.new")).toBe("something.new");
  });
});
