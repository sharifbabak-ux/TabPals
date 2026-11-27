import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { settlementGroupsRepository } from "@/data/repositories/settlementGroupsRepository";
import { computeBalances } from "@/domain/balanceEngine";
import { formatAmount, formatJalaliDateTime, toPersianDigits } from "@/domain/format";
import { buildUnits, validateGroups, type GroupUnit, type SettlementGroupInput } from "@/domain/settlementUnits";
import { Tabs } from "@/ui/components/Tabs";
import { useEventMembers } from "@/ui/hooks/useEventMembers";
import { EU_TEXT } from "./eventUnitsLabels";
import { LIVE_TEXT } from "./liveEstimateLabels";
import { DRAFT_ERROR_MESSAGES } from "./settlementGroupLabels";
import "./eventUnits.css";
import "./liveEstimate.css";

interface LiveEstimatePanelProps {
  eventId: string;
  treasurerPersonId: string | null;
  currency: string;
}

type Mode = "groups" | "people";

function balanceClass(balance: number): string {
  return balance > 0 ? "balance-row__balance--positive" : balance < 0 ? "balance-row__balance--negative" : "balance-row__balance--zero";
}
function chipClass(balance: number): string {
  return `balance-chip ${balance > 0 ? "balance-chip--creditor" : "balance-chip--debtor"}`;
}

/**
 * Read-only, provisional balance estimate of an OPEN event (docs/PLAN.md, LIVE-1): the existing balance engine over
 * every non-deleted voucher up to now, shown per person or per settlement group. Nothing is stored or sent here;
 * the caller renders it only while the event is open.
 */
