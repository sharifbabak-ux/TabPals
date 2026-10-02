/**
 * Pure statement/report data builders (docs/PLAN.md Stage 3B "MEMBER
 * STATEMENT CONTENT" / "COMPREHENSIVE REPORT CONTENT"). Takes plain
 * voucher/member/event-shaped data (not Dexie records) and returns plain
 * data objects ready to be canonicalized into a Statement's `snapshot` and
 * rendered by the UI — no DOM, no formatting, no randomness. Date/amount
 * formatting and closing-message template selection happen elsewhere
 * (src/domain/format.ts, src/domain/messageTemplate.ts).
 */
import type { ItemizedSnapshot, SplitMode, VoucherPayer, VoucherParticipant, VoucherShare, VoucherType } from "@/data/types";
import { type MemberBalanceBreakdown, computeBalanceBreakdown } from "./balanceEngine";
import { formatAmount } from "./format";
import { formatItemizedItem } from "./groupOrder";
import { buildSplitExplanation } from "./splitExplanation";
import { type HubSettlementPlan, computeHubSettlement } from "./hubSettlement";

export interface StatementBuildMember {
  personId: string;
  /** Display name (docs/PLAN.md Stage 3B.1): firstName, disambiguated with lastName in parentheses when another member shares the first name. Used for every "mention" of the member — tables, sهیم‌ها lines, payer/participant names, etc. */
  name: string;
  firstName: string;
  lastName: string;
  defaultWeight: number;
  /** Saved bank details, formatted for display; present only when the person has them saved. */
  cardNumberGrouped?: string;
  ibanGrouped?: string;
  bankName?: string;
  accountHolder?: string;
}

export interface StatementBuildVoucher {
  number: number;
  type: VoucherType;
  expenseDate: string;
  recordedAt: string;
  description: string;
  totalAmount: number;
  payers: VoucherPayer[];
  participants: VoucherParticipant[];
  shares: VoucherShare[];
  splitMode?: SplitMode;
  itemizedSnapshot?: ItemizedSnapshot;
  fromPersonId?: string;
  toPersonId?: string;
}

export interface StatementBuildEvent {
  title: string;
  startDate?: string;
  endDate?: string;
  currency: string;
  treasurerPersonId: string | null;
  treasurerCardNumberGrouped?: string;
  treasurerIbanGrouped?: string;
  treasurerBankName?: string;
  treasurerAccountHolder?: string;
}

export interface StatementEventInfo {
  title: string;
  startDate?: string;
  endDate?: string;
  currency: string;
}

export interface StatementExpenseRow {
  voucherNumber: number;
  expenseDate: string;
  description: string;
  totalAmount: number;
  /** This member's row-level split explanation; empty string when the member only paid and didn't participate. */
  splitExplanation: string;
  /** This member's share of this expense (0 if not a participant). */
  share: number;
  /** This member's payment toward this expense (0 if not a payer). */
  paid: number;
  /** Participant names, in member order — "سهیم‌ها: …". */
  participantNames: string[];
}

export interface StatementFundEntry {
  kind: "contribution" | "receivedAsTreasurer" | "settlementPaid" | "settlementReceived";
  voucherNumber: number;
  date: string;
  description: string;
  amount: number;
  counterpartyName: string | null;
}

export interface HubSettlementRow {
  personId: string;
  name: string;
  amount: number;
  /** Only present on "paysFromTreasurer" rows, when the creditor has saved bank details (docs/PLAN.md Stage 3B.1). */
  cardNumberGrouped?: string;
  ibanGrouped?: string;
  bankName?: string;
  accountHolder?: string;
}

export interface HubSettlementSection {
  paysToTreasurer: HubSettlementRow[];
  paysFromTreasurer: HubSettlementRow[];
  totalCollected: number;
  totalPaidOut: number;
}

export interface MemberStatementData {
  kind: "member" | "treasurer";
  event: StatementEventInfo;
  /** `name` is the disambiguated display name (for mentions); the header shows firstName+lastName (the full name), and {name} greetings use firstName alone. */
  member: { personId: string; name: string; firstName: string; lastName: string };
  expenses: StatementExpenseRow[];
  expenseTotals: { totalAmount: number; totalShare: number; totalPaid: number };
  fundEntries: StatementFundEntry[];
  summary: MemberBalanceBreakdown;
  treasurerName: string | null;
  treasurerCardNumberGrouped: string | null;
  treasurerIbanGrouped: string | null;
  treasurerBankName: string | null;
  treasurerAccountHolder: string | null;
  /** Treasurer statements only. */
  hubSettlement: HubSettlementSection | null;
}

