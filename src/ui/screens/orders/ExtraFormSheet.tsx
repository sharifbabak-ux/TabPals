import { useEffect, useState } from "react";
import { orderSessionsRepository } from "@/data/repositories";
import type { ExtraAllocation, SessionExtra, SessionExtraKind, SessionExtraMode } from "@/data/types";
import { defaultExtraLabel } from "@/domain/groupOrder";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { useWizardBackTrap } from "@/ui/hooks/useWizardBackTrap";
import { AmountInput } from "@/ui/components/AmountInput";
import { ALLOCATION_LABELS, EXTRA_KIND_OPTIONS } from "./orderLabels";
import { EXTRA_KIND_LABELS } from "@/domain/groupOrder";
import { WeightsEditor } from "./WeightsEditor";

interface ExtraFormSheetProps {
  open: boolean;
  sessionId: string;
  /** Present when editing. */
  extra?: SessionExtra;
  persons: { personId: string; name: string }[];
  onClose: () => void;
}

/** Add/edit a shared cost: kind, percent or amount, and how it is allocated (docs/PLAN.md Group Order UI #8c). */
export function ExtraFormSheet({ open, sessionId, extra, persons, onClose }: ExtraFormSheetProps) {
  const [kind, setKind] = useState<SessionExtraKind>("vat");
  const [label, setLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);
  const [mode, setMode] = useState<SessionExtraMode>("percent");
  const [value, setValue] = useState(0);
  const [allocation, setAllocation] = useState<ExtraAllocation>("proportional");
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(extra?.kind ?? "vat");
    setLabel(extra?.label ?? "");
    setLabelTouched(Boolean(extra));
    setMode(extra?.mode ?? "percent");
    setValue(extra ? Math.abs(extra.value) : 0);
    setAllocation(extra?.allocation ?? "proportional");
    setWeights(Object.fromEntries((extra?.weights ?? []).map((w) => [w.personId, w.weight])));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useWizardBackTrap(open, onClose);

  const shownLabel = labelTouched ? label : defaultExtraLabel(kind, mode, value);

  async function handleSave() {
    setError(null);
    const input = {
      kind,
      label: shownLabel,
      mode,
      value,
      allocation,
      weights: allocation === "weight" ? persons.map((p) => ({ personId: p.personId, weight: weights[p.personId] ?? 0 })) : undefined
    };
    try {
      if (extra) await orderSessionsRepository.updateExtra(extra.id, input);
      else await orderSessionsRepository.addExtra(sessionId, input);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    }
  }

  return (
    <BottomSheet open={open} title={extra ? "ویرایش هزینه‌ی مشترک" : "هزینه‌ی مشترک"} onClose={onClose}>
      <div className="field">
        <label htmlFor="extra-kind">نوع</label>
        <select id="extra-kind" value={kind} onChange={(e) => setKind(e.target.value as SessionExtraKind)}>
          {EXTRA_KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {EXTRA_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="split-mode-tabs">
        <button type="button" className={mode === "percent" ? "split-mode-tabs__tab--active" : ""} onClick={() => setMode("percent")}>
          درصد
        </button>
        <button type="button" className={mode === "amount" ? "split-mode-tabs__tab--active" : ""} onClick={() => setMode("amount")}>
          مبلغ
        </button>
      </div>
      <div className="field">
        <label htmlFor="extra-value">{mode === "percent" ? "درصد (از جمع سفارش‌ها)" : "مبلغ"}</label>
        <AmountInput id="extra-value" value={value} onChange={setValue} />
      </div>
      <div className="field">
        <label htmlFor="extra-label">عنوان</label>
        <input
          id="extra-label"
          value={shownLabel}
          onChange={(e) => {
            setLabel(e.target.value);
            setLabelTouched(true);
          }}
        />
      </div>
      {kind === "discount" && <p className="field__hint">تخفیف از مبلغ کل کم می‌شود.</p>}

      <div className="field">
        <label htmlFor="extra-allocation">تقسیم بین افراد</label>
        <select id="extra-allocation" value={allocation} onChange={(e) => setAllocation(e.target.value as ExtraAllocation)}>
          {(Object.keys(ALLOCATION_LABELS) as ExtraAllocation[]).map((a) => (
            <option key={a} value={a}>
              {ALLOCATION_LABELS[a]}
            </option>
          ))}
        </select>
      </div>
      {allocation === "weight" && <WeightsEditor persons={persons} weights={weights} onChange={setWeights} />}

      {error && <p className="field__error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="form-actions__secondary" onClick={onClose}>
          انصراف
        </button>
        <button type="button" className="form-actions__primary" disabled={value <= 0 || !shownLabel.trim()} onClick={handleSave}>
          {extra ? "ذخیره" : "افزودن"}
        </button>
      </div>
    </BottomSheet>
  );
}
