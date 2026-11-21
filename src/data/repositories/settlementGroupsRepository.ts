/**
 * Settlement groups repository (docs/PLAN.md "Settlement groups (SG)", SG-2).
 * Offline-only storage for the `settlementGroups` table (not the device-level
 * `groups` table). Every write validates the event's whole resulting set of
 * groups with the pure `validateGroups` (SG-1) using the event's real context,
 * and logs to the operation log. Not synced yet (SG-6).
 */
import { isEventClosed } from "@/domain/eventStatus";
import {
  repairGroupAfterMemberRemoval,
  validateGroups,
  type GroupErrorCode,
  type GroupValidationError,
  type RepairResult,
  type SettlementGroupInput
} from "@/domain/settlementUnits";
import { db } from "../db";
import type { Event, SettlementGroup } from "../types";
import { diffFields, logOperation, newBaseFields, touchBaseFields } from "./operationLog";

const GROUP_LOG_FIELDS: (keyof SettlementGroup)[] = ["eventId", "name", "memberIds", "representativeId", "deleted"];

const ERROR_MESSAGES: Record<GroupErrorCode, string> = {
  "empty-name": "نام گروه را وارد کنید.",
  "too-few-members": "هر گروه باید حداقل ۲ عضو داشته باشد.",
  "duplicate-member": "یک نفر نباید دو بار در یک گروه باشد.",
  "unknown-person": "یکی از اعضا عضو این ایونت نیست.",
  "representative-not-member": "نماینده باید یکی از اعضای گروه باشد.",
  "person-in-multiple-groups": "هر نفر در هر ایونت فقط می‌تواند عضو یک گروه باشد.",
  "treasurer-must-represent": "اگر مسئول صندوق عضو یک گروه است، نماینده‌ی آن گروه باید خود مسئول صندوق باشد."
};

/** The resulting set of groups would be invalid; nothing was stored. */
export class SettlementGroupValidationError extends Error {
  constructor(public readonly errors: GroupValidationError[]) {
    super([...new Set(errors.map((e) => ERROR_MESSAGES[e.code]))].join("\n"));
    this.name = "SettlementGroupValidationError";
  }
}

export interface CreateSettlementGroupInput {
  eventId: string;
  name: string;
  memberIds: string[];
  representativeId: string;
}

export interface UpdateSettlementGroupInput {
  name?: string;
  memberIds?: string[];
  representativeId?: string;
}

/** What `handleMemberRemoved` did (null when the person was in no group). */
export interface MemberRemovalOutcome {
  groupId: string;
  notice: RepairResult["notice"];
  /** Persian message for the UI. */
  message: string | null;
}

function toInput(g: SettlementGroup): SettlementGroupInput {
  return { id: g.id, name: g.name, memberIds: g.memberIds, representativeId: g.representativeId };
}

async function loadEvent(eventId: string): Promise<Event> {
  const event = await db.events.get(eventId);
  if (!event) throw new Error(`Event ${eventId} not found`);
  return event;
}

async function liveGroups(eventId: string): Promise<SettlementGroup[]> {
  return db.settlementGroups.where("eventId").equals(eventId).filter((g) => !g.deleted).toArray();
}

/** Validates `groups` (the event's complete resulting set) against the event's real members and treasurer. */
async function assertValid(event: Event, groups: SettlementGroupInput[]): Promise<void> {
  const members = await db.eventMembers.where("eventId").equals(event.id).filter((m) => !m.deleted).toArray();
  const errors = validateGroups(groups, {
    knownPersonIds: members.map((m) => m.personId),
    treasurerId: event.treasurerPersonId ?? ""
  });
  if (errors.length > 0) throw new SettlementGroupValidationError(errors);
}

function assertEventOpen(event: Event): void {
  if (isEventClosed(event, new Date())) throw new Error("این ایونت پایان یافته است؛ گروه‌ها فقط‌خواندنی است.");
}

