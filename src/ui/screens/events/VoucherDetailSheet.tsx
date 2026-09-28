import { BottomSheet } from "@/ui/components/BottomSheet";
import { formatAmount, formatJalaliDate, formatJalaliDateTime, toPersianDigits } from "@/domain/format";
import type { Voucher } from "@/data/types";

interface MemberOption {
  personId: string;
  name: string;
}

interface VoucherDetailSheetProps {
  voucher: Voucher | null;
  members: MemberOption[];
  currencyLabel: string;
  onClose: () => void;
}

const TYPE_LABELS: Record<Voucher["type"], string> = {
  expense: "هزینه",
  contribution: "واریز به خزانه‌دار",
  settlement: "تسویه"
};

function nameOf(members: MemberOption[], personId: string): string {
  return members.find((m) => m.personId === personId)?.name ?? "؟";
}

export function VoucherDetailSheet({ voucher, members, currencyLabel, onClose }: VoucherDetailSheetProps) {
  if (!voucher) return null;

  return (
    <BottomSheet open={voucher !== null} title={`سند شماره ${toPersianDigits(voucher.number)}`} onClose={onClose}>
      <div className="voucher-detail__field">
        <span>نوع سند</span>
        <span>{TYPE_LABELS[voucher.type]}</span>
      </div>
      <div className="voucher-detail__field">
        <span>تاریخ ثبت</span>
        <span>{formatJalaliDateTime(new Date(voucher.recordedAt))}</span>
      </div>
      <div className="voucher-detail__field">
        <span>تاریخ هزینه</span>
        <span>{formatJalaliDate(new Date(`${voucher.expenseDate}T00:00:00`))}</span>
      </div>
      <div className="voucher-detail__field">
        <span>توضیحات</span>
        <span>{voucher.description || "—"}</span>
      </div>
      <div className="voucher-detail__field">
        <span>مبلغ کل</span>
        <span>
          {formatAmount(voucher.totalAmount)} {currencyLabel}
        </span>
      </div>

      {voucher.type === "expense" ? (
        <>
          <h3 className="section-title">پرداخت‌کنندگان</h3>
          {voucher.payers.map((payer) => (
            <div className="voucher-detail__field" key={payer.personId}>
              <span>{nameOf(members, payer.personId)}</span>
              <span>{formatAmount(payer.amount)}</span>
            </div>
          ))}

          <h3 className="section-title">سهم افراد</h3>
          {voucher.shares.map((share) => (
            <div className="voucher-detail__field" key={share.personId}>
              <span>{nameOf(members, share.personId)}</span>
              <span>{formatAmount(share.share)}</span>
            </div>
          ))}
        </>
      ) : (
        <>
          <div className="voucher-detail__field">
            <span>از طرف</span>
            <span>{voucher.fromPersonId ? nameOf(members, voucher.fromPersonId) : "—"}</span>
          </div>
          <div className="voucher-detail__field">
            <span>به</span>
            <span>{voucher.toPersonId ? nameOf(members, voucher.toPersonId) : "—"}</span>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