function nameOf(members: StatementBuildMember[], personId: string): string {
  return members.find((m) => m.personId === personId)?.name ?? "؟";
}

function memberOf(members: StatementBuildMember[], personId: string): StatementBuildMember | undefined {
  return members.find((m) => m.personId === personId);
}

function hubSettlementSection(
  members: StatementBuildMember[],
  breakdowns: MemberBalanceBreakdown[],
  treasurerPersonId: string
): HubSettlementSection {
  const plan: HubSettlementPlan = computeHubSettlement(
    breakdowns.map((b) => ({ personId: b.personId, balance: b.balance })),
    treasurerPersonId
  );
  const paysToTreasurer = plan.transfers
    .filter((t) => t.toPersonId === treasurerPersonId)
    .map((t) => ({ personId: t.fromPersonId, name: nameOf(members, t.fromPersonId), amount: t.amount }));
  const paysFromTreasurer = plan.transfers
    .filter((t) => t.fromPersonId === treasurerPersonId)
    .map((t) => {
      const creditor = memberOf(members, t.toPersonId);
      return {
        personId: t.toPersonId,
        name: creditor?.name ?? "؟",
        amount: t.amount,
        cardNumberGrouped: creditor?.cardNumberGrouped,
        ibanGrouped: creditor?.ibanGrouped,
        bankName: creditor?.bankName,
        accountHolder: creditor?.accountHolder
      };
    });
  return { paysToTreasurer, paysFromTreasurer, totalCollected: plan.totalCollected, totalPaidOut: plan.totalPaidOut };
}

