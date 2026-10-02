import { describe, expect, it } from "vitest";
import { ORDER_CATEGORIES, ORDER_CATEGORY_LABELS, suggestOrderCategory } from "./orderCategory";

describe("order categories", () => {
  it("has the fixed order and Persian labels", () => {
    expect(ORDER_CATEGORIES.map((c) => ORDER_CATEGORY_LABELS[c])).toEqual(["پیش‌غذا", "سالاد", "غذای اصلی", "نوشیدنی", "دسر و نوشیدنی گرم", "سایر"]);
  });
});

describe("suggestOrderCategory", () => {
  it.each([
    ["دوغ", "drink"],
    ["نوشابه", "drink"],
    ["آب", "drink"],
    ["آب‌میوه", "drink"],
    ["لیموناد", "drink"],
    ["دلستر", "drink"],
    ["چای", "dessert_hot"],
    ["قهوه", "dessert_hot"],
    ["اسپرسو", "dessert_hot"],
    ["نسکافه", "dessert_hot"],
    ["دمنوش", "dessert_hot"],
    ["بستنی", "dessert_hot"],
    ["کیک", "dessert_hot"],
    ["فالوده", "dessert_hot"],
    ["سالاد شیرازی", "salad"],
    ["سالاد", "salad"],
    ["ماست و خیار سالاد", "salad"],
    ["سوپ جو", "appetizer"],
    ["ماست", "appetizer"],
    ["زیتون پرورده", "appetizer"],
    ["بورانی", "appetizer"],
    ["کشک بادمجان", "appetizer"],
    ["میرزاقاسمی", "appetizer"],
    ["پیش‌غذا", "appetizer"],
    ["کباب برگ", "main"],
    ["کوبیده", "main"],
    ["جوجه", "main"],
    ["چلو خورش", "main"],
    ["استیک", "main"],
    ["پیتزا", "main"],
    ["برگر", "main"],
    ["ماهی", "main"],
    ["میگو", "main"]
  ])("%s → %s", (name, expected) => {
    expect(suggestOrderCategory(name)).toBe(expected);
  });

  it("normalizes Arabic letters and ZWNJ", () => {
    expect(suggestOrderCategory("كوبيده")).toBe("main");
    expect(suggestOrderCategory("آبمیوه")).toBe("drink");
  });

  it("never guesses main for unknown names", () => {
    expect(suggestOrderCategory("آبگوشت")).toBe("other");
    expect(suggestOrderCategory("چیز ناشناخته")).toBe("other");
    expect(suggestOrderCategory("")).toBe("other");
  });
});
