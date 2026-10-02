import { useNavigate } from "react-router-dom";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { formatAmount, toPersianDigits } from "@/domain/format";
import { formatItemizedItem } from "@/domain/groupOrder";
import type { Voucher } from "@/data/types";

interface MemberOption {
  personId: string;
  name: string;
}

interface VoucherDetailSheetProps {
  voucher: Voucher | null;
  members: MemberOption[];
  currency: string;
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

export function VoucherDetailSheet({ voucher, members, currency, onClose }: VoucherDetailSheetProps) {
  const navigate = useNavigate();
  if (!voucher) return null;
  const itemized = voucher.itemizedSnapshot;

  return (
    <BottomSheet open={voucher !== null} title={`سند شماره ${toPersianDigits(voucher.number)}`} onClose={onClose}>
      <div className="voucher-detail__field">
        <span>نوع سند</span>
        <span>{TYPE_LABELS[voucher.type]}</span>
      </div>
      <div className="voucher-detail__field">
        <span>تاریخ ثبت</span>
        <span>
          <JalaliDate date={new Date(voucher.recordedAt)} weekday time />
        </span>
      </div>
      <div className="voucher-detail__field">
        <span>تاریخ هزینه</span>
        <span>
          <JalaliDate date={new Date(`${voucher.expenseDate}T00:00:00`)} />
        </span>
      </div>
      {itemized && (
        <div className="voucher-detail__field">
          <span>از سفارش گروهی</span>
          <span>
            <button type="button" className="list-item__action" onClick={() => navigate(`/events/${voucher.eventId}/orders/${itemized.sessionId}`)}>
              {itemized.sessionTitle}
              {itemized.restaurant ? ` – ${itemized.restaurant}` : ""} ←
            </button>
          </span>
        </div>
      )}
      <div className="voucher-detail__field">
        <span>توضیحات</span>
        <span>{voucher.description || "—"}</span>
      </div>
      <div className="voucher-detail__field">
        <span>مبلغ کل</span>
        <span>
          {formatAmount(voucher.totalAmount)} {currency}
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

          {itemized && (
            <>
              <h3 className="section-title">ریز سفارش هر نفر</h3>
              {itemized.people.map((person) => (
                <div className="itemized-person" key={person.personId}>
                  <strong>{nameOf(members, person.personId)}</strong>
                  <ul>
                    {person.personTotal !== null ? (
                      <li>جمع سفارش: {formatAmount(person.personTotal)}</li>
                    ) : (
                      person.items.map((item, i) => (
                        <li key={i}>
                          {formatItemizedItem(item)}
                          {item.unitPrice !== null ? ` = ${formatAmount(item.amount)}` : ""}
                        </li>
                      ))
                    )}
                    {person.sharedItems.map((item, i) => (
                      <li key={`s${i}`}>
                        سهم از {item.name} مشترک: {formatAmount(item.amount)}
                      </li>
                    ))}
                    {person.extras
                      .filter((e) => e.share !== 0)
                      .map((e) => (
                        <li key={e.extraId}>
                          سهم {e.label}: {formatAmount(e.share)}
                        </li>
                      ))}
                  </ul>
                  <div className="voucher-detail__field">
                    <span>مبلغ نهایی</span>
                    <strong>{formatAmount(person.finalTotal)}</strong>
                  </div>
                </div>
              ))}
            </>
          )}
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
