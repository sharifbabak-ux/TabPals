import { useEffect, useState } from "react";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { AmountInput } from "@/ui/components/AmountInput";
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
  onClose: () => void;
  onSaved: () => void;
}

const TITLES: Record<TransferFormSheetProps["type"], { title: string; fromLabel: string; toLabel: string }> = {
  contribution: { title: "واریز به خزانه‌دار", fromLabel: "از طرف", toLabel: "خزانه‌دار (دریافت‌کننده)" },
  settlement: { title: "پرداخت تسویه", fromLabel: "پرداخت‌کننده", toLabel: "دریافت‌کننده" }
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TransferFormSheet({ open, type, eventId, members, onClose, onSaved }: TransferFormSheetProps) {
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

  const { title, fromLabel, toLabel } = TITLES[type];
  const valid = amount > 0 && fromPersonId !== "" && toPersonId !== "" && fromPersonId !== toPersonId;

  async function handleSubmit() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const input = { eventId, expenseDate, description, totalAmount: amount, fromPersonId, toPersonId };
      if (type === "contribution") await vouchersRepository.createContribution(input);
      else await vouchersRepository.createSettlement(input);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
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
      <div className="field">
        <label htmlFor="transfer-to">{toLabel}</label>
        <select id="transfer-to" value={toPersonId} onChange={(event) => setToPersonId(event.target.value)}>
          <option value="">انتخاب کنید</option>
          {members.map((m) => (
            <option key={m.personId} value={m.personId}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="transfer-date">تاریخ</label>
        <input id="transfer-date" type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} />
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