/** Builds a member or treasurer statement's data for one member (docs/PLAN.md Stage 3B "MEMBER STATEMENT CONTENT"). */
export function buildMemberStatementData(params: {
  kind: "member" | "treasurer";
  event: StatementBuildEvent;
  members: StatementBuildMember[];
  vouchers: StatementBuildVoucher[];
  personId: string;
}): MemberStatementData {
  const { kind, event, members, vouchers, personId } = params;

  const expenseVouchers = vouchers
    .filter((v) => v.type === "expense")
    .filter((v) => v.payers.some((p) => p.personId === personId) || v.participants.some((p) => p.personId === personId))
    .slice()
    .sort((a, b) => a.expenseDate.localeCompare(b.expenseDate) || a.number - b.number);

  const expenses: StatementExpenseRow[] = expenseVouchers.map((voucher) => {
    const share = voucher.shares.find((s) => s.personId === personId)?.share ?? 0;
    const paid = voucher.payers.find((p) => p.personId === personId)?.amount ?? 0;
    const isParticipant = voucher.participants.some((p) => p.personId === personId);
    const splitExplanation =
      isParticipant && voucher.splitMode
        ? buildSplitExplanation({
            splitMode: voucher.splitMode,
            totalAmount: voucher.totalAmount,
            participants: voucher.participants,
            itemizedPeople: voucher.itemizedSnapshot?.people
          }, personId)
        : "";
    return {
      voucherNumber: voucher.number,
      expenseDate: voucher.expenseDate,
      description: voucher.description,
      totalAmount: voucher.totalAmount,
      splitExplanation,
      share,
      paid,
      participantNames: members.filter((m) => voucher.participants.some((p) => p.personId === m.personId)).map((m) => m.name)
    };
  });

  const expenseTotals = expenses.reduce(
    (acc, row) => ({
      totalAmount: acc.totalAmount + row.totalAmount,
      totalShare: acc.totalShare + row.share,
      totalPaid: acc.totalPaid + row.paid
    }),
    { totalAmount: 0, totalShare: 0, totalPaid: 0 }
  );

  const fundEntries: StatementFundEntry[] = [];
  for (const voucher of vouchers) {
    if (voucher.type === "contribution") {
      if (voucher.fromPersonId === personId) {
        fundEntries.push({
          kind: "contribution",
          voucherNumber: voucher.number,
          date: voucher.expenseDate,
          description: voucher.description,
          amount: voucher.totalAmount,
          counterpartyName: voucher.toPersonId ? nameOf(members, voucher.toPersonId) : null
        });
      }
      if (kind === "treasurer" && voucher.toPersonId === personId) {
        fundEntries.push({
          kind: "receivedAsTreasurer",
          voucherNumber: voucher.number,
          date: voucher.expenseDate,
          description: voucher.description,
          amount: voucher.totalAmount,
          counterpartyName: voucher.fromPersonId ? nameOf(members, voucher.fromPersonId) : null
        });
      }
    } else if (voucher.type === "settlement") {
      if (voucher.fromPersonId === personId) {
        fundEntries.push({
          kind: "settlementPaid",
          voucherNumber: voucher.number,
          date: voucher.expenseDate,
          description: voucher.description,
          amount: voucher.totalAmount,
          counterpartyName: voucher.toPersonId ? nameOf(members, voucher.toPersonId) : null
        });
      }
      if (voucher.toPersonId === personId) {
        fundEntries.push({
          kind: "settlementReceived",
          voucherNumber: voucher.number,
          date: voucher.expenseDate,
          description: voucher.description,
          amount: voucher.totalAmount,
          counterpartyName: voucher.fromPersonId ? nameOf(members, voucher.fromPersonId) : null
        });
      }
    }
  }
  fundEntries.sort((a, b) => a.date.localeCompare(b.date) || a.voucherNumber - b.voucherNumber);

  const breakdowns = computeBalanceBreakdown(
    members.map((m) => m.personId),
    vouchers.map((v) => ({ type: v.type, status: "active", totalAmount: v.totalAmount, payers: v.payers, shares: v.shares, fromPersonId: v.fromPersonId, toPersonId: v.toPersonId }))
  );
  const summary = breakdowns.find((b) => b.personId === personId)!;

  const treasurerName = event.treasurerPersonId ? nameOf(members, event.treasurerPersonId) : null;
  const selfMember = memberOf(members, personId);

  return {
    kind,
    event: { title: event.title, startDate: event.startDate, endDate: event.endDate, currency: event.currency },
    member: { personId, name: selfMember?.name ?? "؟", firstName: selfMember?.firstName ?? "؟", lastName: selfMember?.lastName ?? "" },
    expenses,
    expenseTotals,
    fundEntries,
    summary,
    treasurerName,
    treasurerCardNumberGrouped: event.treasurerCardNumberGrouped ?? null,
    treasurerIbanGrouped: event.treasurerIbanGrouped ?? null,
    treasurerBankName: event.treasurerBankName ?? null,
    treasurerAccountHolder: event.treasurerAccountHolder ?? null,
    hubSettlement: kind === "treasurer" && event.treasurerPersonId ? hubSettlementSection(members, breakdowns, event.treasurerPersonId) : null
  };
}

// --- Comprehensive report -------------------------------------------------

export interface ComprehensiveMemberRow {
  personId: string;
  name: string;
  defaultWeight: number;
  isTreasurer: boolean;
}

export interface LedgerItemizedPerson {
  name: string;
  items: string[];
  extras: { label: string; share: number }[];
  total: number;
}

export interface LedgerRow {
  number: number;
  type: VoucherType;
  expenseDate: string;
  recordedAt: string;
  description: string;
  totalAmount: number;
  splitMode: SplitMode | null;
  payers: { name: string; amount: number }[];
  participantShares: { name: string; share: number }[];
  /** Itemized (group-order) vouchers only: the full per-person breakdown. */
  itemized?: LedgerItemizedPerson[];
  fromName: string | null;
  toName: string | null;
}

export interface FundAccount {
  contributions: { voucherNumber: number; name: string; date: string; amount: number }[];
  treasurerExpensePayments: { voucherNumber: number; description: string; amount: number }[];
  totalContributed: number;
  totalPaidByTreasurer: number;
  remaining: number;
}

export interface MemberSummaryRow extends MemberBalanceBreakdown {
  name: string;
}

export interface ControlCheck {
  label: string;
  passed: boolean;
}

export interface ComprehensiveReportData {
  kind: "comprehensive";
  event: StatementEventInfo;
  members: ComprehensiveMemberRow[];
  ledger: LedgerRow[];
  fundAccount: FundAccount;
  memberSummaries: MemberSummaryRow[];
  hubSettlement: HubSettlementSection | null;
  controlChecks: ControlCheck[];
}

