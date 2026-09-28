import { useEffect, useState } from "react";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { AmountInput } from "@/ui/components/AmountInput";
import { EmptyState } from "@/ui/components/EmptyState";
import { amountsSumTo, percentsSumTo100, sharesFromExactAmounts, splitByWeight } from "@/domain/splitEngine";
import { formatAmount } from "@/domain/format";
import { vouchersRepository, type ExpenseSplit } from "@/data/repositories/vouchersRepository";
import type { VoucherPayer } from "@/data/types";

interface MemberOption {
  personId: string;
  name: string;
}

interface ExpenseWizardSheetProps {
  open: boolean;
  eventId: string;
  activeMembers: MemberOption[];
  /** Default payer suggestion — the last payer recorded in this event, if any. */
  lastPayerId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

type Step =
  | "amount"
  | "payer"
  | "payer_multi"
  | "description"
  | "equal_all_q"
  | "participants"
  | "equal_selected_q"
  | "custom_split"
  | "summary";

type CustomMode = "weight" | "percent" | "exact";

const CUSTOM_MODE_LABELS: Record<CustomMode, string> = { weight: "ضریب", percent: "درصد", exact: "مبلغ" };

function nameOf(members: MemberOption[], personId: string): string {
  return members.find((m) => m.personId === personId)?.name ?? "؟";
}

export function ExpenseWizardSheet({ open, eventId, activeMembers, lastPayerId, onClose, onSaved }: ExpenseWizardSheetProps) {
  const [history, setHistory] = useState<Step[]>([]);
  const [step, setStep] = useState<Step>("amount");
  const [amount, setAmount] = useState(0);
  const [payerMode, setPayerMode] = useState<"single" | "multi">("single");
  const [singlePayerId, setSinglePayerId] = useState<string | null>(null);
  const [multiPayers, setMultiPayers] = useState<Record<string, number>>({});
  const [description, setDescription] = useState("");
  const [participantIds, setParticipantIds] = useState<Set<string>>(new Set());
  const [customMode, setCustomMode] = useState<CustomMode>("weight");
  const [customValues, setCustomValues] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setHistory([]);
    setStep("amount");
    setAmount(0);
    setPayerMode("single");
    setSinglePayerId(lastPayerId ?? null);
    setMultiPayers({});
    setDescription("");
    setParticipantIds(new Set(activeMembers.map((m) => m.personId)));
    setCustomMode("weight");
    setCustomValues({});
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  function getPayers(): VoucherPayer[] {
    if (payerMode === "single") {
      return singlePayerId ? [{ personId: singlePayerId, amount }] : [];
    }
    return Object.entries(multiPayers)
      .filter(([, value]) => value > 0)
      .map(([personId, value]) => ({ personId, amount: value }));
  }

  const participantList = activeMembers.filter((m) => participantIds.has(m.personId));

  function previewShares(): { personId: string; share: number }[] {
    if (customMode === "weight") {
      return splitByWeight(
        amount,
        participantList.map((m) => ({ personId: m.personId, weight: customValues[m.personId] ?? 0 }))
      );
    }
    if (customMode === "percent") {
      return splitByWeight(
        amount,
        participantList.map((m) => ({ personId: m.personId, weight: customValues[m.personId] ?? 0 }))
      );
    }
    return sharesFromExactAmounts(participantList.map((m) => ({ personId: m.personId, amount: customValues[m.personId] ?? 0 })));
  }

  function customValuesValid(): boolean {
    const values = participantList.map((m) => customValues[m.personId] ?? 0);
    if (customMode === "weight") return values.some((v) => v > 0) && values.every((v) => v >= 0);
    if (customMode === "percent") return percentsSumTo100(values);
    return amountsSumTo(amount, values);
  }

  async function saveEqualAll() {
    setSaving(true);
    setError(null);
    try {
      await vouchersRepository.createExpense({
        eventId,
        expenseDate: new Date().toISOString().slice(0, 10),
        description,
        totalAmount: amount,
        payers: getPayers(),
        split: { mode: "equal_all" }
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    } finally {
      setSaving(false);
    }
  }

  async function saveEqualSelected() {
    setSaving(true);
    setError(null);
    try {
      await vouchersRepository.createExpense({
        eventId,
        expenseDate: new Date().toISOString().slice(0, 10),
        description,
        totalAmount: amount,
        payers: getPayers(),
        split: { mode: "equal_selected", participantPersonIds: Array.from(participantIds) }
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    } finally {
      setSaving(false);
    }
  }

  async function saveCustom() {
    setSaving(true);
    setError(null);
    try {
      let split: ExpenseSplit;
      if (customMode === "weight") {
        split = { mode: "weight", weights: participantList.map((m) => ({ personId: m.personId, weight: customValues[m.personId] ?? 0 })) };
      } else if (customMode === "percent") {
        split = { mode: "percent", percents: participantList.map((m) => ({ personId: m.personId, percent: customValues[m.personId] ?? 0 })) };
      } else {
        split = { mode: "exact", amounts: participantList.map((m) => ({ personId: m.personId, amount: customValues[m.personId] ?? 0 })) };
      }
      await vouchersRepository.createExpense({
        eventId,
        expenseDate: new Date().toISOString().slice(0, 10),
        description,
        totalAmount: amount,
        payers: getPayers(),
        split
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    } finally {
      setSaving(false);
    }
  }

  const multiPayersSum = Object.values(multiPayers).reduce((sum, v) => sum + v, 0);

  return (
    <BottomSheet open={open} title="هزینه جدید" onClose={onClose}>
      <div className="wizard-step">
        {history.length > 0 && (
          <button type="button" className="back-link" onClick={goBack}>
            ← مرحله قبل
          </button>
        )}

        {step === "amount" && (
          <>
            <AmountInput value={amount} onChange={setAmount} large autoFocus />
            <div className="wizard-step__actions">
              <button type="button" className="wizard-step__actions--primary" disabled={amount <= 0} onClick={() => goTo("payer")}>
                ادامه
              </button>
            </div>
          </>
        )}

        {step === "payer" && (
          <>
            {activeMembers.length === 0 ? (
              <EmptyState hint="این ایونت عضو فعالی ندارد." />
            ) : (
              <ul className="list">
                {activeMembers.map((member) => (
                  <li
                    key={member.personId}
                    className="list-item"
                    onClick={() => {
                      setSinglePayerId(member.personId);
                      setPayerMode("single");
                      goTo("description");
                    }}
                  >
                    <div className="list-item__main">
                      <span className="list-item__title">{member.name}</span>
                    </div>
                    {member.personId === lastPayerId && <span className="badge">آخرین پرداخت‌کننده</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="wizard-step__actions">
              <button
                type="button"
                onClick={() => {
                  setPayerMode("multi");
                  goTo("payer_multi");
                }}
              >
                چند پرداخت‌کننده
              </button>
            </div>
          </>
        )}

        {step === "payer_multi" && (
          <>
            <p className="field__hint">
              مجموع باید برابر {formatAmount(amount)} باشد. مجموع فعلی: {formatAmount(multiPayersSum)}
            </p>
            <ul className="checklist">
              {activeMembers.map((member) => (
                <li key={member.personId} className="split-row">
                  <span className="split-row__name">{member.name}</span>
                  <AmountInput
                    value={multiPayers[member.personId] ?? 0}
                    onChange={(value) => setMultiPayers((prev) => ({ ...prev, [member.personId]: value }))}
                  />
                </li>
              ))}
            </ul>
            <div className="wizard-step__actions">
              <button
                type="button"
                className="wizard-step__actions--primary"
                disabled={multiPayersSum !== amount || multiPayersSum === 0}
                onClick={() => goTo("description")}
              >
                ادامه
              </button>
            </div>
          </>
        )}

        {step === "description" && (
          <>
            <div className="field">
              <label htmlFor="expense-description">بابت</label>
              <input
                id="expense-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                autoFocus
              />
            </div>
            <div className="wizard-step__actions">
              <button type="button" className="wizard-step__actions--primary" onClick={() => goTo("equal_all_q")}>
                ادامه
              </button>
            </div>
          </>
        )}

        {step === "equal_all_q" && (
          <>
            <p className="wizard-step__question">سهم همه برابر است؟</p>
            {error && <p className="field__error">{error}</p>}
            <div className="wizard-step__actions">
              <button type="button" disabled={saving} onClick={() => goTo("participants")}>
                خیر
              </button>
              <button type="button" className="wizard-step__actions--primary" disabled={saving} onClick={saveEqualAll}>
                بله، ذخیره کن
              </button>
            </div>
          </>
        )}

        {step === "participants" && (
          <>
            <p className="field__hint">افراد بدون سهم را از لیست خارج کنید.</p>
            <ul className="checklist">
              {activeMembers.map((member) => (
                <li key={member.personId} className="checklist-item">
                  <input
                    type="checkbox"
                    id={`wizard-participant-${member.personId}`}
                    checked={participantIds.has(member.personId)}
                    onChange={() =>
                      setParticipantIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(member.personId)) next.delete(member.personId);
                        else next.add(member.personId);
                        return next;
                      })
                    }
                  />
                  <label htmlFor={`wizard-participant-${member.personId}`}>{member.name}</label>
                </li>
              ))}
            </ul>
            <div className="wizard-step__actions">
              <button
                type="button"
                className="wizard-step__actions--primary"
                disabled={participantIds.size === 0}
                onClick={() => goTo("equal_selected_q")}
              >
                ادامه
              </button>
            </div>
          </>
        )}

        {step === "equal_selected_q" && (
          <>
            <p className="wizard-step__question">بین باقی‌مانده‌ها برابر است؟</p>
            {error && <p className="field__error">{error}</p>}
            <div className="wizard-step__actions">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setCustomValues({});
                  goTo("custom_split");
                }}
              >
                خیر
              </button>
              <button type="button" className="wizard-step__actions--primary" disabled={saving} onClick={saveEqualSelected}>
                بله، ذخیره کن
              </button>
            </div>
          </>
        )}

        {step === "custom_split" && (
          <>
            <div className="split-mode-tabs">
              {(Object.keys(CUSTOM_MODE_LABELS) as CustomMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={mode === customMode ? "split-mode-tabs__tab--active" : ""}
                  onClick={() => setCustomMode(mode)}
                >
                  {CUSTOM_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
            <ul className="checklist">
              {participantList.map((member) => (
                <li key={member.personId} className="split-row">
                  <span className="split-row__name">{member.name}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    value={customValues[member.personId] ?? ""}
                    onChange={(event) => {
                      const raw = Number(event.target.value.replace(/[^\d.]/g, ""));
                      setCustomValues((prev) => ({ ...prev, [member.personId]: Number.isFinite(raw) ? raw : 0 }));
                    }}
                  />
                </li>
              ))}
            </ul>
            {customMode === "percent" && (
              <p className="field__hint">مجموع درصدها باید ۱۰۰ باشد.</p>
            )}
            {customMode === "exact" && <p className="field__hint">مجموع مبالغ باید برابر {formatAmount(amount)} باشد.</p>}
            <div className="wizard-step__actions">
              <button
                type="button"
                className="wizard-step__actions--primary"
                disabled={!customValuesValid()}
                onClick={() => goTo("summary")}
              >
                ادامه
              </button>
            </div>
          </>
        )}

        {step === "summary" && (
          <>
            <p className="field__hint">قبل از ذخیره، سهم هر نفر را بررسی کنید.</p>
            <div className="split-summary">
              {previewShares().map((s) => (
                <div className="split-summary__row" key={s.personId}>
                  <span>{nameOf(activeMembers, s.personId)}</span>
                  <span>{formatAmount(s.share)}</span>
                </div>
              ))}
              <div className="split-summary__total">
                <span>جمع کل</span>
                <span>{formatAmount(amount)}</span>
              </div>
            </div>
            {error && <p className="field__error">{error}</p>}
            <div className="wizard-step__actions">
              <button type="button" className="wizard-step__actions--primary" disabled={saving} onClick={saveCustom}>
                تأیید و ذخیره
              </button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
