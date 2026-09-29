import { describe, expect, it } from "vitest";
import { canDeleteEvent, canDeleteGroup, canDeletePerson, canTrashEvent } from "./deletionGuards";

describe("canDeletePerson", () => {
  it("blocks a non-archived person", () => {
    const result = canDeletePerson({ archived: false }, { referencedByAnyEvent: false });
    expect(result.allowed).toBe(false);
  });

  it("blocks an archived person referenced by any event", () => {
    const result = canDeletePerson({ archived: true }, { referencedByAnyEvent: true });
    expect(result.allowed).toBe(false);
  });

  it("allows an archived, unreferenced person", () => {
    const result = canDeletePerson({ archived: true }, { referencedByAnyEvent: false });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });
});

describe("canDeleteGroup", () => {
  it("blocks a non-archived group", () => {
    expect(canDeleteGroup({ archived: false }).allowed).toBe(false);
  });

  it("allows an archived group", () => {
    expect(canDeleteGroup({ archived: true }).allowed).toBe(true);
  });
});

describe("canTrashEvent", () => {
  it("blocks an open event", () => {
    expect(canTrashEvent({ closedAt: null, deletedAt: null }).allowed).toBe(false);
  });

  it("blocks an event already in trash", () => {
    expect(canTrashEvent({ closedAt: "2025-01-01T00:00:00.000Z", deletedAt: "2025-01-02T00:00:00.000Z" }).allowed).toBe(false);
  });

  it("allows a closed event not yet in trash", () => {
    expect(canTrashEvent({ closedAt: "2025-01-01T00:00:00.000Z", deletedAt: null }).allowed).toBe(true);
  });
});

describe("canDeleteEvent", () => {
  it("blocks an event not in trash", () => {
    expect(canDeleteEvent({ closedAt: "2025-01-01T00:00:00.000Z", deletedAt: null }).allowed).toBe(false);
  });

  it("allows an event in trash", () => {
    expect(canDeleteEvent({ closedAt: "2025-01-01T00:00:00.000Z", deletedAt: "2025-01-02T00:00:00.000Z" }).allowed).toBe(true);
  });
});