/** Builds the comprehensive event report's data (docs/PLAN.md Stage 3B "COMPREHENSIVE REPORT CONTENT"). */
export function buildComprehensiveReportData(params: {
  event: StatementBuildEvent;
  members: StatementBuildMember[];
  vouchers: StatementBuildVoucher[];
}): ComprehensiveReportData {
  const { event, members, vouchers } = params;

  const membersRows: ComprehensiveMemberRow[] = members.map((m) => ({
    personId: m.personId,
    name: m.name,
    defaultWeight: m.defaultWeight,
    isTreasurer: m.personId === event.treasurerPersonId
  }));

  const ledger: LedgerRow[] = vouchers
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((voucher) => ({
      number: voucher.number,
      type: voucher.type,
      expenseDate: voucher.expenseDate,
      recordedAt: voucher.recordedAt,
      description: voucher.description,
      totalAmount: voucher.totalAmount,
      splitMode: voucher.splitMode ?? null,
      payers: voucher.payers.map((p) => ({ name: nameOf(members, p.personId), amount: p.amount })),
      participantShares: voucher.shares.map((s) => ({ name: nameOf(members, s.personId), share: s.share })),
      ...(voucher.itemizedSnapshot
        ? {
            itemized: voucher.itemizedSnapshot.people.map((p) => ({
              name: nameOf(members, p.personId),
              items: [
                ...(p.personTotal !== null ? [`جمع سفارش: ${formatAmount(p.personTotal)}`] : p.items.map(formatItemizedItem)),
                ...p.sharedItems.map((s) => `سهم از ${s.name} مشترک: ${formatAmount(s.amount)}`)
              ],
              extras: p.extras.filter((e) => e.share !== 0).map((e) => ({ label: e.label, share: e.share })),
              total: p.finalTotal
            }))
          }
        : {}),
      fromName: voucher.fromPersonId ? nameOf(members, voucher.fromPersonId) : null,
      toName: voucher.toPersonId ? nameOf(members, voucher.toPersonId) : null
    }));

  const contributions = vouchers
    .filter((v) => v.type === "contribution")
    .map((v) => ({
      voucherNumber: v.number,
      name: v.fromPersonId ? nameOf(members, v.fromPersonId) : "؟",
      date: v.expenseDate,
      amount: v.totalAmount
    }));
  const totalContributed = contributions.reduce((sum, c) => sum + c.amount, 0);

  const treasurerExpensePayments = event.treasurerPersonId
    ? vouchers
        .filter((v) => v.type === "expense")
        .flatMap((v) =>
          v.payers
            .filter((p) => p.personId === event.treasurerPersonId)
            .map((p) => ({ voucherNumber: v.number, description: v.description, amount: p.amount }))
        )
    : [];
  const totalPaidByTreasurer = treasurerExpensePayments.reduce((sum, p) => sum + p.amount, 0);

  const breakdowns = computeBalanceBreakdown(
    members.map((m) => m.personId),
    vouchers.map((v) => ({ type: v.type, status: "active", totalAmount: v.totalAmount, payers: v.payers, shares: v.shares, fromPersonId: v.fromPersonId, toPersonId: v.toPersonId }))
  );
  const memberSummaries: MemberSummaryRow[] = breakdowns.map((b) => ({ ...b, name: nameOf(members, b.personId) }));

  const totalShares = vouchers
    .filter((v) => v.type === "expense")
    .reduce((sum, v) => sum + v.shares.reduce((s, share) => s + share.share, 0), 0);
  const totalExpenseAmount = vouchers.filter((v) => v.type === "expense").reduce((sum, v) => sum + v.totalAmount, 0);
  const totalBalances = memberSummaries.reduce((sum, m) => sum + m.balance, 0);

  const controlChecks: ControlCheck[] = [
    { label: "جمع سهم‌ها = جمع هزینه‌ها", passed: totalShares === totalExpenseAmount },
    { label: "جمع مانده‌ها = ۰", passed: totalBalances === 0 }
  ];

  return {
    kind: "comprehensive",
    event: { title: event.title, startDate: event.startDate, endDate: event.endDate, currency: event.currency },
    members: membersRows,
    ledger,
    fundAccount: {
      contributions,
      treasurerExpensePayments,
      totalContributed,
      totalPaidByTreasurer,
      remaining: totalContributed - totalPaidByTreasurer
    },
    memberSummaries,
    hubSettlement: event.treasurerPersonId ? hubSettlementSection(members, breakdowns, event.treasurerPersonId) : null,
    controlChecks
  };
}
