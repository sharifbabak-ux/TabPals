/**
 * Settlement groups (docs/PLAN.md "Settlement groups (SG)", step SG-1).
 *
 * Pure, deterministic, integer-only logic. A *unit* is either one ungrouped
 * person or one settlement group. Settlement still uses the treasurer-hub
 * (`computeHubSettlement`, unchanged) but runs on units: a group's balance is
 * the exact sum of its members' balances (debts inside the group cancel) and
 * all money to/from the group goes through its representative person.
 *
 * Nothing here touches vouchers, payments, the DB or the UI.
 */
import { computeHubSettlement, type HubSettlementBalance, type HubSettlementPlan } from "./hubSettlement";

export interface SettlementGroupInput {
  id: string;
  name: string;
  memberIds: string[];
  representativeId: string;
}

export interface GroupValidationContext {
  /** Every person id that exists in the event (archived/removed members included). */
  knownPersonIds: readonly string[];
  treasurerId: string;
}

export type GroupErrorCode =
  | "empty-name"
  | "too-few-members"
  | "duplicate-member"
  | "unknown-person"
  | "representative-not-member"
  | "person-in-multiple-groups"
  | "treasurer-must-represent";

export interface GroupValidationError {
  code: GroupErrorCode;
  groupId: string;
  personId?: string;
  /** For person-in-multiple-groups: every group (sorted) that holds the person. */
  groupIds?: string[];
}

const ERROR_ORDER: GroupErrorCode[] = [
  "empty-name",
  "too-few-members",
  "duplicate-member",
  "unknown-person",
  "representative-not-member",
  "person-in-multiple-groups",
  "treasurer-must-represent"
];

/** Locale-independent comparison (never `localeCompare`, never an unstable tie). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Returns all problems; an empty list means the groups are valid. Output order is independent of input order. */
export function validateGroups(groups: readonly SettlementGroupInput[], ctx: GroupValidationContext): GroupValidationError[] {
  const errors: GroupValidationError[] = [];
  const known = new Set(ctx.knownPersonIds);
  const sorted = [...groups].sort((a, b) => cmp(a.id, b.id));
  const holders = new Map<string, Set<string>>();

  for (const g of sorted) {
    if (g.name.trim() === "") errors.push({ code: "empty-name", groupId: g.id });
    if (g.memberIds.length < 2) errors.push({ code: "too-few-members", groupId: g.id });

    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const m of g.memberIds) {
      if (seen.has(m)) dup.add(m);
      seen.add(m);
    }
    for (const m of [...dup].sort(cmp)) errors.push({ code: "duplicate-member", groupId: g.id, personId: m });
    for (const m of [...seen].sort(cmp)) {
      if (!known.has(m)) errors.push({ code: "unknown-person", groupId: g.id, personId: m });
      if (!holders.has(m)) holders.set(m, new Set());
      holders.get(m)!.add(g.id);
    }
    if (!seen.has(g.representativeId)) {
      errors.push({ code: "representative-not-member", groupId: g.id, personId: g.representativeId });
    }
    if (seen.has(ctx.treasurerId) && g.representativeId !== ctx.treasurerId) {
      errors.push({ code: "treasurer-must-represent", groupId: g.id, personId: ctx.treasurerId });
    }
  }

  for (const [personId, ids] of [...holders.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    if (ids.size > 1) {
      const groupIds = [...ids].sort(cmp);
      errors.push({ code: "person-in-multiple-groups", groupId: groupIds[0], personId, groupIds });
    }
  }

  return errors.sort(
    (a, b) =>
      ERROR_ORDER.indexOf(a.code) - ERROR_ORDER.indexOf(b.code) ||
      cmp(a.groupId, b.groupId) ||
      cmp(a.personId ?? "", b.personId ?? "")
  );
}

export interface MemberShare {
  personId: string;
  balance: number;
}

export interface PersonUnit {
  kind: "person";
  /** Stable sort key: "p:<personId>". */
  key: string;
  personId: string;
  balance: number;
}

export interface GroupUnit {
  kind: "group";
  /** Stable sort key: "g:<groupId>". */
  key: string;
  groupId: string;
  name: string;
  memberIds: string[];
  representativeId: string;
  /** Exact integer sum of the members' balances (archived/removed members included). */
  balance: number;
  /** Per-member breakdown, sorted by personId. */
  members: MemberShare[];
  /** Debts that cancel inside the group: min(sum of members' credits, sum of members' debts). */
  internalCancelled: number;
  /** True when the group's net balance is exactly zero. */
  settled: boolean;
}

export type SettlementUnit = PersonUnit | GroupUnit;

