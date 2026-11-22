import { APP_VERSION } from "@/config/app";
import { displayName } from "@/domain/displayName";
import { isEventClosed } from "@/domain/eventStatus";
import { computeBalances } from "@/domain/balanceEngine";
import { formatAmount } from "@/domain/format";
import {
  buildGroupStatementData,
  GroupStatementError,
  isGroupStatementStale,
  splitGroupCandidates,
  type GroupCandidates,
  type GroupStatementData,
  type GroupStatementMemberInput
} from "@/domain/groupStatement";
import type { SettlementGroupInput } from "@/domain/settlementUnits";
import { buildBalanceText, categoryForStatement, fillTemplate, pickTemplate } from "@/domain/messageTemplate";
import { formatCardNumberGrouped, formatIbanGrouped } from "@/domain/paymentValidation";
import {
  buildComprehensiveReportData,
  buildMemberStatementData,
  type StatementBuildEvent,
  type StatementBuildMember,
  type StatementBuildVoucher
} from "@/domain/statementBuilder";
import { canonicalJson, computeVerificationCode } from "@/domain/verificationCode";
import { db } from "../db";
import type { Event, SendChannel, Statement, StatementKind } from "../types";
import { OnlinePermissionError } from "../online/outboxHook";
import { diffFields, logOperation, newBaseFields, touchBaseFields } from "./operationLog";
import { SETTLEMENT_GROUP_ERROR_MESSAGES } from "./settlementGroupsRepository";

const STATEMENT_LOG_FIELDS: (keyof Statement)[] = [
  "eventId",
  "kind",
  "personId",
  "number",
  "issueVersion",
  "issuedAt",
  "templateId",
  "closingText",
  "verificationCode",
  "status"
];

interface StatementIssueContext {
  event: Event;
  buildEvent: StatementBuildEvent;
  members: StatementBuildMember[];
  vouchers: StatementBuildVoucher[];
}

/** Statements can only be issued for a closed event that has a treasurer set (docs/PLAN.md Stage 3B UI). */
function assertReadyToIssue(event: Event): void {
  if (!isEventClosed(event, new Date())) {
    throw new Error("صورت‌حساب پس از پایان ایونت قابل صدور است.");
  }
  if (!event.treasurerPersonId) {
    throw new Error("برای صدور صورت‌حساب، ابتدا مسئول صندوق را تعیین کنید.");
  }
}

async function loadIssueContext(eventId: string): Promise<StatementIssueContext> {
  const event = await db.events.get(eventId);
  if (!event) throw new Error(`Event ${eventId} not found`);

  // displayName disambiguates by first name among ALL members of the event, active or inactive
  // (docs/PLAN.md Stage 3B.1) — so the lookup here is not restricted to active members.
  const allMemberRows = await db.eventMembers
    .where("eventId")
    .equals(eventId)
    .filter((m) => !m.deleted)
    .toArray();
  const allPersons = await db.persons.bulkGet(allMemberRows.map((m) => m.personId));
  const nameParts = allMemberRows.map((m, index) => ({
    personId: m.personId,
    firstName: allPersons[index]?.firstName ?? "؟",
    lastName: allPersons[index]?.lastName ?? ""
  }));

  const memberRows = allMemberRows.filter((m) => m.active);
  const persons = await db.persons.bulkGet(memberRows.map((m) => m.personId));
  const members: StatementBuildMember[] = memberRows
    .map((m, index) => {
      const person = persons[index];
      const parts = { personId: m.personId, firstName: person?.firstName ?? "؟", lastName: person?.lastName ?? "" };
      return {
        personId: m.personId,
        name: displayName(parts, nameParts),
        firstName: parts.firstName,
        lastName: parts.lastName,
        defaultWeight: m.defaultWeight,
        sortOrder: m.sortOrder,
        cardNumberGrouped: person?.cardNumber ? formatCardNumberGrouped(person.cardNumber) : undefined,
        ibanGrouped: person?.iban ? formatIbanGrouped(person.iban) : undefined,
        bankName: person?.bankName,
        accountHolder: person?.accountHolder
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ sortOrder: _sortOrder, ...rest }) => rest);

  const voucherRows = await db.vouchers
    .where("eventId")
    .equals(eventId)
    .filter((v) => !v.deleted && v.status === "active")
    .toArray();
  const vouchers: StatementBuildVoucher[] = voucherRows.map((v) => ({
    number: v.number,
    type: v.type,
    expenseDate: v.expenseDate,
    recordedAt: v.recordedAt,
    description: v.description,
    totalAmount: v.totalAmount,
    payers: v.payers,
    participants: v.participants,
    shares: v.shares,
    splitMode: v.splitMode,
    itemizedSnapshot: v.itemizedSnapshot,
    fromPersonId: v.fromPersonId,
    toPersonId: v.toPersonId
  }));

  const buildEvent: StatementBuildEvent = {
    title: event.title,
    startDate: event.startDate,
    endDate: event.endDate,
    currency: event.currency,
    treasurerPersonId: event.treasurerPersonId,
    treasurerCardNumberGrouped: event.treasurerCardNumber ? formatCardNumberGrouped(event.treasurerCardNumber) : undefined,
    treasurerIbanGrouped: event.treasurerIban ? formatIbanGrouped(event.treasurerIban) : undefined,
    treasurerBankName: event.treasurerBankName,
    treasurerAccountHolder: event.treasurerAccountHolder
  };

  return { event, buildEvent, members, vouchers };
}

