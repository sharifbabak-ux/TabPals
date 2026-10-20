import { describe, expect, it } from "vitest";
import { normalizeParticipants, sessionMode, sessionParticipantIds, sessionSettlement } from "./sessionModel";

describe("session model defaults", () => {
  it("falls back to today's behaviour for sessions without the new fields", () => {
    expect(sessionMode({})).toBe("admin-entered");
    expect(sessionSettlement({})).toBe("event");
    expect(sessionMode({ mode: "collaborative" })).toBe("collaborative");
    expect(sessionSettlement({ settlement: "own" })).toBe("own");
  });

  it("dedupes participants", () => {
    expect(normalizeParticipants(["a", "b", "a", ""])).toEqual(["a", "b"]);
  });
});

describe("sessionParticipantIds", () => {
  const active = ["a", "b", "c"];
  it("means everyone active when none are stored", () => {
    expect(sessionParticipantIds({}, active)).toEqual(active);
    expect(sessionParticipantIds({ participants: [] }, active)).toEqual(active);
  });
  it("shows only stored participants who are still active", () => {
    expect(sessionParticipantIds({ participants: ["a", "z"] }, active)).toEqual(["a"]);
  });
  it("keeps people who already have an order", () => {
    expect(sessionParticipantIds({ participants: ["a"] }, active, ["z", "a"])).toEqual(["a", "z"]);
  });
});