function assertInt(n: number, what: string): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} must be an integer`);
}

/**
 * Builds units, sorted by key (`g:<groupId>` entries before `p:<personId>` entries, each by id),
 * so the result never depends on input order. Members missing from
 * `balancesByPerson` count as 0. Assumes groups already passed `validateGroups`.
 */
export function buildUnits(balancesByPerson: Readonly<Record<string, number>>, groups: readonly SettlementGroupInput[]): SettlementUnit[] {
  const grouped = new Set<string>();
  for (const g of groups) for (const m of g.memberIds) grouped.add(m);

  const units: SettlementUnit[] = [];

  for (const personId of Object.keys(balancesByPerson)) {
    if (grouped.has(personId)) continue;
    assertInt(balancesByPerson[personId], `balance of ${personId}`);
    units.push({ kind: "person", key: `p:${personId}`, personId, balance: balancesByPerson[personId] });
  }

  for (const g of groups) {
    const ids = [...new Set(g.memberIds)].sort(cmp);
    const members = ids.map((personId) => {
      const balance = balancesByPerson[personId] ?? 0;
      assertInt(balance, `balance of ${personId}`);
      return { personId, balance };
    });
    let credit = 0;
    let debt = 0;
    for (const m of members) {
      if (m.balance > 0) credit += m.balance;
      else debt -= m.balance;
    }
    const balance = credit - debt;
    units.push({
      kind: "group",
      key: `g:${g.id}`,
      groupId: g.id,
      name: g.name,
      memberIds: ids,
      representativeId: g.representativeId,
      balance,
      members,
      internalCancelled: Math.min(credit, debt),
      settled: balance === 0
    });
  }

  return units.sort((a, b) => cmp(a.key, b.key));
}

/** Control check: sum of unit balances must equal the sum of all person balances. */
export function controlSumMatches(balancesByPerson: Readonly<Record<string, number>>, units: readonly SettlementUnit[]): boolean {
  let persons = 0;
  for (const id of Object.keys(balancesByPerson)) persons += balancesByPerson[id];
  let sum = 0;
  for (const u of units) sum += u.balance;
  return persons === sum;
}

/**
 * Adapter for the EXISTING `computeHubSettlement`: each unit becomes one hub
 * balance whose personId is the unit's *payer/payee person* — the person
 * himself/herself, or the group's representative.
 *
 * Treasurer semantics: if the treasurer is inside a group, validation requires
 * the treasurer to be its representative, so that group's hub id equals
 * `treasurerId` and the group IS the hub unit. The hub skips its own unit, so
 * the other members of that group do not get separate transfers to/from the
 * treasurer: their balances are netted inside the group and whatever is left
 * is, by definition, the treasurer's own side (settled off-app inside the group).
 * Transfers for all other groups go to/from their representative only.
 *
 * Throws if the groups are invalid (callers should validate first).
 */
export function unitsToHubInput(units: readonly SettlementUnit[]): HubSettlementBalance[] {
  return units.map((u) => ({ personId: u.kind === "person" ? u.personId : u.representativeId, balance: u.balance }));
}

export function computeUnitSettlement(
  balancesByPerson: Readonly<Record<string, number>>,
  groups: readonly SettlementGroupInput[],
  ctx: GroupValidationContext
): HubSettlementPlan {
  const errors = validateGroups(groups, ctx);
  if (errors.length > 0) throw new Error(`Invalid settlement groups: ${errors.map((e) => e.code).join(", ")}`);
  const units = buildUnits(balancesByPerson, groups);
  return computeHubSettlement(unitsToHubInput(units), ctx.treasurerId);
}

export type RepairNotice = "representative-fallback" | "dissolved";

export interface RepairResult {
  /** The repaired group, or null when it was dissolved. */
  group: SettlementGroupInput | null;
  notice: RepairNotice | null;
  /** Persian message for the UI (null when nothing notable happened). */
  message: string | null;
}

/**
 * Removes a member from a group. If the representative left, the first
 * remaining member (in stored order) becomes representative, with a notice.
 * If fewer than 2 members remain the group is dissolved (group = null).
 * If the person is not a member, the group is returned unchanged.
 * NOTE: the treasurer rule is not re-checked here; call validateGroups after.
 */
export function repairGroupAfterMemberRemoval(group: SettlementGroupInput, removedPersonId: string): RepairResult {
  if (!group.memberIds.includes(removedPersonId)) return { group, notice: null, message: null };
  const memberIds = group.memberIds.filter((m) => m !== removedPersonId);
  if (memberIds.length < 2) {
    return { group: null, notice: "dissolved", message: `گروه «${group.name}» منحل شد، چون کمتر از ۲ عضو داشت.` };
  }
  if (group.representativeId === removedPersonId) {
    return {
      group: { ...group, memberIds, representativeId: memberIds[0] },
      notice: "representative-fallback",
      message: `نماینده‌ی گروه «${group.name}» حذف شد و نماینده به عضو اول گروه منتقل شد.`
    };
  }
  return { group: { ...group, memberIds }, notice: null, message: null };
}