/** Persists a new "current" statement, marking any prior current statement of the same eventId+kind+personId as outdated first. */
async function persistStatement(
  eventId: string,
  kind: StatementKind,
  personId: string | null,
  snapshotObject: unknown,
  templateId: string | null,
  closingText: string
): Promise<Statement> {
  const snapshot = canonicalJson(snapshotObject);
  const verificationCode = await computeVerificationCode(snapshot);

  return db.transaction("rw", db.statements, db.operations, async () => {
    const existingForEvent = await db.statements.where("eventId").equals(eventId).toArray();
    const number = existingForEvent.reduce((max, s) => Math.max(max, s.number), 0) + 1;

    const sameKey = existingForEvent.filter((s) => s.kind === kind && s.personId === personId);
    const issueVersion = sameKey.reduce((max, s) => Math.max(max, s.issueVersion), 0) + 1;
    for (const prior of sameKey.filter((s) => s.status === "current")) {
      const updated: Statement = { ...prior, status: "outdated", ...touchBaseFields(prior) };
      await db.statements.put(updated);
      await logOperation(db, "statements", prior.id, "outdate", diffFields(prior, updated, ["status"]));
    }

    const statement: Statement = {
      ...newBaseFields(),
      eventId,
      kind,
      personId,
      number,
      issueVersion,
      issuedAt: new Date().toISOString(),
      snapshot,
      templateId,
      closingText,
      verificationCode,
      status: "current",
      sendLog: []
    };
    await db.statements.add(statement);
    await logOperation(db, "statements", statement.id, "create", diffFields(undefined, statement, STATEMENT_LOG_FIELDS));
    return statement;
  });
}

async function issueForPerson(eventId: string, personId: string, ctx: StatementIssueContext): Promise<Statement> {
  const kind: "member" | "treasurer" = personId === ctx.event.treasurerPersonId ? "treasurer" : "member";
  const data = buildMemberStatementData({ kind, event: ctx.buildEvent, members: ctx.members, vouchers: ctx.vouchers, personId });

  const templates = await db.messageTemplates.filter((t) => !t.deleted).toArray();
  const category = categoryForStatement(kind, data.summary.balance);
  const picked = pickTemplate(
    templates.map((t) => ({ id: t.id, category: t.category, text: t.text, enabled: t.enabled })),
    category
  );
  if (!picked) {
    throw new Error("هیچ متن فعالی برای این نوع پیام وجود ندارد؛ در تنظیمات «متن‌های صورت‌حساب» حداقل یک متن را فعال کنید.");
  }

  const balanceText = buildBalanceText(data.summary.balance, ctx.buildEvent.currency);
  const closingText = fillTemplate(picked.text, {
    name: data.member.firstName,
    amount: formatAmount(Math.abs(data.summary.balance)),
    currency: ctx.buildEvent.currency,
    treasurer: data.treasurerName ?? "",
    event: ctx.buildEvent.title,
    balanceText
  });

  return persistStatement(eventId, kind, personId, { ...data, closingText, appVersion: APP_VERSION }, picked.id, closingText);
}

/**
 * A member's statement computed live from local data, WITHOUT issuing or
 * persisting anything (the member view of an online event, docs/PLAN.md
 * "Join flow"). Works on open events too; has no verification code.
 */
async function previewForPerson(eventId: string, personId: string) {
  const ctx = await loadIssueContext(eventId);
  const kind: "member" | "treasurer" = personId === ctx.event.treasurerPersonId ? "treasurer" : "member";
  const data = buildMemberStatementData({ kind, event: ctx.buildEvent, members: ctx.members, vouchers: ctx.vouchers, personId });
  const closingText = buildBalanceText(data.summary.balance, ctx.buildEvent.currency);
  return { ...data, closingText, appVersion: APP_VERSION };
}

