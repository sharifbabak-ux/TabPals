import { useEffect, useState } from "react";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { AmountInput } from "@/ui/components/AmountInput";
import { JalaliDatePicker } from "@/ui/components/JalaliDatePicker";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { EmptyState } from "@/ui/components/EmptyState";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { amountsSumTo, percentsSumTo100, sharesFromExactAmounts, splitByWeight, splitEqual } from "@/domain/splitEngine";
import { formatAmount, toPersianDigits } from "@/domain/format";
import { useWizardBackTrap } from "@/ui/hooks/useWizardBackTrap";
import { vouchersRepository, type ExpenseSplit, type PayerSplit } from "@/data/repositories/vouchersRepository";
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
  | "payer_multi_select"
  | "payer_multi_mode"
  | "description"
  | "date"
  | "equal_all_q"
  | "participants"
  | "equal_selected_q"
  | "custom_split"
  | "summary";

type CustomMode = "weight" | "percent" | "exact";

const CUSTOM_MODE_LABELS: Record<CustomMode, string> = { weight: "ضریب", percent: "درصد", exact: "مبلغ" };

const STEP_GUIDANCE: Record<Step, string> = {
  amount: "لطفاً مبلغ هزینه‌ی انجام‌شده را وارد کنید",
  payer: "چه کسی این هزینه را پرداخت کرده؟",
  payer_multi_select: "چه کسانی در پرداخت این هزینه سهیم بودند؟",
  payer_multi_mode: "سهم هر پرداخت‌کننده چقدر است؟",
  description: "شرح کوتاهی از این هزینه بنویسید",
  date: "تاریخ این هزینه را مشخص کنید",
  equal_all_q: "سهم افراد در این هزینه چگونه است؟",
  participants: "سهم افراد در این هزینه چگونه است؟",
  equal_selected_q: "سهم افراد در این هزینه چگونه است؟",
  custom_split: "سهم افراد در این هزینه چگونه است؟",
  summary: "قبل از ذخیره، اطلاعات را بررسی کنید"
};

/** What was chosen for the payer side, kept independent of the final computed amounts so "ویرایش" from the summary can re-open it exactly as left. */
type PayerChoice =
  | { mode: "single"; personId: string | null }
  | { mode: "multi"; payerPersonIds: string[]; splitMode: CustomMode | "equal"; values: Record<string, number> };

/** What was chosen for the participant share split. */
type ShareChoice =
  | { mode: "equal_all" }
  | { mode: "equal_selected"; participantPersonIds: string[] }
  | { mode: CustomMode; participantPersonIds: string[]; values: Record<string, number> };

