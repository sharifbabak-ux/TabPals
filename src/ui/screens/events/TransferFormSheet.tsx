import { useEffect, useState } from "react";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { AmountInput } from "@/ui/components/AmountInput";
import { JalaliDatePicker } from "@/ui/components/JalaliDatePicker";
import { vouchersRepository } from "@/data/repositories/vouchersRepository";

interface MemberOption {
  personId: string;
  name: string;
}

interface TransferFormSheetProps {
  open: boolean;
  type: "contribution" | "settlement";
  eventId: string;
  members: MemberOption[];
  /** Only used for type="contribution" — the recipient is always the treasurer, never chosen here. */
  treasurerPersonId?: string | null;
  treasurerName?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const TITLES: Record<TransferFormSheetProps["type"], { title: string; guidance: string; fromLabel: string }> = {
  contribution: {
    title: "واریز به خزانه‌دار",
    guidance: "مشخص کنید چه کسی و چه مبلغی به خزانه‌دار واریز کرده است.",
    fromLabel: "از طرف"
  },
  settlement: {
    title: "پرداخت تسویه",
    guidance: "مشخص کنید چه کسی به چه کسی و چه مبلغی تسویه کرده است.",
    fromLabel: "پرداخت‌کننده"
  }
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TransferFormSheet({ open, type, eventId, members, treasurerPersonId, treasurerName, onClose, onSaved }: TransferFormSheetProps) {
  const [fromPersonId, setFromPersonId] = useState("");
  const [toPersonId, setToPersonId] = useState("");
  const [amount, setAmount] = useState(0);
  const [expenseDate, setExpenseDate] = useState(today());
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFromPersonId("");
      setToPersonId("");
      setAmount(0);
      setExpenseDate(today());
      setDescription("");
      setError(null);
    }
  }, [open]);

  const { title, guidance, fromLabel } = TITLES[type];
  const isContribution = type === "contribution";
  const missingTreasurer = isContribution && !treasurerPersonId;
  const valid =
    amount > 0 &&
    fromPersonId !== "" &&
    !missingTreasurer &&
    (isContribution ? fromPersonId !== treasurerPersonId : toPersonId !== "" && fromPersonId !== toPersonId);

  async function handleSubmit() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (isContribution) {
        await vouchersRepository.createContribution({ eventId, expenseDate, description, totalAmount: amount, fromPersonId });
      } else {
        await vouchersRepository.createSettlement({ eventId, expenseDate, description, totalAmount: amount, fromPersonId, toPersonId });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      <p className="wizard-step__guidance">{guidance}</p>

      {missingTreasurer && <p className="field__error">برای این ایونت مسئول صندوق تعیین نشده است. ابتدا از ویرایش ایونت مسئول صندوق را مشخص کنید.</p>}

      <div className="field">
        <label htmlFor="transfer-amount">مبلغ</label>
        <AmountInput id="transfer-amount" value={amount} onChange={setAmount} />
      </div>
      <div className="field">
        <label htmlFor="transfer-from">{fromLabel}</label>
        <select id="transfer-from" value={fromPersonId} onChange={(event) => setFromPersonId(event.target.value)}>
          <option value="">انتخاب کنید</option>
          {members.map((m) => (
            <option key={m.personId} value={m.personId}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      {isContribution ? (
        <div className="field">
          <label>خزانه‌دار (دریافت‌کننده)</label>
          <input value={treasurerName ?? "—"} disabled />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="transfer-to">دریافت‌کننده</label>
          <select id="transfer-to" value={toPersonId} onChange={(event) => setToPersonId(event.target.value)}>
            <option value="">انتخاب کنید</option>
            {members.map((m) => (
              <option key={m.personId} value={m.personId}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="transfer-date">تاریخ</label>
        <JalaliDatePicker id="transfer-date" value={expenseDate} onChange={setExpenseDate} />
      </div>
      <div className="field">
        <label htmlFor="transfer-description">توضیحات (اختیاری)</label>
        <input id="transfer-description" value={description} onChange={(event) => setDescription(event.target.value)} />
      </div>
      {error && <p className="field__error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="form-actions__secondary" onClick={onClose}>
          انصراف
        </button>
        <button type="button" className="form-actions__primary" disabled={!valid || saving} onClick={handleSubmit}>
          ذخیره
        </button>
      </div>
    </BottomSheet>
  );
}