/** Everything a group statement is built from, read live (all members, archived ones too). */
async function loadGroupContext(eventId: string) {
  const event = await db.events.get(eventId);
  if (!event) throw new Error(`Event ${eventId} not found`);
  const memberRows = await db.eventMembers.where("eventId").equals(eventId).filter((m) => !m.deleted).toArray();
  const persons = await db.persons.bulkGet(memberRows.map((m) => m.personId));
  const nameParts = memberRows.map((m, i) => ({ personId: m.personId, firstName: persons[i]?.firstName ?? "؟", lastName: persons[i]?.lastName ?? "" }));

  const voucherRows = await db.vouchers
    .where("eventId")
    .equals(eventId)
    .filter((v) => !v.deleted && v.status === "active")
    .toArray();
  const balances = computeBalances(
    memberRows.map((m) => m.personId),
    voucherRows.map((v) => ({ type: v.type, status: "active", totalAmount: v.totalAmount, payers: v.payers, shares: v.shares, fromPersonId: v.fromPersonId, toPersonId: v.toPersonId }))
  );
  const balanceOf = new Map(balances.map((b) => [b.personId, b.balance]));

  const members: GroupStatementMemberInput[] = memberRows.map((m, i) => ({
    personId: m.personId,
    name: displayName(nameParts[i], nameParts),
    firstName: persons[i]?.firstName ?? "؟",
    balance: balanceOf.get(m.personId) ?? 0,
    active: m.active,
    sortOrder: m.sortOrder
  }));

  const groupRows = await db.settlementGroups.where("eventId").equals(eventId).filter((g) => !g.deleted).toArray();
  const groups: SettlementGroupInput[] = groupRows.map((g) => ({ id: g.id, name: g.name, memberIds: g.memberIds, representativeId: g.representativeId }));

  const buildEvent: StatementBuildEvent = {
    title: event.title,
    startDate: event.startDate,
    endDate: event.endDate,
    currency: event.currency,
    treasurerPersonId: event.treasurerPersonId,
    treasurerCardNumberGrouped: event.treasurerCardNumber ? formatCardNumberGrouped(event.treasurerCardNumber) : undefined,
    treasurerIbanGrouped: event.treasurerIban ? formatIbanGrouped(event.treasurerIban) : undefined,
    treasurerBankName: event.treasurerBankName,
    treasurerAccountHolder: event.treasurerAccountHolder
  };
  return { event, buildEvent, members, groups };
}

function groupErrorMessage(e: unknown): Error {
  if (e instanceof GroupStatementError) {
    const reasons = [...new Set(e.codes.map((c) => SETTLEMENT_GROUP_ERROR_MESSAGES[c]))];
    return new Error([e.message, ...reasons].join("\n"));
  }
  return e instanceof Error ? e : new Error(String(e));
}

async function issueForGroupInContext(eventId: string, groupId: string, ctx: Awaited<ReturnType<typeof loadGroupContext>>): Promise<Statement> {
  let data: GroupStatementData;
  try {
    data = buildGroupStatementData({ event: ctx.buildEvent, members: ctx.members, groups: ctx.groups, groupId });
  } catch (e) {
    throw groupErrorMessage(e);
  }
  // personId holds the group id: the "same statement" key (prior issues become outdated, version counts up).
  return persistStatement(eventId, "group", groupId, { ...data, appVersion: APP_VERSION }, null, data.closingText);
}

