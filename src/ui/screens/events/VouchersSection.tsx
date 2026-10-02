import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import type { Voucher, VoucherType } from "@/data/types";
import { formatAmount, toPersianDigits } from "@/domain/format";
import { EmptyState } from "@/ui/components/EmptyState";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { ContributionIcon, ExpenseIcon, SettlementIcon } from "@/ui/components/icons";
import { SessionFormSheet } from "../orders/SessionFormSheet";
import { NewVoucherMenuSheet } from "./NewVoucherMenuSheet";
import { RecordedByMenuSheet } from "./RecordedByMenuSheet";
import { ExpenseWizardSheet } from "./ExpenseWizardSheet";
import { TransferFormSheet } from "./TransferFormSheet";
import { VoucherDetailSheet } from "./VoucherDetailSheet";

interface MemberOption {
  personId: string;
  name: string;
}

interface VouchersSectionProps {
  eventId: string;
  currency: string;
  activeMembers: MemberOption[];
  eventClosed: boolean;
  treasurerPersonId: string | null;
  treasurerName: string | null;
  onRequestSetTreasurer?: () => void;
  /** Opens this voucher's detail on first render (deep link from a finalized group order). */
  initialVoucherId?: string | null;
}

const TYPE_LABELS: Record<Voucher["type"], string> = {
  expense: "هزینه",
  contribution: "واریز",
  settlement: "تسویه"
};

const TYPE_ICONS: Record<Voucher["type"], typeof ExpenseIcon> = {
  expense: ExpenseIcon,
  contribution: ContributionIcon,
  settlement: SettlementIcon
};

export function VouchersSection({
  eventId,
  currency,
  activeMembers,
  eventClosed,
  treasurerPersonId,
  treasurerName,
  onRequestSetTreasurer,
  initialVoucherId
}: VouchersSectionProps) {
  const navigate = useNavigate();
  const [recordedByOpen, setRecordedByOpen] = useState(false);
  const [sessionFormOpen, setSessionFormOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeFlow, setActiveFlow] = useState<VoucherType | null>(null);
  const [detailVoucher, setDetailVoucher] = useState<Voucher | null>(null);

  const vouchers = useLiveQuery(
    () =>
      db.vouchers
        .where("eventId")
        .equals(eventId)
        .filter((v) => !v.deleted)
        .toArray(),
    [eventId]
  );

  useEffect(() => {
    if (!initialVoucherId || !vouchers) return;
    const target = vouchers.find((v) => v.id === initialVoucherId);
    if (target) setDetailVoucher(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVoucherId, vouchers === undefined]);

  const sorted = useMemo(() => (vouchers ?? []).slice().sort((a, b) => b.number - a.number), [vouchers]);

  const lastPayerId = useMemo(() => {
    const lastExpense = (vouchers ?? [])
      .filter((v) => v.type === "expense" && v.payers.length === 1)
      .sort((a, b) => b.number - a.number)[0];
    return lastExpense?.payers[0]?.personId ?? null;
  }, [vouchers]);

  function handleTypeSelect(type: VoucherType) {
    setMenuOpen(false);
    setActiveFlow(type);
  }

  function handleSaved() {
    setActiveFlow(null);
  }

  return (
    <div>
      <div className="screen-header">
        <h2 className="section-title" style={{ margin: 0 }}>
          اسناد
        </h2>
        {!eventClosed && (
          <button type="button" className="icon-button" onClick={() => setRecordedByOpen(true)} aria-label="سند جدید">
            +
          </button>
        )}
      </div>

      {sorted.length === 0 && <EmptyState hint="هنوز سندی ثبت نشده است." />}

      <ul className="list">
        {sorted.map((voucher) => {
          const TypeIcon = TYPE_ICONS[voucher.type];
          return (
          <li key={voucher.id} className="list-item" onClick={() => setDetailVoucher(voucher)}>
            <span className={`voucher-row__icon voucher-row__icon--${voucher.type}`}>
              <TypeIcon width={18} height={18} />
            </span>
            <div className="list-item__main">
              <span className="list-item__title">
                #{toPersianDigits(voucher.number)} · {TYPE_LABELS[voucher.type]} · {voucher.description || "بدون توضیح"}
              </span>
              <span className="list-item__subtitle">
                <JalaliDate date={new Date(`${voucher.expenseDate}T00:00:00`)} />
              </span>
            </div>
            <div className="list-item__meta">
              {voucher.splitMode === "itemized" && <span className="badge">سفارش گروهی</span>}
              <span className="voucher-row__amount">
                {formatAmount(voucher.totalAmount)} {currency}
              </span>
            </div>
          </li>
          );
        })}
      </ul>

      <RecordedByMenuSheet
        open={recordedByOpen}
        onClose={() => setRecordedByOpen(false)}
        onSelectGroupOrder={() => {
          setRecordedByOpen(false);
          setSessionFormOpen(true);
        }}
        onSelectTreasurer={() => {
          setRecordedByOpen(false);
          setMenuOpen(true);
        }}
      />

      <SessionFormSheet
        open={sessionFormOpen}
        eventId={eventId}
        treasurerPersonId={treasurerPersonId}
        treasurerName={treasurerName}
        onClose={() => setSessionFormOpen(false)}
        onRequestSetTreasurer={
          onRequestSetTreasurer
            ? () => {
                setSessionFormOpen(false);
                onRequestSetTreasurer();
              }
            : undefined
        }
        onCreated={(id) => {
          setSessionFormOpen(false);
          navigate(`/events/${eventId}/orders/${id}`);
        }}
      />

      <NewVoucherMenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} onSelect={handleTypeSelect} />

      <ExpenseWizardSheet
        open={activeFlow === "expense"}
        eventId={eventId}
        activeMembers={activeMembers}
        lastPayerId={lastPayerId}
        onClose={() => setActiveFlow(null)}
        onSaved={handleSaved}
      />

      <TransferFormSheet
        open={activeFlow === "contribution"}
        type="contribution"
        eventId={eventId}
        members={activeMembers}
        treasurerPersonId={treasurerPersonId}
        treasurerName={treasurerName}
        onClose={() => setActiveFlow(null)}
        onSaved={handleSaved}
      />

      <TransferFormSheet
        open={activeFlow === "settlement"}
        type="settlement"
        eventId={eventId}
        members={activeMembers}
        onClose={() => setActiveFlow(null)}
        onSaved={handleSaved}
      />

      <VoucherDetailSheet voucher={detailVoucher} members={activeMembers} currency={currency} onClose={() => setDetailVoucher(null)} />
    </div>
  );
}
