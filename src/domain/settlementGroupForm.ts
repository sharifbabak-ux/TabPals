/**
 * Pure helpers for the settlement-group editor (docs/PLAN.md, SG-3). No DOM, no DB.
 * The real rules live in `validateGroups` (settlementUnits.ts); this only adapts
 * them to a half-filled form and to the "who is in which group" questions of the UI.
 */
import { validateGroups, type GroupErrorCode, type SettlementGroupInput } from "./settlementUnits";

export interface GroupDraft {
  name: string;
  memberIds: string[];
  /** null = not chosen yet. */
  representativeId: string | null;
}

/** Form-level problem codes: the domain codes plus "nothing chosen yet". */
export type DraftErrorCode = GroupErrorCode | "no-representative";

export interface DraftContext {
  /** Every person id that exists in the event. */
  knownPersonIds: readonly string[];
  treasurerId: string;
  /** All live groups of the event (the one being edited may be included; it is replaced by the draft). */
  groups: readonly SettlementGroupInput[];
  /** Id of the group being edited, or null when creating. */
  editingId: string | null;
}

const DRAFT_ID = "__draft__";

/** The group (other than the one being edited) a person already belongs to. */
export function otherGroupOf(groups: readonly SettlementGroupInput[], personId: string, editingId: string | null): SettlementGroupInput | undefined {
  return groups.find((g) => g.id !== editingId && g.memberIds.includes(personId));
}

/** The group a person belongs to, if any. */
export function groupOfPerson(groups: readonly SettlementGroupInput[], personId: string): SettlementGroupInput | undefined {
  return groups.find((g) => g.memberIds.includes(personId));
}

/** True when the treasurer is selected: the representative is then forced to the treasurer. */
export function treasurerIsLocked(draft: GroupDraft, treasurerId: string | null | undefined): boolean {
  return Boolean(treasurerId) && draft.memberIds.includes(treasurerId as string);
}

/** Applies the treasurer rule and drops a representative who is no longer a member. */
export function normalizeDraft(draft: GroupDraft, treasurerId: string | null | undefined): GroupDraft {
  if (treasurerIsLocked(draft, treasurerId)) return { ...draft, representativeId: treasurerId as string };
  if (draft.representativeId && !draft.memberIds.includes(draft.representativeId)) return { ...draft, representativeId: null };
  return draft;
}

/** Taps a person: adds or removes them, then re-applies the representative rules. */
export function toggleDraftMember(draft: GroupDraft, personId: string, treasurerId: string | null | undefined): GroupDraft {
  const memberIds = draft.memberIds.includes(personId) ? draft.memberIds.filter((id) => id !== personId) : [...draft.memberIds, personId];
  return normalizeDraft({ ...draft, memberIds }, treasurerId);
}

/** Distinct problem codes for the draft (empty = valid), in a stable order. */
export function draftErrors(draft: GroupDraft, ctx: DraftContext): DraftErrorCode[] {
  const candidate: SettlementGroupInput = {
    id: ctx.editingId ?? DRAFT_ID,
    name: draft.name,
    memberIds: draft.memberIds,
    representativeId: draft.representativeId ?? ""
  };
  const others = ctx.groups.filter((g) => g.id !== candidate.id);
  const codes = validateGroups([...others, candidate], { knownPersonIds: ctx.knownPersonIds, treasurerId: ctx.treasurerId });
  const result: DraftErrorCode[] = [];
  for (const e of codes) {
    // Problems of other, already-saved groups are not the editor's business.
    if (e.groupId !== candidate.id && e.code !== "person-in-multiple-groups") continue;
    const code: DraftErrorCode = e.code === "representative-not-member" && draft.representativeId === null ? "no-representative" : e.code;
    if (!result.includes(code)) result.push(code);
  }
  return result;
}
