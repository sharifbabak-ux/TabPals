import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { computeBalances } from "@/domain/balanceEngine";
import { formatAmount } from "@/domain/format";

interface MemberOption {
  personId: string;
  name: string;
}

interface BalancesPanelProps {
  eventId: string;
  members: MemberOption[];
  currencyLabel: string;
}

/** Temporary simple balances panel — the full dashboard arrives in Stage 3 (docs/PLAN.md #7). */
export function BalancesPanel({ eventId, members, currencyLabel }: BalancesPanelProps) {
  const vouchers = useLiveQuery(
    () =>
      db.vouchers
        .where("eventId")
        .equals(eventId)
        .filter((v) => !v.deleted)
        .toArray(),
    [eventId]
  );

  if (!vouchers || members.length === 0) return null;

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

  return (
    <div className="balances-panel">
      <h2 className="section-title">تراز افراد</h2>
      {balances.map((balance) => {
        const balanceClass =
          balance.balance > 0 ? "balance-row__balance--positive" : balance.balance < 0 ? "balance-row__balance--negative" : "balance-row__balance--zero";
        return (
          <div className="balance-row" key={balance.personId}>
            <div>
              <div>{members.find((m) => m.personId === balance.personId)?.name ?? "؟"}</div>
              <div className="balance-row__amounts">
                <span>پرداخت: {formatAmount(balance.totalPaid)}</span>
                <span>سهم: {formatAmount(balance.totalShare)}</span>
              </div>
            </div>
            <span className={balanceClass}>
              {formatAmount(Math.abs(balance.balance))} {currencyLabel}
              {balance.balance > 0 ? " طلبکار" : balance.balance < 0 ? " بدهکار" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
