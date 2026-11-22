/**
 * Group statement (صورت‌حساب گروه) — docs/PLAN.md, SG-5. Pure and
 * deterministic: plain balances + groups in, a plain data object out (no DOM,
 * no DB, no randomness). It only presents what SG-1 (`settlementUnits`) and
 * SG-4 (`eventUnitsView`) already compute: the group's balance is the exact
 * integer sum of its members' balances (archived members included), debts
 * inside the group cancel, and money to/from the group goes through the
 * representative, treasurer-hub style. Individual statements are untouched.
 */
import { formatAmount } from "./format";
import { buildEventUnitsView } from "./eventUnitsView";
import type { StatementBuildEvent, StatementEventInfo } from "./statementBuilder";
import { validateGroups, type GroupErrorCode, type GroupUnit, type SettlementGroupInput } from "./settlementUnits";
import { canonicalJson } from "./verificationCode";

export interface GroupStatementMemberInput {
  personId: string;
  /** Display name (disambiguated like every other mention). */
  name: string;
  firstName: string;
  /** Balance of this person, positive = creditor. */
  balance: number;
  /** False for archived (deactivated) members; they still count in the group sum. */
  active: boolean;
  sortOrder?: number;
}

export interface GroupStatementMemberRow {
  personId: string;
  name: string;
  balance: number;
  active: boolean;
}

export type GroupOutcome = "pay" | "receive" | "settled";

export interface GroupStatementData {
  kind: "group";
  event: StatementEventInfo;
  group: {
    groupId: string;
    name: string;
    representativeId: string;
    representativeName: string;
    representativeFirstName: string;
  };
  members: GroupStatementMemberRow[];
  /** Debts that cancel inside the group. */
  internalCancelled: number;
  /** Exact integer sum of the members' balances (positive = the group is a creditor). */
  groupBalance: number;
  /** What the representative does with the treasurer: "pay" = pays him/her, "receive" = gets paid, "settled" = nothing. */
  outcome: GroupOutcome;
  /** Absolute amount of the group's balance. */
  amount: number;
  /** The treasurer is a member of this group: the rest is settled outside the app. */
  treasurerInGroup: boolean;
  treasurerPersonId: string | null;
  treasurerName: string | null;
  treasurerCardNumberGrouped: string | null;
  treasurerIbanGrouped: string | null;
  treasurerBankName: string | null;
  treasurerAccountHolder: string | null;
  /** The settlement sentence (also shown as the closing box). */
  closingText: string;
}

/** Why a group cannot get a statement (the groups failed `validateGroups`). */
export class GroupStatementError extends Error {
  constructor(public readonly codes: GroupErrorCode[], message: string) {
    super(message);
    this.name = "GroupStatementError";
  }
}

