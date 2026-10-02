import { useEffect, useMemo, useState } from "react";
import type { SplitMode, VoucherPayer } from "@/data/types";
import { formatAmount } from "@/domain/format";
import { recomputePayers } from "@/domain/groupOrder";
import { amountsSumTo, percentsSumTo100 } from "@/domain/splitEngine";

interface PayersEditorProps {
  members: { personId: string; name: string }[];
  /** The bill total the payers must add up to (0 while not yet known). */
  total: number;
  payers: VoucherPayer[];
  payerSplitMode: SplitMode | undefined;
  disabled?: boolean;
  onSave: (payers: VoucherPayer[], payerSplitMode: SplitMode | undefined) => void | Promise<void>;
}

type PayerMode = "equal" | "weight" | "percent" | "exact";
const MODE_LABELS: Record<PayerMode, string> = { equal: "مساوی", weight: "ضریبی", percent: "درصدی", exact: "مبلغ مشخص" };

function asPayerMode(mode: SplitMode | undefined): PayerMode {
  return mode === "weight" || mode === "percent" || mode === "exact" ? mode : "equal";
}

/**
 * Multi-payer picker with the same split modes as the expense wizard
 * (equal / weight / percent / exact), computed with the shared split engine
 * so payer amounts always sum exactly to the total.
 */
export function PayersEditor({ members, total, payers, payerSplitMode, disabled, onSave }: PayersEditorProps) {
  const [selected, setSelected] = useState<string[]>(payers.map((p) => p.personId));
  const [mode, setMode] = useState<PayerMode>(asPayerMode(payerSplitMode));
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(payers.map((p) => [p.personId, asPayerMode(payerSplitMode) === "exact" ? p.amount : (p.weight ?? 0)]))
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(payers.map((p) => p.personId));
    setMode(asPayerMode(payerSplitMode));
    setValues(Object.fromEntries(payers.map((p) => [p.personId, asPayerMode(payerSplitMode) === "exact" ? p.amount : (p.weight ?? 0)])));
    // Re-sync only when the saved payers change from outside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(payers), payerSplitMode]);

  const multi = selected.length > 1;

  const preview = useMemo<VoucherPayer[]>(() => {
    if (selected.length === 0) return [];
    if (selected.length === 1) return [{ personId: selected[0], amount: total }];
    const draft: VoucherPayer[] = selected.map((personId) => ({
      personId,
      amount: mode === "exact" ? (values[personId] ?? 0) : 0,
      weight: mode === "weight" || mode === "percent" ? (values[personId] ?? 0) : undefined
    }));
    try {
      return recomputePayers(total, draft, mode);
    } catch {
      return draft;
    }
  }, [selected, mode, values, total]);

  const valid = (() => {
    if (selected.length === 0) return false;
    if (!multi) return true;
    const list = selected.map((id) => values[id] ?? 0);
    if (mode === "equal") return true;
    if (mode === "weight") return list.some((v) => v > 0);
    if (mode === "percent") return percentsSumTo100(list);
    return total > 0 && amountsSumTo(total, list);
  })();

  function toggle(personId: string) {
    setSelected((prev) => (prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId]));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(preview, multi ? mode : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="payers-editor">
      <ul className="checklist">
        {members.map((m) => (
          <li key={m.personId} className="checklist-item">
            <input type="checkbox" id={`payer-${m.personId}`} disabled={disabled} checked={selected.includes(m.personId)} onChange={() => toggle(m.personId)} />
            <label htmlFor={`payer-${m.personId}`}>{m.name}</label>
          </li>
        ))}
      </ul>

      {multi && (
        <>
          <div className="split-mode-tabs">
            {(Object.keys(MODE_LABELS) as PayerMode[]).map((m) => (
              <button key={m} type="button" disabled={disabled} className={m === mode ? "split-mode-tabs__tab--active" : ""} onClick={() => setMode(m)}>
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          {mode !== "equal" && (
            <ul className="checklist">
              {selected.map((personId) => (
                <li key={personId} className="split-row">
                  <span className="split-row__name">{members.find((m) => m.personId === personId)?.name ?? "؟"}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    disabled={disabled}
                    value={values[personId] ?? ""}
                    onChange={(e) => {
                      const raw = Number(e.target.value.replace(/[^\d.]/g, ""));
                      setValues((prev) => ({ ...prev, [personId]: Number.isFinite(raw) ? raw : 0 }));
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          {mode === "percent" && <p className="field__hint">مجموع درصدها باید ۱۰۰ باشد.</p>}
          {mode === "exact" && <p className="field__hint">مجموع مبالغ باید برابر مبلغ فاکتور ({formatAmount(total)}) باشد.</p>}
        </>
      )}

      {preview.length > 0 && (
        <div className="split-summary">
          {preview.map((p) => (
            <div className="split-summary__row" key={p.personId}>
              <span>{members.find((m) => m.personId === p.personId)?.name ?? "؟"}</span>
              <span>{formatAmount(p.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="form-actions">
          <button type="button" className="form-actions__secondary" disabled={!valid || saving} onClick={handleSave}>
            ثبت پرداخت‌کنندگان
          </button>
        </div>
      )}
    </div>
  );
}
