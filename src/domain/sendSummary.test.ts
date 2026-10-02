import { describe, expect, it } from "vitest";
import { NO_LINK_CONTACT_TREASURER_LINE, buildStatementSummaryText } from "./sendSummary";

describe("buildStatementSummaryText", () => {
  it("includes payment details for a debtor and ends with the link", () => {
    const text = buildStatementSummaryText({
      firstName: "آرش",
      eventTitle: "سفر شمال",
      balance: -50000,
      currency: "تومان",
      treasurerName: "ترانه",
      treasurerCardNumberGrouped: "1234 5678 9012 3456",
      treasurerIbanGrouped: "IR12 3456 7890 1234 5678 9012 34",
      link: "https://tabpals.app/#/s/abc"
    });
    expect(text).toContain("سلام آرش،");
    expect(text).toContain("بدهکار");
    expect(text).toContain("مسئول صندوق: ترانه");
    expect(text).toContain("1234 5678 9012 3456");
    expect(text.endsWith("https://tabpals.app/#/s/abc")).toBe(true);
  });

  it("omits payment details for a creditor", () => {
    const text = buildStatementSummaryText({
      firstName: "بهار",
      eventTitle: "سفر شمال",
      balance: 50000,
      currency: "تومان",
      treasurerName: "ترانه",
      treasurerCardNumberGrouped: "1234 5678 9012 3456",
      link: "https://tabpals.app/#/s/abc"
    });
    expect(text).not.toContain("شماره کارت");
    expect(text).toContain("بستانکار");
  });

  it("falls back to the contact-treasurer line when there is no link", () => {
    const text = buildStatementSummaryText({
      firstName: "آرش",
      eventTitle: "سفر شمال",
      balance: 0,
      currency: "تومان",
      treasurerName: null,
      link: null
    });
    expect(text.endsWith(NO_LINK_CONTACT_TREASURER_LINE)).toBe(true);
  });
});
