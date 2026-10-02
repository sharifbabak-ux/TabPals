import { useEffect, useState } from "react";
import { orderSessionsRepository } from "@/data/repositories";
import type { OrderLine } from "@/data/types";
import { AmountInput } from "@/ui/components/AmountInput";
import { BottomSheet } from "@/ui/components/BottomSheet";
import type { EventMemberOption } from "@/ui/hooks/useEventMembers";
import { QuantityStepper } from "./QuantityStepper";

interface SharedItemSheetProps {
  open: boolean;
  sessionId: string;
  members: EventMemberOption[];
  /** Present when editing an existing shared line. */
  line?: OrderLine;
  onClose: () => void;
}

/** «قلم مشترک»: one item (e.g. a pizza) shared by several people with optional weights (docs/PLAN.md Group Order UI #5). */
export function SharedItemSheet({ open, sessionId, members, line, onClose }: SharedItemSheetProps) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [useWeights, setUseWeights] = useState(false);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(line?.itemName ?? "");
    setQuantity(line?.quantity ?? 1);
    setPrice(line?.unitPrice ?? 0);
    setSelected(new Set((line?.sharedParticipants ?? []).map((p) => p.personId)));
    const w: Record<string, number> = {};
    for (const p of line?.sharedParticipants ?? []) w[p.personId] = p.weight;
    setWeights(w);
    setUseWeights((line?.sharedParticipants ?? []).some((p) => p.weight !== 1));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggle(personId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    const sharedParticipants = members
      .filter((m) => selected.has(m.personId))
      .map((m) => ({ personId: m.personId, weight: useWeights ? (weights[m.personId] ?? 1) : 1 }));
    try {
      if (line) {
        await orderSessionsRepository.updateLine(line.id, { itemName: name, quantity, unitPrice: price > 0 ? price : null, sharedParticipants });
      } else {
        await orderSessionsRepository.addLine(sessionId, { personId: null, itemName: name, quantity, unitPrice: price > 0 ? price : undefined, sharedParticipants });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    }
  }

  return (
    <BottomSheet open={open} title={line ? "ویرایش قلم مشترک" : "قلم مشترک"} onClose={onClose}>
      <div className="field">
        <label htmlFor="shared-name">نام قلم</label>
        <input id="shared-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً پیتزا" />
      </div>
      <div className="field">
        <label>تعداد</label>
        <QuantityStepper value={quantity} onChange={setQuantity} />
      </div>
      <div className="field">
        <label htmlFor="shared-price">قیمت واحد (اختیاری)</label>
        <AmountInput id="shared-price" value={price} onChange={setPrice} />
      </div>

      <h3 className="section-title">چه کسانی سهیم‌اند؟</h3>
      <div className="checklist-actions">
        <button type="button" onClick={() => setSelected(new Set(members.map((m) => m.personId)))}>
          همه
        </button>
        <button type="button" onClick={() => setSelected(new Set())}>
          هیچ‌کدام
        </button>
      </div>
      <ul className="checklist">
        {members.map((m) => (
          <li key={m.personId} className="split-row">
            <span className="checklist-item">
              <input type="checkbox" id={`shared-${m.personId}`} checked={selected.has(m.personId)} onChange={() => toggle(m.personId)} />
              <label htmlFor={`shared-${m.personId}`}>{m.name}</label>
            </span>
            {useWeights && selected.has(m.personId) && (
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                aria-label={`ضریب ${m.name}`}
                value={weights[m.personId] ?? 1}
                onChange={(e) => {
                  const raw = Number(e.target.value.replace(/[^\d.]/g, ""));
                  setWeights((prev) => ({ ...prev, [m.personId]: Number.isFinite(raw) ? raw : 0 }));
                }}
              />
            )}
          </li>
        ))}
      </ul>
      <div className="toggle-row">
        <input type="checkbox" id="shared-use-weights" checked={useWeights} onChange={(e) => setUseWeights(e.target.checked)} />
        <label htmlFor="shared-use-weights">سهم‌ها برابر نیست (ضریب)</label>
      </div>

      {error && <p className="field__error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="form-actions__secondary" onClick={onClose}>
          انصراف
        </button>
        <button type="button" className="form-actions__primary" disabled={!name.trim() || selected.size === 0} onClick={handleSave}>
          {line ? "ذخیره" : "افزودن"}
        </button>
      </div>
    </BottomSheet>
  );
}
