import { describe, expect, it } from "vitest";
import { displayOrPending, editableValue, isPendingKey, PENDING_KEY_TEXT } from "./encryptedDisplay";

describe("encrypted value display", () => {
  it("shows the lock marker for ciphertext and never edits it", () => {
    expect(PENDING_KEY_TEXT).toBe("🔒 در انتظار دریافت کلید");
    expect(displayOrPending("enc:v1:abc:def")).toBe(PENDING_KEY_TEXT);
    expect(isPendingKey("enc:v1:x")).toBe(true);
    expect(editableValue("enc:v1:abc:def")).toBe("");
  });
  it("passes plain values through", () => {
    expect(displayOrPending("09121234567")).toBe("09121234567");
    expect(displayOrPending("")).toBeNull();
    expect(displayOrPending(undefined)).toBeNull();
    expect(editableValue("x")).toBe("x");
  });
});
