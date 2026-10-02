import { describe, expect, it } from "vitest";
import { describeFundBalance } from "./fundBalance";

describe("describeFundBalance", () => {
  it("states personal payment when the treasurer paid more than was contributed (never negative)", () => {
    const line = describeFundBalance(1_000_000, 1_500_000, "تومان");
    expect(line.kind).toBe("personal");
    expect(line.text).toBe("مسئول صندوق ۵۰۰٬۰۰۰ تومان از محل شخصی پرداخت کرده است");
    expect(line.text).not.toContain("-");
    expect(line.text).not.toContain("باقیمانده");
  });

  it("shows the fund balance when contributions exceed spending", () => {
    expect(describeFundBalance(2_000_000, 500_000, "تومان")).toEqual({ kind: "fund", text: "موجودی صندوق: ۱٬۵۰۰٬۰۰۰ تومان" });
  });

  it("shows zero as a fund balance", () => {
    expect(describeFundBalance(700, 700, "ریال").text).toBe("موجودی صندوق: ۰ ریال");
  });
});
