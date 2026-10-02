import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Statement } from "@/data/types";
import { buildStatementLink, decodeStatementPayload, type StatementLinkData } from "@/domain/statementLink";

const copyText = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform")>();
  return { ...actual, clipboardService: { copyText } };
});

import { SendMenuSheet } from "./SendMenuSheet";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data: StatementLinkData = {
  kind: "member",
  event: { title: "سفر شمال", currency: "تومان" },
  member: { personId: "p1", name: "آرش", firstName: "آرش", lastName: "احمدی" },
  expenses: [],
  expenseTotals: { totalAmount: 0, totalShare: 0, totalPaid: 0 },
  fundEntries: [],
  summary: { personId: "p1", expenseShare: 0, expensePaid: 0, contributedToFund: 0, receivedAsTreasurer: 0, settlementsPaid: 0, settlementsReceived: 0, balance: -500 },
  treasurerName: "ترانه",
  treasurerCardNumberGrouped: null,
  treasurerIbanGrouped: null,
  treasurerBankName: null,
  treasurerAccountHolder: null,
  hubSettlement: null,
  closingText: "ممنون"
};

const statement = {
  id: "st1",
  eventId: "e1",
  kind: "member",
  personId: "p1",
  number: 1,
  issueVersion: 1,
  issuedAt: "2025-01-05T08:00:00.000Z",
  snapshot: "{}",
  templateId: null,
  closingText: "ممنون",
  verificationCode: "A1B2-C3D4",
  status: "current",
  sendLog: [],
  createdAt: "",
  updatedAt: "",
  deviceId: "d",
  version: 1,
  deleted: false
} as Statement;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  copyText.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("send menu: «کپی لینک صورت‌حساب»", () => {
  it("copies the full statement link (size policy) and shows the toast", async () => {
    act(() => {
      root.render(createElement(SendMenuSheet, { open: true, onClose: () => {}, statement, data, eventTitle: "سفر شمال", onSent: () => {} }));
    });

    const item = Array.from(host.querySelectorAll("li")).find((li) => li.textContent?.includes("کپی لینک صورت‌حساب"));
    expect(item).toBeDefined();
    await act(async () => {
      item!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(copyText).toHaveBeenCalledTimes(1);
    const copied = (copyText.mock.calls[0] as unknown as [string])[0];
    // It is the FULL statement link (the one that fits the size policy), not the summary link.
    const expected = buildStatementLink(
      {
        v: 1,
        statementId: statement.id,
        number: statement.number,
        issueVersion: statement.issueVersion,
        issuedAt: statement.issuedAt,
        verificationCode: statement.verificationCode,
        status: statement.status,
        appVersion: __APP_VERSION__,
        data
      },
      `${window.location.origin}${window.location.pathname}`
    );
    expect(expected.tier).toBe("full");
    expect(copied).toBe(expected.url);
    expect(decodeStatementPayload(copied.split("#/s/")[1])?.data.kind).toBe("member");

    expect(host.querySelector(".toast")?.textContent).toBe("لینک کپی شد");
  });

  it("shows an error instead of the toast when the clipboard refuses", async () => {
    copyText.mockResolvedValueOnce(false);
    act(() => {
      root.render(createElement(SendMenuSheet, { open: true, onClose: () => {}, statement, data, eventTitle: "سفر شمال", onSent: () => {} }));
    });
    const item = Array.from(host.querySelectorAll("li")).find((li) => li.textContent?.includes("کپی لینک صورت‌حساب"))!;
    await act(async () => {
      item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector(".toast")).toBeNull();
    expect(host.querySelector(".field__error")?.textContent).toBe("کپی لینک انجام نشد");
  });
});