function nameOf(members: MemberOption[], personId: string): string {
  return members.find((m) => m.personId === personId)?.name ?? "؟";
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ExpenseWizardSheet({ open, eventId, activeMembers, lastPayerId, onClose, onSaved }: ExpenseWizardSheetProps) {
  const [history, setHistory] = useState<Step[]>([]);
  const [step, setStep] = useState<Step>("amount");
  const [editingFromSummary, setEditingFromSummary] = useState(false);
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState("");
  const [expenseDate, setExpenseDate] = useState(today());

  const [payerChoice, setPayerChoice] = useState<PayerChoice>({ mode: "single", personId: null });
  const [multiPayerSelection, setMultiPayerSelection] = useState<Set<string>>(new Set());
  const [multiPayerMode, setMultiPayerMode] = useState<CustomMode | "equal">("equal");
  const [multiPayerValues, setMultiPayerValues] = useState<Record<string, number>>({});

  const [participantIds, setParticipantIds] = useState<Set<string>>(new Set());
  const [customMode, setCustomMode] = useState<CustomMode>("weight");
  const [customValues, setCustomValues] = useState<Record<string, number>>({});
  const [shareChoice, setShareChoice] = useState<ShareChoice>({ mode: "equal_all" });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHistory([]);
    setStep("amount");
    setEditingFromSummary(false);
    setAmount(0);
    setDescription("");
    setExpenseDate(today());
    setPayerChoice({ mode: "single", personId: lastPayerId ?? null });
    setMultiPayerSelection(new Set());
    setMultiPayerMode("equal");
    setMultiPayerValues({});
    setParticipantIds(new Set(activeMembers.map((m) => m.personId)));
    setCustomMode("weight");
    setCustomValues({});
    setShareChoice({ mode: "equal_all" });
    setError(null);
    setConfirmCancelOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const hasEnteredData = amount > 0 || description.trim() !== "" || (payerChoice.mode === "single" && payerChoice.personId !== null && payerChoice.personId !== lastPayerId);

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

  /** From any top-level step, "ادامه" either returns to the summary (when opened via "ویرایش") or proceeds to `normalNext`. */
  function continueTo(normalNext: Step) {
    if (editingFromSummary) {
      setEditingFromSummary(false);
      goTo("summary");
    } else {
      goTo(normalNext);
    }
  }

  function editSection(target: Step) {
    setEditingFromSummary(true);
    goTo(target);
  }

  useWizardBackTrap(open, () => {
    if (history.length > 0) goBack();
  });

  function requestClose() {
    if (hasEnteredData) {
      setConfirmCancelOpen(true);
    } else {
      onClose();
    }
  }

  const participantList = activeMembers.filter((m) => participantIds.has(m.personId));

  function previewShares(): { personId: string; share: number }[] {
    if (shareChoice.mode === "equal_all") return splitEqual(amount, activeMembers.map((m) => m.personId));
    if (shareChoice.mode === "equal_selected") return splitEqual(amount, shareChoice.participantPersonIds);
    if (shareChoice.mode === "exact") {
      return sharesFromExactAmounts(shareChoice.participantPersonIds.map((personId) => ({ personId, amount: shareChoice.values[personId] ?? 0 })));
    }
    return splitByWeight(amount, shareChoice.participantPersonIds.map((personId) => ({ personId, weight: shareChoice.values[personId] ?? 0 })));
  }

  function customValuesValid(): boolean {
    const values = participantList.map((m) => customValues[m.personId] ?? 0);
    if (customMode === "weight") return values.some((v) => v > 0) && values.every((v) => v >= 0);
    if (customMode === "percent") return percentsSumTo100(values);
    return amountsSumTo(amount, values);
  }

  function previewPayers(): { personId: string; amount: number }[] {
    if (payerChoice.mode === "single") return payerChoice.personId ? [{ personId: payerChoice.personId, amount }] : [];
    const { payerPersonIds, splitMode, values } = payerChoice;
    if (splitMode === "equal") return splitEqual(amount, payerPersonIds).map((s) => ({ personId: s.personId, amount: s.share }));
    if (splitMode === "exact") return payerPersonIds.map((personId) => ({ personId, amount: values[personId] ?? 0 }));
    return splitByWeight(amount, payerPersonIds.map((personId) => ({ personId, weight: values[personId] ?? 0 }))).map((s) => ({
      personId: s.personId,
      amount: s.share
    }));
  }

  function multiPayerValuesValid(): boolean {
    if (multiPayerSelection.size === 0) return false;
    const values = Array.from(multiPayerSelection).map((id) => multiPayerValues[id] ?? 0);
    if (multiPayerMode === "equal") return true;
    if (multiPayerMode === "weight") return values.some((v) => v > 0) && values.every((v) => v >= 0);
    if (multiPayerMode === "percent") return percentsSumTo100(values);
    return amountsSumTo(amount, values);
  }

  function buildPayersForSave(): { payers: VoucherPayer[]; payerSplit?: PayerSplit } {
    if (payerChoice.mode === "single") {
      return { payers: payerChoice.personId ? [{ personId: payerChoice.personId, amount }] : [] };
    }
    const { payerPersonIds, splitMode, values } = payerChoice;
    if (splitMode === "equal") return { payers: [], payerSplit: { mode: "equal", payerPersonIds } };
    if (splitMode === "weight") return { payers: [], payerSplit: { mode: "weight", weights: payerPersonIds.map((id) => ({ personId: id, weight: values[id] ?? 0 })) } };
    if (splitMode === "percent") return { payers: [], payerSplit: { mode: "percent", percents: payerPersonIds.map((id) => ({ personId: id, percent: values[id] ?? 0 })) } };
    return { payers: [], payerSplit: { mode: "exact", amounts: payerPersonIds.map((id) => ({ personId: id, amount: values[id] ?? 0 })) } };
  }

  function buildSplitForSave(): ExpenseSplit {
    if (shareChoice.mode === "equal_all") return { mode: "equal_all" };
    if (shareChoice.mode === "equal_selected") return { mode: "equal_selected", participantPersonIds: shareChoice.participantPersonIds };
    if (shareChoice.mode === "weight") {
      return { mode: "weight", weights: shareChoice.participantPersonIds.map((id) => ({ personId: id, weight: shareChoice.values[id] ?? 0 })) };
    }
    if (shareChoice.mode === "percent") {
      return { mode: "percent", percents: shareChoice.participantPersonIds.map((id) => ({ personId: id, percent: shareChoice.values[id] ?? 0 })) };
    }
    return { mode: "exact", amounts: shareChoice.participantPersonIds.map((id) => ({ personId: id, amount: shareChoice.values[id] ?? 0 })) };
  }

  async function handleFinalSave() {
    setSaving(true);
    setError(null);
    try {
      const { payers, payerSplit } = buildPayersForSave();
      await vouchersRepository.createExpense({
        eventId,
        expenseDate,
        description,
        totalAmount: amount,
        payers,
        payerSplit,
        split: buildSplitForSave()
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    } finally {
      setSaving(false);
    }
  }

  const PAYER_MODE_LABELS: Record<CustomMode | "equal", string> = { equal: "مساوی", weight: "ضریبی", percent: "درصدی", exact: "مبلغ مشخص" };

  const payerSummaryText =
    payerChoice.mode === "single"
      ? payerChoice.personId
        ? nameOf(activeMembers, payerChoice.personId)
        : "—"
      : `${toPersianDigits(payerChoice.payerPersonIds.length)} نفر (${PAYER_MODE_LABELS[payerChoice.splitMode]})`;

  const shareSummaryText =
    shareChoice.mode === "equal_all"
      ? "مساوی بین همه"
      : shareChoice.mode === "equal_selected"
        ? `مساوی بین ${toPersianDigits(shareChoice.participantPersonIds.length)} نفر`
        : `${CUSTOM_MODE_LABELS[shareChoice.mode]} بین ${toPersianDigits(shareChoice.participantPersonIds.length)} نفر`;

  return (
    <>
      <BottomSheet open={open} title="هزینه جدید" onClose={requestClose}>
        <div className="wizard-step">
          {history.length > 0 && (
            <button type="button" className="back-link" onClick={goBack}>
              ← بازگشت
            </button>
          )}

          <p className="wizard-step__guidance">{STEP_GUIDANCE[step]}</p>

          {step === "amount" && (
            <>
              <AmountInput value={amount} onChange={setAmount} large autoFocus />
              <div className="wizard-step__actions">
                <button type="button" className="wizard-step__actions--primary" disabled={amount <= 0} onClick={() => continueTo("payer")}>
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
                        setPayerChoice({ mode: "single", personId: member.personId });
                        continueTo("description");
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
                <button type="button" onClick={() => goTo("payer_multi_select")}>
                  چند پرداخت‌کننده
                </button>
              </div>
            </>
          )}

          {step === "payer_multi_select" && (
            <>
              <ul className="checklist">
                {activeMembers.map((member) => (
                  <li key={member.personId} className="checklist-item">
                    <input
                      type="checkbox"
                      id={`wizard-payer-${member.personId}`}
                      checked={multiPayerSelection.has(member.personId)}
                      onChange={() =>
                        setMultiPayerSelection((prev) => {
                          const next = new Set(prev);
                          if (next.has(member.personId)) next.delete(member.personId);
                          else next.add(member.personId);
                          return next;
                        })
                      }
                    />
                    <label htmlFor={`wizard-payer-${member.personId}`}>{member.name}</label>
                  </li>
                ))}
              </ul>
              <div className="wizard-step__actions">
                <button
                  type="button"
                  className="wizard-step__actions--primary"
                  disabled={multiPayerSelection.size === 0}
                  onClick={() => {
                    setMultiPayerValues({});
                    goTo("payer_multi_mode");
                  }}
                >
                  ادامه
                </button>
              </div>
            </>
          )}

          {step === "payer_multi_mode" && (
            <>
              <div className="split-mode-tabs">
                {(["equal", "weight", "percent", "exact"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={mode === multiPayerMode ? "split-mode-tabs__tab--active" : ""}
                    onClick={() => setMultiPayerMode(mode)}
                  >
                    {mode === "equal" ? "مساوی" : CUSTOM_MODE_LABELS[mode]}
                  </button>
                ))}
              </div>
              {multiPayerMode !== "equal" && (
                <ul className="checklist">
                  {Array.from(multiPayerSelection).map((personId) => (
                    <li key={personId} className="split-row">
                      <span className="split-row__name">{nameOf(activeMembers, personId)}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        dir="ltr"
                        value={multiPayerValues[personId] ?? ""}
                        onChange={(event) => {
                          const raw = Number(event.target.value.replace(/[^\d.]/g, ""));
                          setMultiPayerValues((prev) => ({ ...prev, [personId]: Number.isFinite(raw) ? raw : 0 }));
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {multiPayerMode === "percent" && <p className="field__hint">مجموع درصدها باید ۱۰۰ باشد.</p>}
              {multiPayerMode === "exact" && <p className="field__hint">مجموع مبالغ باید برابر {formatAmount(amount)} باشد.</p>}
              {multiPayerMode !== "equal" && (
                <div className="split-summary">
                  {previewPayers().map((p) => (
                    <div className="split-summary__row" key={p.personId}>
                      <span>{nameOf(activeMembers, p.personId)}</span>
                      <span>{formatAmount(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="wizard-step__actions">
                <button
                  type="button"
                  className="wizard-step__actions--primary"
                  disabled={!multiPayerValuesValid()}
                  onClick={() => {
                    setPayerChoice({
                      mode: "multi",
                      payerPersonIds: Array.from(multiPayerSelection),
                      splitMode: multiPayerMode,
                      values: multiPayerValues
                    });
                    continueTo("description");
                  }}
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
                <button type="button" className="wizard-step__actions--primary" onClick={() => continueTo("date")}>
                  ادامه
                </button>
              </div>
            </>
          )}

          {step === "date" && (
            <>
              <div className="field">
                <label htmlFor="expense-date">تاریخ هزینه</label>
                <JalaliDatePicker id="expense-date" value={expenseDate} onChange={setExpenseDate} />
              </div>
              <div className="wizard-step__actions">
                <button type="button" className="wizard-step__actions--primary" onClick={() => continueTo("equal_all_q")}>
                  ادامه
                </button>
              </div>
            </>
          )}

          {step === "equal_all_q" && (
            <>
              <p className="wizard-step__question">سهم همه برابر است؟</p>
              <div className="wizard-step__actions">
                <button type="button" onClick={() => goTo("participants")}>
                  خیر
                </button>
                <button
                  type="button"
                  className="wizard-step__actions--primary"
                  onClick={() => {
                    setShareChoice({ mode: "equal_all" });
                    setEditingFromSummary(false);
                    goTo("summary");
                  }}
                >
                  بله
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
              <div className="wizard-step__actions">
                <button
                  type="button"
                  onClick={() => {
                    setCustomValues({});
                    goTo("custom_split");
                  }}
                >
                  خیر
                </button>
                <button
                  type="button"
                  className="wizard-step__actions--primary"
                  onClick={() => {
                    setShareChoice({ mode: "equal_selected", participantPersonIds: Array.from(participantIds) });
                    setEditingFromSummary(false);
                    goTo("summary");
                  }}
                >
                  بله
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
              {customMode === "percent" && <p className="field__hint">مجموع درصدها باید ۱۰۰ باشد.</p>}
              {customMode === "exact" && <p className="field__hint">مجموع مبالغ باید برابر {formatAmount(amount)} باشد.</p>}
              <div className="wizard-step__actions">
                <button
                  type="button"
                  className="wizard-step__actions--primary"
                  disabled={!customValuesValid()}
                  onClick={() => {
                    setShareChoice({ mode: customMode, participantPersonIds: participantList.map((m) => m.personId), values: customValues });
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
                    <span className="wizard-summary__value">
                      {formatAmount(amount)}
                    </span>
                  </div>
                  <button type="button" className="list-item__action" onClick={() => editSection("amount")}>
                    ویرایش
                  </button>
                </div>
                <div className="wizard-summary__row">
                  <div>
                    <span className="wizard-summary__label">پرداخت‌کننده</span>
                    <span className="wizard-summary__value">{payerSummaryText}</span>
                  </div>
                  <button type="button" className="list-item__action" onClick={() => editSection("payer")}>
                    ویرایش
                  </button>
                </div>
                <div className="wizard-summary__row">
                  <div>
                    <span className="wizard-summary__label">شرح</span>
                    <span className="wizard-summary__value">{description || "—"}</span>
                  </div>
                  <button type="button" className="list-item__action" onClick={() => editSection("description")}>
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
                  <button type="button" className="list-item__action" onClick={() => editSection("date")}>
                    ویرایش
                  </button>
                </div>
                <div className="wizard-summary__row">
                  <div>
                    <span className="wizard-summary__label">تقسیم</span>
                    <span className="wizard-summary__value">{shareSummaryText}</span>
                  </div>
                  <button type="button" className="list-item__action" onClick={() => editSection("equal_all_q")}>
                    ویرایش
                  </button>
                </div>
              </div>

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
                <button type="button" className="wizard-step__actions--primary" disabled={saving} onClick={handleFinalSave}>
                  تأیید و ذخیره
                </button>
              </div>
            </>
          )}
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={confirmCancelOpen}
        title="انصراف از ثبت هزینه"
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
