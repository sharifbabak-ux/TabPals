import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "@/data/db";
import { FinalizeBlockedError, orderSessionsRepository } from "@/data/repositories";
import type { ExtraAllocation, SessionExtra } from "@/data/types";
import { isEventClosed } from "@/domain/eventStatus";
import { useOnlineEvent } from "@/ui/hooks/useOnlineEvent";
import { formatAmount, toPersianDigits } from "@/domain/format";
import {
  DIFFERENCE_EXTRA_LABEL,
  computeSession,
  isDifferenceExtra,
  missingPriceGroups,
  reconcile,
  recomputePayers,
  validateFinalize,
  type SessionComputation
} from "@/domain/groupOrder";
import { AmountInput } from "@/ui/components/AmountInput";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { EmptyState } from "@/ui/components/EmptyState";
import { JalaliDatePicker } from "@/ui/components/JalaliDatePicker";
import { PayersEditor } from "@/ui/components/PayersEditor";
import { useEventMembers } from "@/ui/hooks/useEventMembers";
import { ExtraFormSheet } from "./ExtraFormSheet";
import { PersonOrderSheet } from "./PersonOrderSheet";
import { SessionStatusChip } from "./SessionStatusChip";
import { WeightsEditor } from "./WeightsEditor";
import { ALLOCATION_LABELS } from "./orderLabels";
import { useOrderSession } from "./useOrderSession";
import "./orders.css";

