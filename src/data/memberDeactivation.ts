/**
 * Deactivating an event member when settlement groups exist (docs/PLAN.md, SG-3).
 * Order matters: the member's group is repaired FIRST (`handleMemberRemoved`);
 * only if that succeeds is the member deactivated. A person in no group is
 * deactivated exactly as before.
 */
import { eventMembersRepository } from "./repositories/eventMembersRepository";
import { SettlementGroupValidationError, settlementGroupsRepository, type MemberRemovalOutcome } from "./repositories/settlementGroupsRepository";
import type { GroupErrorCode } from "@/domain/settlementUnits";

export type DeactivateResult =
  | { status: "done"; groupOutcome: MemberRemovalOutcome | null }
  /** The group rules forbid removing this person; nothing was changed. */
  | { status: "blocked"; codes: GroupErrorCode[] };

export async function deactivateEventMember(memberRowId: string, eventId: string, personId: string): Promise<DeactivateResult> {
  let groupOutcome: MemberRemovalOutcome | null;
  try {
    groupOutcome = await settlementGroupsRepository.handleMemberRemoved(eventId, personId);
  } catch (e) {
    if (e instanceof SettlementGroupValidationError) return { status: "blocked", codes: [...new Set(e.errors.map((x) => x.code))] };
    throw e;
  }
  await eventMembersRepository.setActive(memberRowId, false);
  return { status: "done", groupOutcome };
}