export interface GroupCandidates {
  valid: SettlementGroupInput[];
  invalid: { group: SettlementGroupInput; reasons: GroupErrorCode[] }[];
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Splits the event's groups into those that may get a statement and those that may not
 * (each invalid one with its reason codes). A person in two groups makes both invalid.
 * Output order does not depend on input order.
 */
export function splitGroupCandidates(groups: readonly SettlementGroupInput[], ctx: { knownPersonIds: readonly string[]; treasurerId: string }): GroupCandidates {
  const errors = validateGroups(groups, ctx);
  const reasons = new Map<string, Set<GroupErrorCode>>();
  for (const e of errors) {
    for (const id of e.groupIds ?? [e.groupId]) {
      if (!reasons.has(id)) reasons.set(id, new Set());
      reasons.get(id)!.add(e.code);
    }
  }
  const sorted = [...groups].sort((a, b) => cmp(a.id, b.id));
  return {
    valid: sorted.filter((g) => !reasons.has(g.id)),
    invalid: sorted.filter((g) => reasons.has(g.id)).map((group) => ({ group, reasons: [...reasons.get(group.id)!].sort(cmp) }))
  };
}

/** The one-sentence "what happens" text (docs/PLAN.md, SG-5). */
export function buildGroupSentence(params: {
  outcome: GroupOutcome;
  amount: number;
  currency: string;
  representativeName: string;
  treasurerName: string | null;
  treasurerInGroup: boolean;
}): string {
  const { outcome, amount, currency, representativeName, treasurerName, treasurerInGroup } = params;
  const money = `${formatAmount(amount)} ${currency}`;
  if (treasurerInGroup) {
    if (outcome === "settled") return "مسئول صندوق عضو این گروه است و حساب گروه صاف است؛ تسویه‌شده.";
    const side = outcome === "pay" ? "بدهکار" : "بستانکار";
    return `مسئول صندوق (${representativeName}) عضو این گروه است. باقیِ حساب گروه، ${money} ${side}، داخل خود گروه و بیرون از برنامه تسویه می‌شود.`;
  }
  const treasurer = treasurerName ?? "؟";
  if (outcome === "pay") return `نمایندهٔ گروه (${representativeName}) باید مبلغ ${money} به مسئول صندوق (${treasurer}) پرداخت کند.`;
  if (outcome === "receive") return `نمایندهٔ گروه (${representativeName}) باید مبلغ ${money} از مسئول صندوق (${treasurer}) دریافت کند.`;
  return "تسویه‌شده؛ حساب این گروه صاف است و چیزی برای پرداخت یا دریافت نیست.";
}

/**
 * Builds one group's statement data. `groups` is the event's complete set of groups (needed to
 * validate that nobody is in two groups). Throws `GroupStatementError` when the groups are
 * invalid or `groupId` is not among them — callers should check `splitGroupCandidates` first.
 */
export function buildGroupStatementData(params: {
  event: StatementBuildEvent;
  /** Every member of the event, active and archived. */
  members: GroupStatementMemberInput[];
  groups: SettlementGroupInput[];
  groupId: string;
}): GroupStatementData {
  const { event, members, groups, groupId } = params;
  const treasurerId = event.treasurerPersonId ?? "";
  if (treasurerId === "") throw new GroupStatementError([], "برای صدور صورت‌حساب گروه، ابتدا مسئول صندوق را تعیین کنید.");
  const target = groups.find((g) => g.id === groupId);
  const split = splitGroupCandidates(groups, { knownPersonIds: members.map((m) => m.personId), treasurerId });
  const invalid = split.invalid.find((i) => i.group.id === groupId);
  if (!target || invalid || !split.valid.some((g) => g.id === groupId)) {
    throw new GroupStatementError(invalid?.reasons ?? [], "این گروه معتبر نیست و صورت‌حساب آن صادر نمی‌شود.");
  }

  const balancesByPerson = Object.fromEntries(members.map((m) => [m.personId, m.balance]));
  // Only the valid groups form units, so one broken group never blocks another.
  const view = buildEventUnitsView({ balancesByPerson, groups: split.valid, treasurerId, knownPersonIds: members.map((m) => m.personId) });
  const unit = view.units.find((u): u is GroupUnit => u.kind === "group" && u.groupId === groupId);
  if (!unit) throw new GroupStatementError([], "این گروه معتبر نیست و صورت‌حساب آن صادر نمی‌شود.");

  const byId = new Map(members.map((m) => [m.personId, m]));
  const order = new Map(members.map((m) => [m.personId, m.sortOrder ?? 0]));
  const memberRows: GroupStatementMemberRow[] = unit.memberIds
    .map((personId) => {
      const m = byId.get(personId)!;
      return { personId, name: m.name, balance: m.balance, active: m.active };
    })
    .sort((a, b) => (order.get(a.personId)! - order.get(b.personId)!) || cmp(a.name, b.name) || cmp(a.personId, b.personId));

  const rep = byId.get(unit.representativeId)!;
  const treasurerInGroup = view.treasurerInGroup && view.hubUnit?.kind === "group" && view.hubUnit.groupId === groupId;
  const outcome: GroupOutcome = unit.balance < 0 ? "pay" : unit.balance > 0 ? "receive" : "settled";
  const amount = Math.abs(unit.balance);
  const treasurerName = event.treasurerPersonId ? (byId.get(event.treasurerPersonId)?.name ?? null) : null;

  return {
    kind: "group",
    event: { title: event.title, startDate: event.startDate, endDate: event.endDate, currency: event.currency },
    group: { groupId, name: unit.name, representativeId: rep.personId, representativeName: rep.name, representativeFirstName: rep.firstName },
    members: memberRows,
    internalCancelled: unit.internalCancelled,
    groupBalance: unit.balance,
    outcome,
    amount,
    treasurerInGroup,
    treasurerPersonId: event.treasurerPersonId,
    treasurerName,
    treasurerCardNumberGrouped: event.treasurerCardNumberGrouped ?? null,
    treasurerIbanGrouped: event.treasurerIbanGrouped ?? null,
    treasurerBankName: event.treasurerBankName ?? null,
    treasurerAccountHolder: event.treasurerAccountHolder ?? null,
    closingText: buildGroupSentence({ outcome, amount, currency: event.currency, representativeName: rep.name, treasurerName, treasurerInGroup })
  };
}

/**
 * What makes an issued group statement out of date: the group's name, membership, representative,
 * each member's balance, and the treasurer. Names of people, dates etc. are deliberately not part of it.
 */
export function groupStatementFingerprint(data: GroupStatementData): string {
  return canonicalJson({
    groupId: data.group.groupId,
    name: data.group.name,
    representativeId: data.group.representativeId,
    members: data.members.map((m) => [m.personId, m.balance]).sort((a, b) => cmp(String(a[0]), String(b[0]))),
    treasurerPersonId: data.treasurerPersonId
  });
}

/** True when the issued statement no longer matches the current data; a group that no longer exists / is invalid (`current` = null) is stale too. */
export function isGroupStatementStale(issued: GroupStatementData, current: GroupStatementData | null): boolean {
  return current === null || groupStatementFingerprint(issued) !== groupStatementFingerprint(current);
}

/** Short summary text for the WhatsApp / Telegram / SMS message to the representative. */
export function buildGroupSummaryText(params: { data: GroupStatementData; link: string | null; noLinkLine: string }): string {
  const { data, link, noLinkLine } = params;
  const lines = [`سلام ${data.group.representativeFirstName}،`, `صورت‌حساب گروه «${data.group.name}» در رویداد «${data.event.title}» آماده است.`, data.closingText];
  if (data.treasurerName && !data.treasurerInGroup) lines.push(`مسئول صندوق: ${data.treasurerName}`);
  if (data.outcome === "pay" && !data.treasurerInGroup) {
    if (data.treasurerCardNumberGrouped) lines.push(`شماره کارت: ${data.treasurerCardNumberGrouped}`);
    if (data.treasurerIbanGrouped) lines.push(`شبا: ${data.treasurerIbanGrouped}`);
  }
  lines.push(link ?? noLinkLine);
  return lines.join("\n");
}
