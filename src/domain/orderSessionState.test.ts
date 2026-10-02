import { describe, expect, it } from "vitest";
import type { OrderSessionStatus } from "@/data/types";
import { allowedTransitions, canEditLines, canEditSession, canTransition, isTerminalStatus, validateTransition } from "./orderSessionState";

describe("order session state machine", () => {
  it("follows draft → open → locked → pricing → finalized", () => {
    expect(canTransition("draft", "open")).toBe(true);
    expect(canTransition("open", "locked")).toBe(true);
    expect(canTransition("locked", "pricing")).toBe(true);
    expect(canTransition("pricing", "finalized")).toBe(true);
  });

  it("lets the admin reopen a locked session (open ↔ locked) but nothing else goes backwards", () => {
    expect(canTransition("locked", "open")).toBe(true);
    expect(canTransition("pricing", "locked")).toBe(false);
    expect(canTransition("pricing", "open")).toBe(false);
    expect(canTransition("open", "draft")).toBe(false);
  });

  it("forbids skipping steps", () => {
    expect(canTransition("draft", "locked")).toBe(false);
    expect(canTransition("open", "pricing")).toBe(false);
    expect(canTransition("locked", "finalized")).toBe(false);
  });

  it("allows cancelling any non-finalized session", () => {
    for (const status of ["draft", "open", "locked", "pricing"] as OrderSessionStatus[]) {
      expect(canTransition(status, "cancelled")).toBe(true);
    }
    expect(canTransition("finalized", "cancelled")).toBe(false);
  });

  it("treats finalized and cancelled as terminal", () => {
    expect(allowedTransitions("finalized")).toEqual([]);
    expect(allowedTransitions("cancelled")).toEqual([]);
    expect(isTerminalStatus("finalized")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("open")).toBe(false);
  });

  it("requires a reason to cancel", () => {
    expect(validateTransition("open", "cancelled", "")).not.toBeNull();
    expect(validateTransition("open", "cancelled", "   ")).not.toBeNull();
    expect(validateTransition("open", "cancelled", "رستوران بسته بود")).toBeNull();
    expect(validateTransition("open", "locked")).toBeNull();
    expect(validateTransition("draft", "pricing")).not.toBeNull();
  });

  it("gates line edits by status and source", () => {
    expect(canEditLines("draft")).toBe(false);
    expect(canEditLines("open")).toBe(true);
    expect(canEditLines("locked")).toBe(true);
    expect(canEditLines("pricing")).toBe(true);
    expect(canEditLines("finalized")).toBe(false);
    expect(canEditLines("cancelled")).toBe(false);
    // Members (package/online) edit only until the admin locks.
    expect(canEditLines("open", "package")).toBe(true);
    expect(canEditLines("locked", "online")).toBe(false);
    expect(canEditSession("pricing")).toBe(true);
    expect(canEditSession("finalized")).toBe(false);
  });
});
