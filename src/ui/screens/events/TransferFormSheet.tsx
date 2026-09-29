import { useEffect, useState } from "react";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { AmountInput } from "@/ui/components/AmountInput";
import { JalaliDatePicker } from "@/ui/components/JalaliDatePicker";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { formatAmount } from "@/domain/format";
import { useWizardBackTrap } from "@/ui/hooks/useWizardBackTrap";
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

type Step = "amount" | "parties" | "description" | "date" | "summary";

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

const STEP_GUIDANCE: Record<Step, string> = {
  amount: "مبلغ را وارد کنید",
  parties: "طرفین را مشخص کنید",
  description: "توضیح کوتاهی بنویسید (اختیاری)",
  date: "تاریخ را مشخص کنید",
  summary: "قبل از ذخیره، اطلاعات را بررسی کنید"
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function nameOf(members: MemberOption[], personId: string): string {
  return members.find((m) => m.personId === personId)?.name ?? "؟";
}

export function TransferFormSheet({ open, type, eventId, members, treasurerPersonId, treasurerName, onClose, onSaved }: TransferFormSheetProps) {
  const [history, setHistory] = useState<Step[]>([]);
  const [step, setStep] = useState<Step>("amount");
  const [editingFromSummary, setEditingFromSummary] = useState(false);
  const [fromPersonId, setFromPersonId] = useState("");
  const [toPersonId, setToPersonId] = useState("");
  const [amount, setAmount] = useState(0);
  const [expenseDate, setExpenseDate] = useState(today());
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setHistory([]);
      setStep("amount");
      setEditingFromSummary(false);
      setFromPersonId("");
      setToPersonId("");
      setAmount(0);
      setExpenseDate(today());
      setDescription("");
      setError(null);
      setConfirmCancelOpen(false);
    }
  }, [open]);

  const { title, guidance, fromLabel } = TITLES[type];
  const isContribution = type === "contribution";
  const missingTreasurer = isContribution && !treasurerPersonId;
  const partiesValid = fromPersonId !== "" && !missingTreasurer && (isContribution ? fromPersonId !== treasurerPersonId : toPersonId !== "" && fromPersonId !== toPersonId);
  const hasEnteredData = amount > 0 || fromPersonId !== "" || toPersonId !== "" || description.trim() !== "";

  function goTo(next: Step) {
    setHistory((prev) => [...prev, step]);
    setError(null);
    setStep(next);
  }

  function goBack() {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const copy = [...prev];
      const previous = copy.pop()!;
      setStep(previous);
      return copy;
    });
    setError(null);
  }

  function continueTo(normalNext: Step) {
    if (editingFromSummary) {
      setEditingFromSummary(false);
      goTo("summary");
    } else {
      goTo(normalNext);
    }
  }

  useWizardBackTrap(open, () => {
    if (history.length > 0) goBack();
  });

  function requestClose() {
    if (hasEnteredData) setConfirmCancelOpen(true);
    else onClose();
  }

  async function handleFinalSave() {
    if (!partiesValid || saving) return;
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
    <>
      <BottomSheet open={open} title={title} onClose={requestClose}>
        <div className="wizard-step">
          {history.length > 0 && (
            <button type="button" className="back-link" onClick={goBack}>
              ← بازگشت
            </button>
          )}
          <p className="wizard-step__guidance">{step === "amount" ? guidance : STEP_GUIDANCE[step]}</p>

          {missingTreasurer && <p className="field__error">برای این ایونت مسئول صندوق تعیین نشده است. ابتدا از ویرایش ایونت مسئول صندوق را مشخص کنید.</p>}

          {step === "amount" && (
            <>
              <AmountInput value={amount} onChange={setAmount} large autoFocus />
              <div className="wizard-step__actions">
                <button type="button" className="wizard-step__actions--primary" disabled={amount <= 0} onClick={() => continueTo("parties")}>
                  ادامه
                </button>
              </div>
            </>
          )}

          {step === "parties" && (
            <>
              <div className="field">
                <label htmlFor="transfer-from">{fromLabel}</label>
                <select id="transfer-from" value={fromPersonId} onChange={(event) => setFromPersonId(event.target.value)} autoFocus>
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
              <div className="wizard-step__actions">
                <button type="button" className="wizard-step__actions--primary" disabled={!partiesValid} onClick={() => continueTo("description")}>
                  ادامه
                </button>
              </div>
            </>
          )}

          {step === "description" && (
            <>
              <div className="field">
                <label htmlFor="transfer-description">توضیحات (اختیاری)</label>
                <input id="transfer-description" value={description} onChange={(event) => setDescription(event.target.value)} autoFocus />
              </div>
              <div className="wizard-step__actions">
                <button type="button" className="wizard-step__actions--primary" onClick={() => continueTo("date")}>
                  ادامه
                </button>
              </div>
            </>
          )}

          {step === "date" && (
            <>
              <div className="field">
                <label htmlFor="transfer-date">تاریخ</label>
                <JalaliDatePicker id="transfer-date" value={expenseDate} onChange={setExpenseDate} />
              </div>
              <div className="wizard-step__actions">
                <button
                  type="button"
                  className="wizard-step__actions--primary"
                  onClick={() => {
                    setEditingFromSummary(false);
                    goTo("summary");
                  }}
                >
                  ادامه
                </button>
              </div>
            </>
          )}

          {step === "summary" && (
            <>
              <div className="wizard-summary">
                <div className="wizard-summary__row">
                  <div>
                    <span className="wizard-summary__label">مبلغ</span>
                    <span className="wizard-summary__value">{formatAmount(amount)}</span>
                  </div>
                  <button type="button" className="list-item__action" onClick={() => { setEditingFromSummary(true); goTo("amount"); }}>
                    ویرایش
                  </button>
                </div>
                <div className="wizard-summary__row">
                  <div>
                    <span className="wizard-summary__label">پرداخت‌کننده</span>
                    <span className="wizard-summary__value">
                      {nameOf(members, fromPersonId)} ← {isContribution ? treasurerName ?? "—" : nameOf(members, toPersonId)}
                    </span>
                  </div>
                  <button type="button" className="list-item__action" onClick={() => { setEditingFromSummary(true); goTo("parties"); }}>
                    ویرایش
                  </button>
                </div>
                <div className="wizard-summary__row">
                  <div>
                    <span className="wizard-summary__label">شرح</span>
                    <span className="wizard-summary__value">{description || "—"}</span>
                  </div>
                  <button type="button" className="list-item__action" onClick={() => { setEditingFromSummary(true); goTo("description"); }}>
                    ویرایش
                  </button>
                </div>
                <div className="wizard-summary__row">
                  <div>
                    <span className="wizard-summary__label">تاریخ</span>
                    <span className="wizard-summary__value">
                      <JalaliDate date={new Date(`${expenseDate}T00:00:00`)} />
                    </span>
                  </div>
                  <button type="button" className="list-item__action" onClick={() => { setEditingFromSummary(true); goTo("date"); }}>
                    ویرایش
                  </button>
                </div>
              </div>

              {error && <p className="field__error">{error}</p>}
              <div className="wizard-step__actions">
                <button type="button" className="wizard-step__actions--primary" disabled={!partiesValid || saving} onClick={handleFinalSave}>
                  تأیید و ذخیره
                </button>
              </div>
            </>
          )}
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={confirmCancelOpen}
        title="انصراف"
        message="اطلاعات وارد‌شده حذف خواهد شد. مطمئن هستید؟"
        confirmLabel="بله، انصراف"
        danger
        onConfirm={() => {
          setConfirmCancelOpen(false);
          onClose();
        }}
        onCancel={() => setConfirmCancelOpen(false)}
      />
    </>
  );
}