export const settlementGroupsRepository = {
  /** Groups of an event, soft-deleted ones excluded. */
  async listByEvent(eventId: string): Promise<SettlementGroup[]> {
    const groups = await liveGroups(eventId);
    return groups.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
  },

  async get(id: string): Promise<SettlementGroup | undefined> {
    const group = await db.settlementGroups.get(id);
    return group && !group.deleted ? group : undefined;
  },

  async create(input: CreateSettlementGroupInput): Promise<SettlementGroup> {
    return db.transaction("rw", db.events, db.eventMembers, db.settlementGroups, db.operations, async () => {
      const event = await loadEvent(input.eventId);
      assertEventOpen(event);
      const group: SettlementGroup = {
        ...newBaseFields(),
        eventId: input.eventId,
        name: input.name.trim(),
        memberIds: [...input.memberIds],
        representativeId: input.representativeId
      };
      const existing = await liveGroups(input.eventId);
      await assertValid(event, [...existing.map(toInput), toInput(group)]);
      await db.settlementGroups.add(group);
      await logOperation(db, "settlementGroups", group.id, "create", diffFields(undefined, group, GROUP_LOG_FIELDS));
      return group;
    });
  },

  async update(id: string, input: UpdateSettlementGroupInput): Promise<SettlementGroup> {
    return db.transaction("rw", db.events, db.eventMembers, db.settlementGroups, db.operations, async () => {
      const existing = await db.settlementGroups.get(id);
      if (!existing || existing.deleted) throw new Error(`Settlement group ${id} not found`);
      const event = await loadEvent(existing.eventId);
      assertEventOpen(event);
      const updated: SettlementGroup = {
        ...existing,
        name: input.name !== undefined ? input.name.trim() : existing.name,
        memberIds: input.memberIds ? [...input.memberIds] : existing.memberIds,
        representativeId: input.representativeId ?? existing.representativeId,
        ...touchBaseFields(existing)
      };
      const others = (await liveGroups(existing.eventId)).filter((g) => g.id !== id);
      await assertValid(event, [...others.map(toInput), toInput(updated)]);
      await db.settlementGroups.put(updated);
      await logOperation(db, "settlementGroups", id, "update", diffFields(existing, updated, GROUP_LOG_FIELDS));
      return updated;
    });
  },

  /** Soft delete (`deleted: true`), like other event records; the operation log keeps the tombstone. */
  async delete(id: string): Promise<void> {
    await db.transaction("rw", db.events, db.settlementGroups, db.operations, async () => {
      const existing = await db.settlementGroups.get(id);
      if (!existing || existing.deleted) return;
      assertEventOpen(await loadEvent(existing.eventId));
      const removed: SettlementGroup = { ...existing, deleted: true, ...touchBaseFields(existing) };
      await db.settlementGroups.put(removed);
      await logOperation(db, "settlementGroups", id, "delete", diffFields(existing, removed, GROUP_LOG_FIELDS));
    });
  },

  /**
   * A person left the event: repairs the group they were in (fallback
   * representative, or dissolve when < 2 members remain) in one transaction.
   * The resulting set of groups is re-validated (the repair does not re-check
   * the treasurer rule); if invalid, throws `SettlementGroupValidationError`
   * and nothing is stored. Returns null when the person was in no group.
   */
  async handleMemberRemoved(eventId: string, personId: string): Promise<MemberRemovalOutcome | null> {
    return db.transaction("rw", db.events, db.eventMembers, db.settlementGroups, db.operations, async () => {
      const event = await loadEvent(eventId);
      const groups = await liveGroups(eventId);
      const affected = groups.find((g) => g.memberIds.includes(personId));
      if (!affected) return null;

      const result = repairGroupAfterMemberRemoval(toInput(affected), personId);
      const resulting = groups.filter((g) => g.id !== affected.id).map(toInput);
      if (result.group) resulting.push(result.group);
      await assertValid(event, resulting);

      if (result.group) {
        const updated: SettlementGroup = {
          ...affected,
          memberIds: result.group.memberIds,
          representativeId: result.group.representativeId,
          ...touchBaseFields(affected)
        };
        await db.settlementGroups.put(updated);
        await logOperation(db, "settlementGroups", affected.id, "update", diffFields(affected, updated, GROUP_LOG_FIELDS));
      } else {
        const removed: SettlementGroup = { ...affected, deleted: true, ...touchBaseFields(affected) };
        await db.settlementGroups.put(removed);
        await logOperation(db, "settlementGroups", affected.id, "delete", diffFields(affected, removed, GROUP_LOG_FIELDS));
      }
      return { groupId: affected.id, notice: result.notice, message: result.message };
    });
  }
};
