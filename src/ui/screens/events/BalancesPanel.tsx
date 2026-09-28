import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { computeBalances } from "@/domain/balanceEngine";
import { formatAmount } from "@/domain/format";
import { Avatar } from "@/ui/components/Avatar";

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
        const name = members.find((m) => m.personId === balance.personId)?.name ?? "؟";
        const balanceClass =
          balance.balance > 0 ? "balance-row__balance--positive" : balance.balance < 0 ? "balance-row__balance--negative" : "balance-row__balance--zero";
        const chipClass =
          balance.balance > 0 ? "balance-chip balance-chip--creditor" : balance.balance < 0 ? "balance-chip balance-chip--debtor" : "balance-chip";
        return (
          <div className="balance-row" key={balance.personId}>
            <Avatar id={balance.personId} name={name} />
            <div className="balance-row__main">
              <div className="balance-row__name">{name}</div>
              <div className="balance-row__amounts">
                <span>پرداخت: {formatAmount(balance.totalPaid)}</span>
                <span>سهم: {formatAmount(balance.totalShare)}</span>
              </div>
            </div>
            <div className="balance-row__end">
              <span className={balanceClass}>
                {formatAmount(Math.abs(balance.balance))} {currencyLabel}
              </span>
              {balance.balance !== 0 && (
                <span className={chipClass}>{balance.balance > 0 ? "طلبکار" : "بدهکار"}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
