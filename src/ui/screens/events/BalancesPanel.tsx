import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { computeBalanceBreakdown } from "@/domain/balanceEngine";
import { formatAmount } from "@/domain/format";
import { Avatar } from "@/ui/components/Avatar";

interface MemberOption {
  personId: string;
  name: string;
  photo?: Blob;
}

interface BalancesPanelProps {
  eventId: string;
  members: MemberOption[];
  currency: string;
}

/** Per-member balance breakdown (docs/PLAN.md Stage 3A UI #10) — fund money (contributions/settlements) is kept separate from expense shares. */
export function BalancesPanel({ eventId, members, currency }: BalancesPanelProps) {
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

  const breakdown = computeBalanceBreakdown(
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
      {breakdown.map((row) => {
        const member = members.find((m) => m.personId === row.personId);
        const name = member?.name ?? "؟";
        const balanceClass =
          row.balance > 0 ? "balance-row__balance--positive" : row.balance < 0 ? "balance-row__balance--negative" : "balance-row__balance--zero";
        const chipClass =
          row.balance > 0 ? "balance-chip balance-chip--creditor" : row.balance < 0 ? "balance-chip balance-chip--debtor" : "balance-chip";
        return (
          <div className="balance-row" key={row.personId}>
            <Avatar id={row.personId} name={name} photo={member?.photo} />
            <div className="balance-row__main">
              <div className="balance-row__name">{name}</div>
              <div className="balance-row__breakdown">
                {row.expensePaid > 0 && <span>پرداخت هزینه: {formatAmount(row.expensePaid)}</span>}
                {row.expenseShare > 0 && <span>سهم از هزینه‌ها: {formatAmount(row.expenseShare)}</span>}
                {row.contributedToFund > 0 && <span>واریز به صندوق: {formatAmount(row.contributedToFund)}</span>}
                {row.receivedAsTreasurer > 0 && <span>دریافتی به‌عنوان مسئول صندوق: {formatAmount(row.receivedAsTreasurer)}</span>}
                {row.settlementsPaid > 0 && <span>تسویه پرداختی: {formatAmount(row.settlementsPaid)}</span>}
                {row.settlementsReceived > 0 && <span>تسویه دریافتی: {formatAmount(row.settlementsReceived)}</span>}
              </div>
            </div>
            <div className="balance-row__end">
              <span className={balanceClass}>
                {formatAmount(Math.abs(row.balance))} {currency}
              </span>
              {row.balance !== 0 && <span className={chipClass}>{row.balance > 0 ? "طلبکار" : "بدهکار"}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