export const statementsRepository = {
  /** Live, unissued preview of one member's statement (no write, no operation). */
  previewForMember: previewForPerson,

  /** Issues (or re-issues) one member's statement — automatically the treasurer variant if they're the event's treasurer. */
  async issueForMember(eventId: string, personId: string): Promise<Statement> {
    const ctx = await loadIssueContext(eventId);
    assertReadyToIssue(ctx.event);
    return issueForPerson(eventId, personId, ctx);
  },

  /** "صدور صورت‌حساب همه‌ی اعضا": issues a statement for every active member of the event. */
  async issueForAllMembers(eventId: string): Promise<Statement[]> {
    const ctx = await loadIssueContext(eventId);
    assertReadyToIssue(ctx.event);
    const statements: Statement[] = [];
    for (const member of ctx.members) {
      statements.push(await issueForPerson(eventId, member.personId, ctx));
    }
    return statements;
  },

  /** "صدور گزارش جامع": issues the whole-event comprehensive report (no closing message/template). */
  async issueComprehensiveReport(eventId: string): Promise<Statement> {
    const ctx = await loadIssueContext(eventId);
    assertReadyToIssue(ctx.event);
    const data = buildComprehensiveReportData({ event: ctx.buildEvent, members: ctx.members, vouchers: ctx.vouchers });
    return persistStatement(eventId, "comprehensive", null, { ...data, appVersion: APP_VERSION }, null, "");
  },

  /** Which of the event's settlement groups may get a statement, and why the others may not (SG-5). */
  async listGroupCandidates(eventId: string): Promise<GroupCandidates & { names: Record<string, string> }> {
    const ctx = await loadGroupContext(eventId);
    const split = splitGroupCandidates(ctx.groups, { knownPersonIds: ctx.members.map((m) => m.personId), treasurerId: ctx.event.treasurerPersonId ?? "" });
    return { ...split, names: Object.fromEntries(ctx.groups.map((g) => [g.id, g.name])) };
  },

  /** "صدور برای یک گروه": issues (or re-issues) one group's statement. Refuses invalid groups. */
  async issueForGroup(eventId: string, groupId: string): Promise<Statement> {
    const ctx = await loadGroupContext(eventId);
    assertReadyToIssue(ctx.event);
    return issueForGroupInContext(eventId, groupId, ctx);
  },

  /** "صدور صورت‌حساب گروه‌ها": issues a statement for every valid group; invalid groups are skipped. */
  async issueForAllGroups(eventId: string): Promise<Statement[]> {
    const ctx = await loadGroupContext(eventId);
    assertReadyToIssue(ctx.event);
    const { valid } = splitGroupCandidates(ctx.groups, { knownPersonIds: ctx.members.map((m) => m.personId), treasurerId: ctx.event.treasurerPersonId ?? "" });
    if (valid.length === 0) throw new Error("گروه معتبری برای صدور صورت‌حساب وجود ندارد.");
    const statements: Statement[] = [];
    for (const group of valid) statements.push(await issueForGroupInContext(eventId, group.id, ctx));
    return statements;
  },

  /**
   * Ids of the event's CURRENT group statements (older versions are already "outdated") that no longer match the live data (balances, members,
   * representative, name, treasurer, or the group is gone/invalid). Computed on read, never stored.
   */
  async staleGroupStatementIds(eventId: string): Promise<string[]> {
    const issued = await db.statements
      .where("eventId")
      .equals(eventId)
      .filter((s) => !s.deleted && s.kind === "group" && s.status === "current")
      .toArray();
    if (issued.length === 0) return [];
    const ctx = await loadGroupContext(eventId);
    const stale: string[] = [];
    for (const statement of issued) {
      let old: GroupStatementData;
      try {
        old = JSON.parse(statement.snapshot) as GroupStatementData;
      } catch {
        continue; // still encrypted (no event key yet): nothing to compare
      }
      let current: GroupStatementData | null = null;
      try {
        current = buildGroupStatementData({ event: ctx.buildEvent, members: ctx.members, groups: ctx.groups, groupId: statement.personId ?? "" });
      } catch {
        current = null;
      }
      if (isGroupStatementStale(old, current)) stale.push(statement.id);
    }
    return stale;
  },

  async list(eventId: string): Promise<Statement[]> {
    return db.statements
      .where("eventId")
      .equals(eventId)
      .filter((s) => !s.deleted)
      .toArray();
  },

  async get(id: string): Promise<Statement | undefined> {
    return db.statements.get(id);
  },

  /** Appends one entry to a statement's sendLog (docs/PLAN.md Stage 3C) — called after a share/send action actually completes. */
  async logSend(statementId: string, channel: SendChannel, target: string): Promise<void> {
    try {
      await db.transaction("rw", db.statements, db.operations, async () => {
        const statement = await db.statements.get(statementId);
        if (!statement) return;
        const entry = { channel, at: new Date().toISOString(), target };
        const updated: Statement = { ...statement, sendLog: [...statement.sendLog, entry], ...touchBaseFields(statement) };
        await db.statements.put(updated);
        await logOperation(db, "statements", statement.id, "update", diffFields(statement, updated, ["sendLog"]));
      });
    } catch (e) {
      // A read-only member of an online event may still send a statement; the send log is the treasurer's record, so it is simply not written.
      if (!(e instanceof OnlinePermissionError)) throw e;
    }
  }
};