/** Pricing & invoice: missing prices, per-person view, extras, bill reconciliation, payers, date, summary, finalize (docs/PLAN.md Group Order UI #8). */
export function OrderPricingScreen() {
  const { eventId = "", sessionId = "" } = useParams();
  const navigate = useNavigate();
  const event = useLiveQuery(() => db.events.get(eventId), [eventId]);
  const members = useEventMembers(eventId);
  const data = useOrderSession(sessionId);
  const online = useOnlineEvent(eventId);

  const [prices, setPrices] = useState<Record<string, number>>({});
  const [bill, setBill] = useState<number | null>(null);
  const [extraSheet, setExtraSheet] = useState<{ open: boolean; extra?: SessionExtra }>({ open: false });
  const [personId, setPersonId] = useState<string | null>(null);
  const [diffAllocation, setDiffAllocation] = useState<ExtraAllocation>("proportional");
  const [diffWeights, setDiffWeights] = useState<Record<string, number>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalizeErrors, setFinalizeErrors] = useState<string[]>([]);

  const nameOf = (id: string) => members?.find((m) => m.personId === id)?.name ?? "؟";

  const calc = useMemo(() => {
    if (!data) return null;
    try {
      const withoutDiff = data.extras.filter((e) => !isDifferenceExtra(e));
      return {
        full: computeSession(data.lines, data.totals, data.extras),
        base: computeSession(data.lines, data.totals, withoutDiff),
        error: null as string | null
      };
    } catch (e) {
      return { full: null as SessionComputation | null, base: null as SessionComputation | null, error: e instanceof Error ? e.message : "محاسبه ناموفق بود" };
    }
  }, [data]);

  if (event === undefined || members === undefined || data === undefined) return <div className="screen" />;
  if (event === null || data === null || calc === null) {
    return (
      <div className="screen">
        <EmptyState hint="این نشست پیدا نشد." />
      </div>
    );
  }

  const { session } = data;
  const currency = event.currency;
  const closed = isEventClosed(event, new Date());
  const editable = !closed && !online.readOnly && session.status === "pricing";
  const back = () => navigate(`/events/${eventId}/orders/${session.id}`);

  if (session.status !== "pricing" && session.status !== "finalized") {
    return (
      <div className="screen">
        <button type="button" className="back-link" onClick={back}>
          ← بازگشت به نشست
        </button>
        <EmptyState hint="قیمت‌گذاری فقط پس از «قیمت‌گذاری و فاکتور» در دسترس است." />
      </div>
    );
  }

  const personOptions = (calc.full ?? calc.base)?.persons.map((p) => ({ personId: p.personId, name: nameOf(p.personId) })) ?? [];
  const missing = missingPriceGroups(data.lines, data.totals);
  const userExtras = data.extras.filter((e) => !isDifferenceExtra(e));
  const diffExtra = data.extras.find(isDifferenceExtra);
  const billTotal = session.billTotal;
  const reconciliation = reconcile(calc.base?.computedTotal ?? 0, billTotal);
  const payers = billTotal !== null ? recomputePayers(billTotal, session.payers, session.payerSplitMode) : session.payers;
  const blockers = calc.full
    ? validateFinalize({ status: session.status, eventClosed: closed, billTotal, payers, computation: calc.full, nameOf })
    : [calc.error ?? "محاسبه ناموفق بود"];
  const diffStale = diffExtra && reconciliation.difference !== null && diffExtra.value !== reconciliation.difference;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    }
  }

  async function applyPrice(name: string, key: string) {
    const price = prices[key] ?? 0;
    if (price <= 0) return;
    await run(async () => {
      await orderSessionsRepository.applyBulkPrice(session.id, name, price);
      setPrices((prev) => ({ ...prev, [key]: 0 }));
    });
  }

  async function saveDifference() {
    if (reconciliation.difference === null) return;
    await run(() =>
      orderSessionsRepository.setDifferenceExtra(
        session.id,
        reconciliation.difference as number,
        diffAllocation,
        diffAllocation === "weight" ? personOptions.map((p) => ({ personId: p.personId, weight: diffWeights[p.personId] ?? 0 })) : undefined
      )
    );
  }

  async function handleFinalize() {
    setConfirmOpen(false);
    setError(null);
    setFinalizeErrors([]);
    try {
      await orderSessionsRepository.finalize(session.id);
      navigate(`/events/${eventId}/orders/${session.id}`, { replace: true });
    } catch (e) {
      if (e instanceof FinalizeBlockedError) setFinalizeErrors(e.reasons);
      else setError(e instanceof Error ? e.message : "خطایی رخ داد");
    }
  }

  const activePerson = members.find((m) => m.personId === personId) ?? null;
  const summary = calc.full;

  return (
    <div className="screen order-pricing">
      <button type="button" className="back-link" onClick={back}>
        ← بازگشت به نشست
      </button>
      <div className="screen-header">
        <h1>قیمت‌گذاری و فاکتور</h1>
        <SessionStatusChip status={session.status} />
      </div>
      <p className="field__hint">
        {session.title}
        {session.restaurant ? ` · ${session.restaurant}` : ""}
      </p>
      {closed && <p className="field__hint">این ایونت پایان‌یافته است؛ فقط‌خواندنی.</p>}
      {!closed && online.readOnly && <p className="field__hint">شما در این ایونت آنلاین عضو هستید؛ این صفحه فقط‌خواندنی است.</p>}
      {calc.error && <p className="field__error">{calc.error}</p>}

      {/* (a) missing prices */}
      <h2 className="section-title">قیمت اقلام</h2>
      {missing.length === 0 ? (
        <p className="field__hint">✓ همه‌ی اقلام قیمت دارند.</p>
      ) : (
        <ul className="list">
          {missing.map((group) => (
            <li key={group.key} className="list-item pricing-row">
              <div className="list-item__main">
                <span className="list-item__title">{group.name}</span>
                <span className="list-item__subtitle">{toPersianDigits(group.quantity)} عدد در {toPersianDigits(group.lineCount)} سفارش — قیمت واحد؟</span>
              </div>
              {editable && (
                <div className="pricing-row__input">
                  <AmountInput value={prices[group.key] ?? 0} onChange={(v) => setPrices((prev) => ({ ...prev, [group.key]: v }))} placeholder="قیمت" />
                  <button type="button" className="form-actions__secondary" disabled={(prices[group.key] ?? 0) <= 0} onClick={() => applyPrice(group.name, group.key)}>
                    اعمال
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* (b) per-person view */}
      <h2 className="section-title">سفارش هر نفر</h2>
      {(calc.base?.persons ?? []).length === 0 && <p className="field__hint">سفارشی ثبت نشده است.</p>}
      <ul className="list">
        {(calc.base?.persons ?? []).map((p) => (
          <li key={p.personId} className="list-item person-card" onClick={() => setPersonId(p.personId)}>
            <div className="list-item__main">
              <span className="list-item__title">{nameOf(p.personId)}</span>
              <span className="list-item__subtitle">
                {p.personTotal !== null ? `جمع سفارش: ${formatAmount(p.personTotal)}` : p.items.map((i) => `${toPersianDigits(i.quantity)} × ${i.name}`).join("، ")}
                {p.sharedItems.length > 0 ? ` · مشترک: ${p.sharedItems.map((s) => s.name).join("، ")}` : ""}
              </span>
            </div>
            <span className="voucher-row__amount">{p.computable ? `${formatAmount(p.subtotal)} ${currency}` : "ناقص"}</span>
          </li>
        ))}
      </ul>

      {/* (c) extras */}
      <h2 className="section-title">هزینه‌های مشترک (مالیات، سرویس، انعام، تخفیف)</h2>
      {userExtras.length === 0 && <p className="field__hint">موردی ثبت نشده است.</p>}
      <ul className="list">
        {userExtras.map((extra) => {
          const result = calc.full?.extras.find((e) => e.extraId === extra.id);
          return (
            <li key={extra.id} className="list-item" onClick={() => editable && setExtraSheet({ open: true, extra })}>
              <div className="list-item__main">
                <span className="list-item__title">{extra.label}</span>
                <span className="list-item__subtitle">
                  {extra.mode === "percent" ? `${toPersianDigits(extra.value)}٪` : "مبلغ ثابت"} · {ALLOCATION_LABELS[extra.allocation]}
                </span>
              </div>
              <span className="voucher-row__amount">{result ? formatAmount(result.amount) : "—"}</span>
              {editable && (
                <button
                  type="button"
                  className="list-item__action"
                  onClick={(e) => {
                    e.stopPropagation();
                    void run(() => orderSessionsRepository.removeExtra(extra.id));
                  }}
                >
                  حذف
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {editable && (
        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={() => setExtraSheet({ open: true })}>
            + افزودن هزینه‌ی مشترک
          </button>
        </div>
      )}

      {/* (d) bill total & reconciliation */}
      <h2 className="section-title">مبلغ نهایی فاکتور</h2>
      <div className="field">
        <label htmlFor="bill-total">مبلغ روی فاکتور رستوران ({currency})</label>
        <AmountInput
          id="bill-total"
          value={bill ?? billTotal ?? 0}
          onChange={(v) => {
            if (!editable) return;
            setBill(v);
          }}
        />
        {editable && (
          <div className="form-actions">
            <button
              type="button"
              className="form-actions__secondary"
              disabled={bill === null || bill === billTotal}
              onClick={() => run(async () => {
                await orderSessionsRepository.update(session.id, { billTotal: bill && bill > 0 ? bill : null });
                setBill(null);
              })}
            >
              ثبت مبلغ فاکتور
            </button>
            <button
              type="button"
              className="form-actions__secondary"
              disabled={!calc.base}
              onClick={() => run(async () => {
                await orderSessionsRepository.update(session.id, { billTotal: calc.base?.computedTotal ?? 0 });
                setBill(null);
              })}
            >
              هم‌مبلغ محاسبه‌شده
            </button>
          </div>
        )}
      </div>

      <div className={`reconcile reconcile--${reconciliation.status}`}>
        <div className="reconcile__row">
          <span>مبلغ محاسبه‌شده</span>
          <span>{formatAmount(reconciliation.computedTotal)} {currency}</span>
        </div>
        <div className="reconcile__row">
          <span>مبلغ فاکتور</span>
          <span>{reconciliation.billTotal === null ? "—" : `${formatAmount(reconciliation.billTotal)} ${currency}`}</span>
        </div>
        <div className="reconcile__row reconcile__row--diff">
          <span>اختلاف</span>
          <span>{reconciliation.difference === null ? "—" : `${formatAmount(reconciliation.difference)} ${currency}`}</span>
        </div>
        {reconciliation.status === "match" && <p className="reconcile__ok">✓ مبلغ محاسبه‌شده با فاکتور برابر است.</p>}
        {reconciliation.status === "mismatch" && (
          <div className="reconcile__options">
            <p className="field__warning">مبلغ‌ها برابر نیست. یکی از دو راه را انتخاب کنید:</p>
            <p>
              <strong>الف) اصلاح:</strong> قیمت‌ها، هزینه‌های مشترک یا مبلغ فاکتور را اصلاح کنید؛ تا زمانی که اختلاف باقی است، ثبت سند ممکن نیست.
            </p>
            {editable && (
              <>
                <p>
                  <strong>ب) ثبت اختلاف</strong> به‌عنوان قلم «{DIFFERENCE_EXTRA_LABEL}» و تقسیم آن:
                </p>
                <select aria-label="تقسیم اختلاف" value={diffAllocation} onChange={(e) => setDiffAllocation(e.target.value as ExtraAllocation)}>
                  {(Object.keys(ALLOCATION_LABELS) as ExtraAllocation[]).map((a) => (
                    <option key={a} value={a}>
                      {ALLOCATION_LABELS[a]}
                    </option>
                  ))}
                </select>
                {diffAllocation === "weight" && <WeightsEditor persons={personOptions} weights={diffWeights} onChange={setDiffWeights} />}
                <div className="form-actions">
                  <button type="button" className="form-actions__primary" onClick={saveDifference}>
                    ثبت به‌عنوان «{DIFFERENCE_EXTRA_LABEL}»
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {diffExtra && (
          <p className="field__hint">
            قلم «{DIFFERENCE_EXTRA_LABEL}» ثبت شده است ({formatAmount(diffExtra.value)}، {ALLOCATION_LABELS[diffExtra.allocation]}).
            {diffStale ? " این قلم با اختلاف فعلی نمی‌خواند؛ دوباره ثبت کنید." : ""}
            {editable && (
              <button type="button" className="list-item__action" onClick={() => run(() => orderSessionsRepository.removeExtra(diffExtra.id))}>
                حذف قلم اختلاف
              </button>
            )}
          </p>
        )}
      </div>

      {/* (e) payers */}
      <h2 className="section-title">پرداخت‌کننده‌ها</h2>
      <PayersEditor
        members={members.map((m) => ({ personId: m.personId, name: m.name }))}
        total={billTotal ?? 0}
        payers={session.payers}
        payerSplitMode={session.payerSplitMode}
        disabled={!editable}
        onSave={(next, mode) => run(() => orderSessionsRepository.update(session.id, { payers: next, payerSplitMode: mode }))}
      />

      {/* (f) expense date */}
      <h2 className="section-title">تاریخ هزینه</h2>
      <div className="field">
        <JalaliDatePicker value={session.expenseDate} disabled={!editable} onChange={(v) => run(() => orderSessionsRepository.update(session.id, { expenseDate: v }))} />
      </div>

      {/* (g) summary */}
      <h2 className="section-title">خلاصه‌ی نهایی هر نفر</h2>
      {summary && (
        <div className="table-scroll">
          <table className="statement-table">
            <thead>
              <tr>
                <th>نام</th>
                <th>جمع اقلام</th>
                {summary.extras.map((e) => (
                  <th key={e.extraId}>سهم {e.label}</th>
                ))}
                <th>مبلغ نهایی</th>
              </tr>
            </thead>
            <tbody>
              {summary.bills.map((b) => (
                <tr key={b.personId}>
                  <td>{nameOf(b.personId)}</td>
                  <td>{formatAmount(b.subtotal)}</td>
                  {b.extraShares.map((s) => (
                    <td key={s.extraId}>{formatAmount(s.share)}</td>
                  ))}
                  <td>
                    <strong>{formatAmount(b.finalTotal)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>جمع</td>
                <td>{formatAmount(summary.subtotalSum)}</td>
                {summary.extras.map((e) => (
                  <td key={e.extraId}>{formatAmount(e.amount)}</td>
                ))}
                <td>{formatAmount(summary.computedTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {editable && (
        <>
          {blockers.length > 0 && (
            <ul className="finalize-blockers">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {finalizeErrors.length > 0 && (
            <ul className="finalize-blockers">
              {finalizeErrors.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {error && <p className="field__error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="form-actions__primary" disabled={blockers.length > 0} onClick={() => setConfirmOpen(true)}>
              نهایی و ثبت سند
            </button>
          </div>
        </>
      )}
      {!editable && error && <p className="field__error">{error}</p>}

      <ExtraFormSheet open={extraSheet.open} sessionId={session.id} extra={extraSheet.extra} persons={personOptions} onClose={() => setExtraSheet({ open: false })} />
      <PersonOrderSheet open={activePerson !== null} person={activePerson} data={data} currency={currency} editable={editable} onClose={() => setPersonId(null)} />
      <ConfirmDialog
        open={confirmOpen}
        title="نهایی و ثبت سند"
        message={`یک سند هزینه به مبلغ ${formatAmount(summary?.computedTotal ?? 0)} ${currency} ثبت می‌شود و پس از آن نشست قابل ویرایش نیست. ادامه می‌دهید؟`}
        confirmLabel="نهایی و ثبت سند"
        onConfirm={handleFinalize}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