export function LiveEstimatePanel({ eventId, treasurerPersonId, currency }: LiveEstimatePanelProps) {
  const members = useEventMembers(eventId);
  const groups = useLiveQuery(() => settlementGroupsRepository.listByEvent(eventId), [eventId]);
  const vouchers = useLiveQuery(() => db.vouchers.where("eventId").equals(eventId).filter((v) => !v.deleted).toArray(), [eventId]);
  const unfinalized = useLiveQuery(
    () =>
      db.orderSessions
        .where("eventId")
        .equals(eventId)
        .filter((s) => !s.deleted && s.status !== "finalized" && s.status !== "cancelled")
        .count(),
    [eventId]
  );
  const [modeChoice, setModeChoice] = useState<Mode | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // The calculation time moves whenever the underlying data (re)loads or changes.
  const calculatedAt = useMemo(() => new Date(), [members, groups, vouchers, unfinalized]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!members || !groups || !vouchers || unfinalized === undefined) return null;

  const names = new Map(members.map((m) => [m.personId, m.name]));
  const nameOf = (id: string) => names.get(id) ?? "؟";
  const activeIds = new Set(members.filter((m) => m.active).map((m) => m.personId));
  const money = (n: number) => `${formatAmount(Math.abs(n))} ${currency}`;

  // Every member (inactive too) so a group's sum is exact — same input as the closed view.
  const balances = computeBalances(
    members.map((m) => m.personId),
    vouchers.map((v) => ({
      type: v.type,
      status: v.status,
      totalAmount: v.totalAmount,
      payers: v.payers,
      shares: v.shares,
      fromPersonId: v.fromPersonId,
      toPersonId: v.toPersonId
    }))
  );
  const balancesByPerson = Object.fromEntries(balances.map((b) => [b.personId, b.balance]));
  const groupInputs: SettlementGroupInput[] = groups.map((g) => ({ id: g.id, name: g.name, memberIds: g.memberIds, representativeId: g.representativeId }));
  const reasons = validateGroups(groupInputs, { knownPersonIds: members.map((m) => m.personId), treasurerId: treasurerPersonId ?? "" });
  const groupsValid = groups.length > 0 && reasons.length === 0;
  const mode: Mode = groupsValid ? (modeChoice ?? "groups") : "people";

  const units = buildUnits(balancesByPerson, mode === "groups" ? groupInputs : []);
  const visibleUnits = units.filter((u) => u.kind === "group" || activeIds.has(u.personId) || u.balance !== 0);

  function membersList(unit: GroupUnit) {
    return (
      <ul className="eu-members">
        {unit.members.map((m) => (
          <li key={m.personId}>
            <span className="eu-members__name">{nameOf(m.personId)}</span>
            <span className={balanceClass(m.balance)} style={{ fontSize: "0.9rem" }}>
              {money(m.balance)}
              {m.balance !== 0 && ` ${m.balance > 0 ? EU_TEXT.creditor : EU_TEXT.debtor}`}
            </span>
          </li>
        ))}
        <li className="eu-members__cancel">{unit.internalCancelled > 0 ? EU_TEXT.internalCancelled(formatAmount(unit.internalCancelled), currency) : EU_TEXT.noInternal}</li>
      </ul>
    );
  }

  function groupCard(u: GroupUnit) {
    const isOpen = Boolean(open[u.key]);
    return (
      <div className="eu-card" key={u.key} data-testid="live-group">
        <div className="eu-row">
          <div className="eu-row__main">
            <div className="eu-row__name">{u.name}</div>
            <div className="eu-row__sub">
              {EU_TEXT.representative}: {nameOf(u.representativeId)} · {EU_TEXT.membersCount(toPersianDigits(u.memberIds.length))}
            </div>
          </div>
          <div className="eu-row__end">
            <span className={balanceClass(u.balance)}>{money(u.balance)}</span>
            {u.settled ? <span className="eu-chip-settled">{EU_TEXT.settledChip}</span> : <span className={chipClass(u.balance)}>{u.balance > 0 ? EU_TEXT.creditor : EU_TEXT.debtor}</span>}
          </div>
        </div>
        {/* The internally cancelled amount is visible without expanding. */}
        <div className="eu-row__sub" style={{ marginTop: 6 }}>
          {u.internalCancelled > 0 ? EU_TEXT.internalCancelled(formatAmount(u.internalCancelled), currency) : EU_TEXT.noInternal}
        </div>
        <button type="button" className="eu-toggle" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [u.key]: !isOpen }))}>
          {isOpen ? EU_TEXT.hideMembers : EU_TEXT.showMembers}
        </button>
        {isOpen && membersList(u)}
      </div>
    );
  }

  return (
    <section className="eu-section" aria-label={LIVE_TEXT.title} data-testid="live-estimate">
      <div className="live-estimate__head">
        <h2 className="section-title" style={{ margin: 0 }}>
          {LIVE_TEXT.title}
        </h2>
        <span className="live-estimate__badge">{LIVE_TEXT.badge}</span>
      </div>
      <p className="eu-note" style={{ marginTop: 0 }}>
        {LIVE_TEXT.line}
      </p>
      <p className="eu-note" style={{ marginTop: 0 }}>
        {LIVE_TEXT.calculatedAt(formatJalaliDateTime(calculatedAt))}
      </p>
      {unfinalized > 0 && <p className="eu-warning">{LIVE_TEXT.openSessions(toPersianDigits(unfinalized))}</p>}

      {groups.length > 0 && !groupsValid && (
        <div className="eu-warning" role="alert">
          {EU_TEXT.invalidWarning}
          <ul>
            {[...new Set(reasons.map((r) => DRAFT_ERROR_MESSAGES[r.code]))].map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {groupsValid && (
        <div className="eu-mode">
          <Tabs<Mode>
            options={[
              { value: "groups", label: EU_TEXT.modeGroups },
              { value: "people", label: EU_TEXT.modePeople }
            ]}
            value={mode}
            onChange={setModeChoice}
          />
        </div>
      )}

      {visibleUnits.length === 0 && <p className="eu-note">{LIVE_TEXT.empty}</p>}
      {visibleUnits.map((u) =>
        u.kind === "group" ? (
          groupCard(u)
        ) : (
          <div className="eu-card" key={u.key} data-testid="live-person">
            <div className="eu-row">
              <div className="eu-row__main">
                <div className="eu-row__name">{nameOf(u.personId)}</div>
              </div>
              <div className="eu-row__end">
                <span className={balanceClass(u.balance)}>{money(u.balance)}</span>
                {u.balance !== 0 && <span className={chipClass(u.balance)}>{u.balance > 0 ? EU_TEXT.creditor : EU_TEXT.debtor}</span>}
              </div>
            </div>
          </div>
        )
      )}
    </section>
  );
}
