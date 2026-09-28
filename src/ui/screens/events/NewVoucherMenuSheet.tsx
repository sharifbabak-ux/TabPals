import { BottomSheet } from "@/ui/components/BottomSheet";
import type { VoucherType } from "@/data/types";

interface NewVoucherMenuSheetProps {
  open: boolean;
  onClose: () => void;
  onSelect: (type: VoucherType) => void;
}

const OPTIONS: { type: VoucherType; label: string; hint: string }[] = [
  { type: "expense", label: "هزینه", hint: "ثبت یک هزینه و تقسیم آن بین اعضا" },
  { type: "contribution", label: "واریز به خزانه‌دار", hint: "یکی از اعضا به خزانه‌دار پول می‌دهد" },
  { type: "settlement", label: "تسویه", hint: "یک نفر مستقیم به نفر دیگر پول می‌دهد" }
];

/** Sent to the اسناد tab's + button — chooses the voucher type before starting its flow. */
export function NewVoucherMenuSheet({ open, onClose, onSelect }: NewVoucherMenuSheetProps) {
  return (
    <BottomSheet open={open} title="سند جدید" onClose={onClose}>
      <ul className="list">
        {OPTIONS.map((option) => (
          <li key={option.type} className="list-item" onClick={() => onSelect(option.type)}>
            <div className="list-item__main">
              <span className="list-item__title">{option.label}</span>
              <span className="list-item__subtitle">{option.hint}</span>
            </div>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
