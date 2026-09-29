import { describe, expect, it } from "vitest";
import { buildBalanceText, categoryForStatement, fillTemplate, pickTemplate } from "./messageTemplate";

describe("pickTemplate", () => {
  const templates = [
    { id: "d1", category: "debtor" as const, text: "d1", enabled: true },
    { id: "d2", category: "debtor" as const, text: "d2", enabled: true },
    { id: "d3-disabled", category: "debtor" as const, text: "d3", enabled: false },
    { id: "c1", category: "creditor" as const, text: "c1", enabled: true }
  ];

  it("only picks among enabled templates of the requested category", () => {
    const picked = pickTemplate(templates, "debtor", () => 0.99);
    expect(picked?.id).toBe("d2");
  });

  it("is deterministic given the same random source", () => {
    expect(pickTemplate(templates, "debtor", () => 0)?.id).toBe("d1");
  });

  it("returns null when no enabled template exists for the category", () => {
    expect(pickTemplate(templates, "settled", () => 0)).toBeNull();
  });
});

describe("categoryForStatement", () => {
  it("treasurer kind always uses the treasurer category", () => {
    expect(categoryForStatement("treasurer", -100)).toBe("treasurer");
    expect(categoryForStatement("treasurer", 100)).toBe("treasurer");
    expect(categoryForStatement("treasurer", 0)).toBe("treasurer");
  });

  it("member kind depends on balance sign", () => {
    expect(categoryForStatement("member", -100)).toBe("debtor");
    expect(categoryForStatement("member", 100)).toBe("creditor");
    expect(categoryForStatement("member", 0)).toBe("settled");
  });
});

describe("buildBalanceText", () => {
  it("formats a debtor balance", () => {
    expect(buildBalanceText(-150000, "تومان")).toBe("۱۵۰٬۰۰۰ تومان بدهکار به صندوق");
  });

  it("formats a creditor balance", () => {
    expect(buildBalanceText(150000, "تومان")).toBe("۱۵۰٬۰۰۰ تومان بستانکار از صندوق");
  });

  it("formats a settled balance", () => {
    expect(buildBalanceText(0, "تومان")).toBe("حساب شما صاف است");
  });
});

describe("fillTemplate", () => {
  it("replaces every placeholder", () => {
    const filled = fillTemplate("{name} در {event} با {treasurer}: {amount} {currency}, {balanceText}", {
      name: "علی",
      amount: "۱۰۰",
      currency: "تومان",
      treasurer: "رضا",
      event: "سفر شمال",
      balanceText: "حساب شما صاف است"
    });
    expect(filled).toBe("علی در سفر شمال با رضا: ۱۰۰ تومان, حساب شما صاف است");
  });
});
