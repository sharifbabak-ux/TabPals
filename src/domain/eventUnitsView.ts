/**
 * What the event screen needs to show balances and settlement by "units"
 * (docs/PLAN.md, SG-4). Pure and deterministic: it only wires the SG-1
 * functions (`validateGroups`, `buildUnits`, `controlSumMatches`,
 * `unitsToHubInput`) to the existing `computeHubSettlement`. Individual
 * balances are never changed; with no groups the result is the plain
 * individual treasurer-hub plan.
 */
import { computeHubSettlement, type HubSettlementPlan } from "./hubSettlement";
import {
  buildUnits,
  controlSumMatches,
  unitsToHubInput,
  validateGroups,
  type GroupUnit,
  type GroupValidationError,
  type PersonUnit,
  type SettlementGroupInput,
  type SettlementUnit
} from "./settlementUnits";

export interface EventUnitsInput {
  /** Balance of every event member (active and inactive), positive = creditor. */
  balancesByPerson: Readonly<Record<string, number>>;
  groups: readonly SettlementGroupInput[];
  /** Empty/null when the event has no treasurer yet. */
  treasurerId: string | null | undefined;
  /** Every person id of the event; defaults to the keys of `balancesByPerson`. */
  knownPersonIds?: readonly string[];
}

/** One money movement of the unit-level plan. Group transfers go through the representative person. */
export interface UnitTransfer {
  /** `g:<groupId>` or `p:<personId>` of the non-hub unit. */
  unitKey: string;
  /** "pay" = the unit pays the treasurer; "receive" = the treasurer pays the unit. */
  direction: "pay" | "receive";
  fromPersonId: string;
  toPersonId: string;
  amount: number;
}

export interface EventUnitsResult {
  /** False → the UI must fall back to individual mode (see `reasons` / `treasurerMissing`). */
  valid: boolean;
  /** True when at least one live group exists (valid or not). */
  hasGroups: boolean;
  reasons: GroupValidationError[];
  treasurerMissing: boolean;
  /** Units in the SG-1 order (groups first, then ungrouped people). Individuals only when invalid. */
  units: SettlementUnit[];
  groupUnits: GroupUnit[];
  /** The unit that holds the treasurer (a group, or the treasurer's own person unit); null when none. */
  hubUnit: SettlementUnit | null;
  /** True when the treasurer sits inside a group: that group's remaining balance is settled outside the app. */
  treasurerInGroup: boolean;
  /** Unit-level plan (equals the individual plan when there are no groups or the groups are invalid). */
  plan: HubSettlementPlan;
  transfers: UnitTransfer[];
  /** The plain individual plan (never affected by groups), for the "افراد" mode. */
  individualPlan: HubSettlementPlan;
  /** Sum of unit balances equals the sum of person balances. */
  sumOk: boolean;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildEventUnitsView(input: EventUnitsInput): EventUnitsResult {
  const treasurerId = input.treasurerId ?? "";
  const balances = input.balancesByPerson;
  const personIds = Object.keys(balances).sort(cmp);
  const known = input.knownPersonIds ?? personIds;

  const individualPlan = treasurerId
    ? computeHubSettlement(personIds.map((personId) => ({ personId, balance: balances[personId] })), treasurerId)
    : { transfers: [], totalCollected: 0, totalPaidOut: 0 };
  const individualUnits: PersonUnit[] = personIds.map((personId) => ({ kind: "person", key: `p:${personId}`, personId, balance: balances[personId] }));

  const groups = input.groups;
  const reasons = validateGroups(groups, { knownPersonIds: known, treasurerId });
  const treasurerMissing = treasurerId === "";
  const valid = reasons.length === 0 && !treasurerMissing;

  if (!valid) {
    return {
      valid: false,
      hasGroups: groups.length > 0,
      reasons,
      treasurerMissing,
      units: individualUnits,
      groupUnits: [],
      hubUnit: individualUnits.find((u) => u.personId === treasurerId) ?? null,
      treasurerInGroup: false,
      plan: individualPlan,
      transfers: individualPlan.transfers.map((t) => toUnitTransfer(t, treasurerId, (id) => `p:${id}`)),
      individualPlan,
      sumOk: controlSumMatches(balances, individualUnits)
    };
  }

  const units = buildUnits(balances, groups);
  const hubIdOf = (u: SettlementUnit) => (u.kind === "person" ? u.personId : u.representativeId);
  const unitByHubId = new Map(units.map((u) => [hubIdOf(u), u]));
  const hubUnit = unitByHubId.get(treasurerId) ?? null;
  const plan = computeHubSettlement(unitsToHubInput(units), treasurerId);

  return {
    valid: true,
    hasGroups: groups.length > 0,
    reasons: [],
    treasurerMissing: false,
    units,
    groupUnits: units.filter((u): u is GroupUnit => u.kind === "group"),
    hubUnit,
    treasurerInGroup: hubUnit?.kind === "group",
    plan,
    transfers: plan.transfers.map((t) => toUnitTransfer(t, treasurerId, (id) => unitByHubId.get(id)?.key ?? `p:${id}`)),
    individualPlan,
    sumOk: controlSumMatches(balances, units)
  };
}

function toUnitTransfer(
  t: { fromPersonId: string; toPersonId: string; amount: number },
  treasurerId: string,
  keyOf: (hubPersonId: string) => string
): UnitTransfer {
  const pays = t.toPersonId === treasurerId;
  return { unitKey: keyOf(pays ? t.fromPersonId : t.toPersonId), direction: pays ? "pay" : "receive", ...t };
}
