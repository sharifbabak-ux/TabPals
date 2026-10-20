import { describe, expect, it } from "vitest";
import type { ServerOp } from "@/data/types";
import { buildRecordFromCreate } from "./remoteOps";

describe("buildRecordFromCreate — sessions from older clients", () => {
  it("fills the O2-1 session defaults", () => {
    const op = { id: "o", entity: "orderSessions", entityId: "s1", type: "create", changes: { title: { after: "شام" } }, timestamp: 1, deviceId: "d", seq: 1 } as unknown as ServerOp;
    const record = buildRecordFromCreate(op);
    expect(record).toMatchObject({ title: "شام", participants: [], mode: "admin-entered", membersMayPrice: false, settlement: "event" });
  });

  it("keeps the values a newer client sends", () => {
    const op = { id: "o", entity: "orderSessions", entityId: "s1", type: "create", changes: { mode: { after: "collaborative" }, settlement: { after: "own" } }, timestamp: 1, deviceId: "d", seq: 1 } as unknown as ServerOp;
    expect(buildRecordFromCreate(op)).toMatchObject({ mode: "collaborative", settlement: "own" });
  });
});
