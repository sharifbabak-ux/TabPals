import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { settlementGroupsRepository } from "@/data/repositories/settlementGroupsRepository";
import { computeBalances } from "@/domain/balanceEngine";
import { buildEventUnitsView, type UnitTransfer } from "@/domain/eventUnitsView";
import { formatAmount, toPersianDigits } from "@/domain/format";
import type { GroupUnit } from "@/domain/settlementUnits";
import { HelpHint } from "@/ui/components/HelpHint";
import { Tabs } from "@/ui/components/Tabs";
import { useEventMembers } from "@/ui/hooks/useEventMembers";
import { DRAFT_ERROR_MESSAGES } from "./settlementGroupLabels";
import { EU_HELP, EU_TEXT } from "./eventUnitsLabels";
import "./eventUnits.css";

interface EventUnitsPanelProps {
  eventId: string;
  treasurerPersonId: string | null;
  currency: string;
}

type Mode = "groups" | "people";

function balanceClass(balance: number): string {
  return balance > 0 ? "balance-row__balance--positive" : balance < 0 ? "balance-row__balance--negative" : "balance-row__balance--zero";
}

/**
 * «گروه‌ها» balance block + «تسویه» view (docs/PLAN.md, SG-4). Shown only when the event has
 * settlement groups; the individual balances panel is untouched. Display only: nothing is stored here.
 */
export function EventUnitsPanel({ eventId, treasurerPersonId, currency }: EventUnitsPanelProps) {
  const members = useEventMembers(eventId);
  const groups = useLiveQuery(() => settlementGroupsRepository.listByEvent(eventId), [eventId]);
  const vouchers = useLiveQuery(
    () =>
      db.vouchers
        .where("eventId")
        .equals(eventId)
        .filter((v) => !v.deleted)
        .toArray(),
    [eventId]
  );
  const [modeChoice, setModeChoice] = useState<Mode | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (!members || !groups || !vouchers || groups.length === 0) return null;

  const names = new Map(members.map((m) => [m.personId, m.name]));
  const nameOf = (id: string) => names.get(id) ?? "؟";
  const activeIds = new Set(members.filter((m) => m.active).map((m) => m.personId));

  // Every member (inactive ones too) so a group's sum is exact.
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
  const view = buildEventUnitsView({
    balancesByPerson,
    groups: groups.map((g) => ({ id: g.id, name: g.name, memberIds: g.memberIds, representativeId: g.representativeId })),
    treasurerId: treasurerPersonId,
    knownPersonIds: members.map((m) => m.personId)
  });

  const mode: Mode = view.valid ? (modeChoice ?? "groups") : "people";
  const money = (n: number) => `${formatAmount(Math.abs(n))} ${currency}`;
  const groupOfUnit = (key: string) => view.groupUnits.find((g) => g.key === key);

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

  function toggle(id: string, unit: GroupUnit) {
    const isOpen = Boolean(open[id]);
    return (
      <>
        <button type="button" className="eu-toggle" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [id]: !isOpen }))}>
          {isOpen ? EU_TEXT.hideMembers : EU_TEXT.showMembers}
        </button>
        {isOpen && membersList(unit)}
      </>
    );
  }

  function transferLabel(t: UnitTransfer): string {
    const unit = groupOfUnit(t.unitKey);
    const treasurer = `${EU_TEXT.treasurerRole} (${nameOf(treasurerPersonId ?? "")})`;
    const who = unit && mode === "groups" ? EU_TEXT.groupOf(unit.name, nameOf(unit.representativeId)) : nameOf(t.direction === "pay" ? t.fromPersonId : t.toPersonId);
    return t.direction === "pay" ? `${who} ← ${treasurer}` : `${treasurer} ← ${who}`;
  }

  const plan = mode === "groups" ? view.plan : view.individualPlan;
  const transfers = mode === "groups" ? view.transfers : view.individualPlan.transfers.map((t) => {
    const pays = t.toPersonId === treasurerPersonId;
    return { unitKey: `p:${pays ? t.fromPersonId : t.toPersonId}`, direction: pays ? ("pay" as const) : ("receive" as const), ...t };
  });

  return (
    <>
      {view.valid && (
        <section className="eu-section" aria-label={EU_TEXT.balancesTitle}>
          <div className="eu-title">
            <h2 className="section-title" style={{ margin: 0 }}>
              {EU_TEXT.balancesTitle}
            </h2>
            <HelpHint title={EU_HELP.balances.title} body={EU_HELP.balances.body} />
          </div>
          {view.units
            .filter((u) => u.kind === "group" || activeIds.has(u.personId) || u.balance !== 0)
            .map((u) =>
              u.kind === "group" ? (
                <div className="eu-card" key={u.key} data-testid="eu-group">
                  <div className="eu-row">
                    <div className="eu-row__main">
                      <div className="eu-row__name">{u.name}</div>
                      <div className="eu-row__sub">
                        {EU_TEXT.representative}: {nameOf(u.representativeId)} · {EU_TEXT.membersCount(toPersianDigits(u.memberIds.length))}
                      </div>
                    </div>
                    <div className="eu-row__end">
                      <span className={balanceClass(u.balance)}>{money(u.balance)}</span>
                      {u.settled ? (
                        <span className="eu-chip-settled">{EU_TEXT.settledChip}</span>
                      ) : (
                        <span className={`balance-chip ${u.balance > 0 ? "balance-chip--creditor" : "balance-chip--debtor"}`}>{u.balance > 0 ? EU_TEXT.creditor : EU_TEXT.debtor}</span>
                      )}
                    </div>
                  </div>
                  {toggle(`bal:${u.key}`, u)}
                </div>
              ) : (
                <div className="eu-card" key={u.key}>
                  <div className="eu-row">
                    <div className="eu-row__main">
                      <div className="eu-row__name">{nameOf(u.personId)}</div>
                    </div>
                    <div className="eu-row__end">
                      <span className={balanceClass(u.balance)}>{money(u.balance)}</span>
                      {u.balance !== 0 && <span className={`balance-chip ${u.balance > 0 ? "balance-chip--creditor" : "balance-chip--debtor"}`}>{u.balance > 0 ? EU_TEXT.creditor : EU_TEXT.debtor}</span>}
                    </div>
                  </div>
                </div>
              )
            )}
        </section>
      )}

      <section className="eu-section" aria-label={EU_TEXT.settlementTitle}>
        <div className="eu-title">
          <h2 className="section-title" style={{ margin: 0 }}>
            {EU_TEXT.settlementTitle}
          </h2>
        </div>

        {!view.valid && view.treasurerMissing && <p className="eu-warning">{EU_TEXT.noTreasurerWarning}</p>}
        {!view.valid && !view.treasurerMissing && (
          <div className="eu-warning" role="alert">
            {EU_TEXT.invalidWarning}
            <ul>
              {[...new Set(view.reasons.map((r) => DRAFT_ERROR_MESSAGES[r.code]))].map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        {view.valid && (
          <div className="eu-mode">
            <Tabs<Mode>
              options={[
                { value: "groups", label: `${EU_TEXT.modeLabel}: ${EU_TEXT.modeGroups}` },
                { value: "people", label: `${EU_TEXT.modeLabel}: ${EU_TEXT.modePeople}` }
              ]}
              value={mode}
              onChange={setModeChoice}
            />
            <HelpHint title={EU_HELP.mode.title} body={EU_HELP.mode.body} />
          </div>
        )}

        {!view.treasurerMissing && (
          <>
            {mode === "groups" && view.treasurerInGroup && view.hubUnit?.kind === "group" && (
              <p className="eu-note eu-note--with-hint">
                <span>
                  {view.hubUnit.balance === 0
                    ? EU_TEXT.hubGroupSettled(view.hubUnit.name)
                    : EU_TEXT.hubGroupNote(view.hubUnit.name, formatAmount(Math.abs(view.hubUnit.balance)), currency, view.hubUnit.balance > 0)}
                </span>
                <HelpHint title={EU_HELP.hubGroup.title} body={EU_HELP.hubGroup.body} />
              </p>
            )}

            {transfers.length === 0 && <p className="eu-note">{EU_TEXT.nothingToSettle}</p>}
            {transfers.map((t) => {
              const unit = mode === "groups" ? groupOfUnit(t.unitKey) : undefined;
              return (
                <div className="eu-card" key={`${t.fromPersonId}>${t.toPersonId}`} data-testid="eu-transfer">
                  <div className="eu-row">
                    <div className="eu-row__main eu-transfer">{transferLabel(t)}</div>
                    <div className="eu-row__end">
                      <span className={balanceClass(t.direction === "pay" ? -1 : 1)}>{money(t.amount)}</span>
                    </div>
                  </div>
                  {unit && toggle(`tr:${unit.key}`, unit)}
                </div>
              );
            })}

            {transfers.length > 0 && (
              <div className="eu-totals">
                <span>
                  {EU_TEXT.totalCollected}: {money(plan.totalCollected)}
                </span>
                <span>
                  {EU_TEXT.totalPaidOut}: {money(plan.totalPaidOut)}
                </span>
              </div>
            )}
            <p className="eu-note">{EU_TEXT.recordNote}</p>
          </>
        )}
      </section>
    </>
  );
}
