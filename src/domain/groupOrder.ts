/**
 * Pure Group Order calculation (docs/PLAN.md "Group Order", Stage GO-1):
 * per-person subtotals, extras (VAT/service/tip/discount) allocation,
 * bill reconciliation, the waiter list, bulk pricing, finalize validation
 * and the itemized snapshot written onto the voucher. Takes plain data
 * (not Dexie records) and never touches the DOM or the database. Every
 * allocation reuses the split engine so shares always sum EXACTLY.
 */
import type {
  ExtraAllocation,
  ItemizedSnapshot,
  OrderCategory,
  SessionExtraKind,
  SessionExtraMode,
  SharedParticipant,
  SplitMode,
  VoucherPayer
} from "@/data/types";
import { formatAmount, toPersianDigits } from "./format";
import { normalizeName } from "./nameNormalization";
import { DEFAULT_ORDER_CATEGORY, ORDER_CATEGORIES, ORDER_CATEGORY_LABELS, categoryRank } from "./orderCategory";
import { splitByWeight, splitEqual } from "./splitEngine";

export const DIFFERENCE_EXTRA_LABEL = "اختلاف فاکتور";

export interface LineInput {
  id: string;
  /** Null for a shared line. */
  personId: string | null;
  sharedParticipants?: SharedParticipant[];
  itemName: string;
  quantity: number;
  unitPrice?: number | null;
  note?: string;
  /** Waiter-list category; missing (pre-GO-1.1 data) counts as "other". */
  category?: OrderCategory;
}

export interface PersonTotalInput {
  personId: string;
  total: number;
}

export interface ExtraInput {
  id: string;
  kind: SessionExtraKind;
  label: string;
  mode: SessionExtraMode;
  value: number;
  allocation: ExtraAllocation;
  weights?: { personId: string; weight: number }[];
}

/** An item name's normalized grouping key (Persian ي/ك, ZWNJ, digits, spacing). */
export function itemKey(name: string): string {
  return normalizeName(name);
}

function hasPrice(line: LineInput): boolean {
  return typeof line.unitPrice === "number" && Number.isFinite(line.unitPrice);
}

export function lineAmount(line: LineInput): number | null {
  return hasPrice(line) ? line.quantity * (line.unitPrice as number) : null;
}

// --- Person subtotals -------------------------------------------------------

export interface PersonItem {
  name: string;
  quantity: number;
  unitPrice: number | null;
  amount: number;
}

export interface PersonSharedItem {
  name: string;
  quantity: number;
  amount: number;
}

export interface PersonSubtotal {
  personId: string;
  /** Own lines' names/amounts; amounts of unpriced lines are 0. */
  items: PersonItem[];
  /** Set when the amount came from the per-person total instead of item prices. */
  personTotal: number | null;
  sharedItems: PersonSharedItem[];
  /** Own lines (or per-person total) before shared items. */
  ownSubtotal: number;
  sharedSubtotal: number;
  subtotal: number;
  /** False while any of the person's relevant lines still lacks a price. */
  computable: boolean;
  hasLines: boolean;
}

/** Splits a priced shared line among its participants by weight (exact-sum rounding). */
function sharedLineShares(line: LineInput): { personId: string; share: number }[] | null {
  const amount = lineAmount(line);
  const participants = (line.sharedParticipants ?? []).filter((p) => p.weight > 0);
  if (amount === null || participants.length === 0) return null;
  return splitByWeight(
    amount,
    participants.map((p) => ({ personId: p.personId, weight: p.weight }))
  );
}

/**
 * Per-person subtotals: the sum of a person's own lines (quantity × unit
 * price), or their per-person total when they have no priced lines; plus
 * their weighted share of every shared line.
 */
export function computePersonSubtotals(lines: LineInput[], personTotals: PersonTotalInput[]): PersonSubtotal[] {
  const totalByPerson = new Map(personTotals.map((t) => [t.personId, t.total]));
  const order: string[] = [];
  const ensure = (personId: string) => {
    if (!order.includes(personId)) order.push(personId);
  };

  for (const line of lines) {
    if (line.personId) ensure(line.personId);
    else for (const p of line.sharedParticipants ?? []) if (p.weight > 0) ensure(p.personId);
  }
  for (const t of personTotals) ensure(t.personId);

  return order.map((personId): PersonSubtotal => {
    const own = lines.filter((l) => l.personId === personId);
    const pricedOwn = own.filter(hasPrice);
    const unpricedOwn = own.filter((l) => !hasPrice(l));
    const override = totalByPerson.get(personId);

    let personTotal: number | null = null;
    let ownSubtotal = 0;
    let computable = true;
    if (pricedOwn.length === 0 && override !== undefined) {
      personTotal = override;
      ownSubtotal = override;
    } else {
      ownSubtotal = pricedOwn.reduce((sum, l) => sum + (lineAmount(l) as number), 0);
      if (unpricedOwn.length > 0) computable = false;
    }

    const items: PersonItem[] = own.map((l) => ({
      name: l.itemName,
      quantity: l.quantity,
      unitPrice: hasPrice(l) ? (l.unitPrice as number) : null,
      amount: lineAmount(l) ?? 0
    }));

    const sharedItems: PersonSharedItem[] = [];
    let sharedSubtotal = 0;
    for (const line of lines) {
      if (line.personId !== null) continue;
      const involved = (line.sharedParticipants ?? []).some((p) => p.personId === personId && p.weight > 0);
      if (!involved) continue;
      const shares = sharedLineShares(line);
      if (!shares) {
        computable = false;
        continue;
      }
      const share = shares.find((s) => s.personId === personId)?.share ?? 0;
      sharedSubtotal += share;
      sharedItems.push({ name: line.itemName, quantity: line.quantity, amount: share });
    }

    return {
      personId,
      items,
      personTotal,
      sharedItems,
      ownSubtotal,
      sharedSubtotal,
      subtotal: ownSubtotal + sharedSubtotal,
      computable,
      hasLines: own.length > 0 || sharedItems.length > 0 || personTotal !== null
    };
  });
}

// --- Extras -----------------------------------------------------------------

export interface ExtraAllocationResult {
  extraId: string;
  kind: SessionExtraKind;
  label: string;
  mode: SessionExtraMode;
  value: number;
  allocation: ExtraAllocation;
  /** Total of this extra over everyone; negative for discounts. */
  amount: number;
  shares: { personId: string; share: number }[];
}

/** The extra's total amount: percent extras apply to the sum of all subtotals; discounts are always negative. */
export function extraTotalAmount(extra: ExtraInput, subtotalSum: number): number {
  const magnitude = extra.mode === "percent" ? Math.round((subtotalSum * Math.abs(extra.value)) / 100) : Math.round(Math.abs(extra.value));
  if (extra.kind === "discount") return -magnitude;
  // "other" extras (e.g. the bill-difference extra) keep the sign they were entered with.
  if (extra.kind === "other") return extra.mode === "percent" ? Math.round((subtotalSum * extra.value) / 100) : Math.round(extra.value);
  return magnitude;
}

/** Allocates one extra to persons: proportional to subtotal / equal / by weights, with an exact-sum guarantee. */
export function allocateExtra(extra: ExtraInput, subtotals: { personId: string; subtotal: number }[]): ExtraAllocationResult {
  const sum = subtotals.reduce((s, p) => s + p.subtotal, 0);
  const amount = extraTotalAmount(extra, sum);
  const magnitude = Math.abs(amount);
  const sign = amount < 0 ? -1 : 1;

  let weights: { personId: string; weight: number }[];
  if (extra.allocation === "equal") {
    weights = subtotals.map((p) => ({ personId: p.personId, weight: 1 }));
  } else if (extra.allocation === "weight") {
    const byPerson = new Map((extra.weights ?? []).map((w) => [w.personId, w.weight]));
    weights = subtotals.map((p) => ({ personId: p.personId, weight: Math.max(0, byPerson.get(p.personId) ?? 0) }));
  } else {
    weights = subtotals.map((p) => ({ personId: p.personId, weight: Math.max(0, p.subtotal) }));
  }
  // Fallbacks keep the sum exact when the chosen basis is degenerate (everyone at 0).
  if (weights.reduce((s, w) => s + w.weight, 0) <= 0) {
    if (extra.allocation === "weight") throw new Error(`برای «${extra.label}» حداقل یک نفر باید ضریب مثبت داشته باشد`);
    weights = subtotals.map((p) => ({ personId: p.personId, weight: 1 }));
  }

  const shares = subtotals.length === 0 ? [] : splitByWeight(magnitude, weights).map((s) => ({ personId: s.personId, share: sign * s.share }));
  return { extraId: extra.id, kind: extra.kind, label: extra.label, mode: extra.mode, value: extra.value, allocation: extra.allocation, amount, shares };
}

export interface PersonBill {
  personId: string;
  subtotal: number;
  extraShares: { extraId: string; share: number }[];
  finalTotal: number;
}

export interface SessionComputation {
  persons: PersonSubtotal[];
  extras: ExtraAllocationResult[];
  bills: PersonBill[];
  subtotalSum: number;
  /** Sum of all persons' final totals. */
  computedTotal: number;
  /** False while any person's subtotal still lacks a price. */
  allComputable: boolean;
}

export function computeSession(lines: LineInput[], personTotals: PersonTotalInput[], extras: ExtraInput[]): SessionComputation {
  const persons = computePersonSubtotals(lines, personTotals);
  const subtotals = persons.map((p) => ({ personId: p.personId, subtotal: p.subtotal }));
  const allocations = extras.map((extra) => allocateExtra(extra, subtotals));
  const bills: PersonBill[] = persons.map((p) => {
    const extraShares = allocations.map((a) => ({ extraId: a.extraId, share: a.shares.find((s) => s.personId === p.personId)?.share ?? 0 }));
    return { personId: p.personId, subtotal: p.subtotal, extraShares, finalTotal: p.subtotal + extraShares.reduce((s, e) => s + e.share, 0) };
  });
  return {
    persons,
    extras: allocations,
    bills,
    subtotalSum: subtotals.reduce((s, p) => s + p.subtotal, 0),
    computedTotal: bills.reduce((s, b) => s + b.finalTotal, 0),
    allComputable: persons.every((p) => p.computable)
  };
}

// --- Reconciliation ---------------------------------------------------------

export interface Reconciliation {
  computedTotal: number;
  billTotal: number | null;
  /** billTotal − computedTotal; null while no bill total is entered. */
  difference: number | null;
  status: "unset" | "match" | "mismatch";
}

export function isDifferenceExtra(extra: Pick<ExtraInput, "kind" | "label">): boolean {
  return extra.kind === "other" && extra.label === DIFFERENCE_EXTRA_LABEL;
}

/** Compares the computed total with the restaurant's bill total. */
export function reconcile(computedTotal: number, billTotal: number | null): Reconciliation {
  if (billTotal === null) return { computedTotal, billTotal, difference: null, status: "unset" };
  const difference = billTotal - computedTotal;
  return { computedTotal, billTotal, difference, status: difference === 0 ? "match" : "mismatch" };
}

/** The "اختلاف فاکتور" extra for option (b): the difference allocated with the chosen rule. */
export function buildDifferenceExtra(
  id: string,
  difference: number,
  allocation: ExtraAllocation,
  weights?: { personId: string; weight: number }[]
): ExtraInput {
  return { id, kind: "other", label: DIFFERENCE_EXTRA_LABEL, mode: "amount", value: difference, allocation, weights };
}

// --- Payers -----------------------------------------------------------------

/** Recomputes payer amounts from the (possibly changed) bill total using the stored mode; "exact" amounts stay as entered. */
export function recomputePayers(billTotal: number, payers: VoucherPayer[], mode: SplitMode | undefined): VoucherPayer[] {
  if (payers.length <= 1) return payers.map((p) => ({ ...p, amount: billTotal }));
  if (mode === "equal") return splitEqual(billTotal, payers.map((p) => p.personId)).map((s) => ({ personId: s.personId, amount: s.share }));
  if (mode === "weight" || mode === "percent") {
    const shares = splitByWeight(billTotal, payers.map((p) => ({ personId: p.personId, weight: p.weight ?? 0 })));
    return payers.map((p) => ({ personId: p.personId, weight: p.weight, amount: shares.find((s) => s.personId === p.personId)?.share ?? 0 }));
  }
  return payers;
}

// --- Waiter list & bulk pricing -------------------------------------------

export interface WaiterItem {
  key: string;
  name: string;
  quantity: number;
  category: OrderCategory;
  /** Distinct notes with how many units carry each ("بدون پیاز"). */
  notes: { text: string; quantity: number }[];
}

export interface WaiterCategoryGroup {
  category: OrderCategory;
  items: WaiterItem[];
}

/**
 * Aggregates all lines by normalized item name, summing quantities; a shared line counts its own quantity once.
 * An item's category is the first non-"other" category among its lines. Sorted by the fixed category order,
 * then quantity (desc), then name.
 */
export function buildWaiterList(lines: LineInput[]): WaiterItem[] {
  const groups = new Map<string, WaiterItem>();
  for (const line of lines) {
    const key = itemKey(line.itemName);
    if (!key) continue;
    let item = groups.get(key);
    if (!item) {
      item = { key, name: line.itemName.trim(), quantity: 0, category: line.category ?? DEFAULT_ORDER_CATEGORY, notes: [] };
      groups.set(key, item);
    } else if (item.category === DEFAULT_ORDER_CATEGORY && line.category) {
      item.category = line.category;
    }
    item.quantity += line.quantity;
    const note = line.note?.trim();
    if (note) {
      const existing = item.notes.find((n) => itemKey(n.text) === itemKey(note));
      if (existing) existing.quantity += line.quantity;
      else item.notes.push({ text: note, quantity: line.quantity });
    }
  }
  return Array.from(groups.values()).sort(
    (a, b) => categoryRank(a.category) - categoryRank(b.category) || b.quantity - a.quantity || a.name.localeCompare(b.name, "fa")
  );
}

/** Groups a (sorted) waiter list under its category headings in the fixed order; empty categories are omitted. */
export function groupWaiterListByCategory(items: WaiterItem[]): WaiterCategoryGroup[] {
  return ORDER_CATEGORIES.map((category) => ({ category, items: items.filter((item) => item.category === category) })).filter((group) => group.items.length > 0);
}

/** "۳ × کوبیده" */
export function formatWaiterLine(item: WaiterItem): string {
  return `${toPersianDigits(item.quantity)} × ${item.name}`;
}

/** Headings add nothing when every item is uncategorized ("other" only — e.g. pre-GO-1.1 orders), so they are skipped then. */
export function waiterListShowsHeadings(groups: WaiterCategoryGroup[]): boolean {
  return !(groups.length === 1 && groups[0].category === DEFAULT_ORDER_CATEGORY);
}

/** Plain-text waiter list for copy / share: same category headings and order as the on-screen list. */
export function buildWaiterListText(title: string, items: WaiterItem[]): string {
  const groups = groupWaiterListByCategory(items);
  const showHeadings = waiterListShowsHeadings(groups);
  const sections = groups.map((group) => {
    const rows = group.items.flatMap((item) => [
      formatWaiterLine(item),
      ...item.notes.map((n) => `   ↳ ${n.text}${n.quantity !== item.quantity ? ` (${toPersianDigits(n.quantity)})` : ""}`)
    ]);
    return (showHeadings ? [`— ${ORDER_CATEGORY_LABELS[group.category]} —`, ...rows] : rows).join("\n");
  });
  return [title, "", sections.join("\n\n")].join("\n");
}

export interface MissingPriceGroup {
  key: string;
  name: string;
  quantity: number;
  lineCount: number;
}

/** Items that still need a price, grouped by normalized name. Lines of a person who entered a per-person total need no prices. */
export function missingPriceGroups(lines: LineInput[], personTotals: PersonTotalInput[]): MissingPriceGroup[] {
  const totalPersons = new Set(personTotals.map((t) => t.personId));
  const pricedPersons = new Set(lines.filter((l) => l.personId && hasPrice(l)).map((l) => l.personId as string));
  const groups = new Map<string, MissingPriceGroup>();
  for (const line of lines) {
    if (hasPrice(line)) continue;
    if (line.personId && totalPersons.has(line.personId) && !pricedPersons.has(line.personId)) continue;
    const key = itemKey(line.itemName);
    if (!key) continue;
    const group = groups.get(key) ?? { key, name: line.itemName.trim(), quantity: 0, lineCount: 0 };
    group.quantity += line.quantity;
    group.lineCount += 1;
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

/** Bulk pricing: ids of the lines (same normalized name, no price yet) that a price for `itemName` applies to. */
export function bulkPriceLineIds(lines: LineInput[], itemName: string): string[] {
  const key = itemKey(itemName);
  return lines.filter((l) => itemKey(l.itemName) === key && !hasPrice(l)).map((l) => l.id);
}

// --- Finalize ---------------------------------------------------------------

export interface FinalizeCheckInput {
  status: string;
  eventClosed: boolean;
  billTotal: number | null;
  payers: VoucherPayer[];
  computation: SessionComputation;
  /** Names for the "who lacks a price" message. */
  nameOf?: (personId: string) => string;
}

/** Returns every reason finalizing is blocked (empty = ready). */
export function validateFinalize(input: FinalizeCheckInput): string[] {
  const errors: string[] = [];
  const { computation, billTotal } = input;
  if (input.eventClosed) errors.push("این ایونت پایان یافته است.");
  if (input.status !== "pricing") errors.push("نشست باید در مرحله‌ی قیمت‌گذاری باشد.");
  if (computation.bills.length === 0) errors.push("هیچ سفارشی ثبت نشده است.");
  for (const person of computation.persons) {
    if (person.hasLines && !person.computable) {
      errors.push(`مبلغ سفارش «${input.nameOf?.(person.personId) ?? "؟"}» قابل محاسبه نیست؛ قیمت اقلام را کامل کنید.`);
    }
  }
  if (billTotal === null || billTotal <= 0) {
    errors.push("مبلغ نهایی فاکتور را وارد کنید.");
  } else {
    const diff = billTotal - computation.computedTotal;
    if (diff !== 0) errors.push("مبلغ محاسبه‌شده با مبلغ فاکتور برابر نیست؛ اختلاف را برطرف یا به‌صورت یک قلم ثبت کنید.");
    if (input.payers.length === 0) errors.push("پرداخت‌کننده را مشخص کنید.");
    else if (input.payers.reduce((s, p) => s + p.amount, 0) !== billTotal) errors.push("مجموع مبالغ پرداخت‌کنندگان باید برابر مبلغ فاکتور باشد.");
  }
  if (computation.bills.some((b) => b.finalTotal < 0)) errors.push("سهم نهایی یک نفر منفی شده است؛ تخفیف‌ها را بررسی کنید.");
  return errors;
}

/** Builds the voucher's `itemizedSnapshot` from a finished computation. */
export function buildItemizedSnapshot(params: {
  sessionId: string;
  sessionTitle: string;
  restaurant?: string;
  billTotal: number;
  computation: SessionComputation;
}): ItemizedSnapshot {
  const { computation } = params;
  return {
    sessionId: params.sessionId,
    sessionTitle: params.sessionTitle,
    restaurant: params.restaurant,
    billTotal: params.billTotal,
    extras: computation.extras.map((e) => ({
      extraId: e.extraId,
      kind: e.kind,
      label: e.label,
      mode: e.mode,
      value: e.value,
      allocation: e.allocation,
      amount: e.amount
    })),
    people: computation.persons.map((p) => {
      const bill = computation.bills.find((b) => b.personId === p.personId)!;
      return {
        personId: p.personId,
        items: p.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, amount: i.amount })),
        personTotal: p.personTotal,
        sharedItems: p.sharedItems,
        itemsSubtotal: p.subtotal,
        extras: computation.extras.map((e) => ({
          extraId: e.extraId,
          kind: e.kind,
          label: e.label,
          share: bill.extraShares.find((s) => s.extraId === e.extraId)?.share ?? 0
        })),
        finalTotal: bill.finalTotal
      };
    })
  };
}

// --- Display helpers --------------------------------------------------------

export const EXTRA_KIND_LABELS: Record<SessionExtraKind, string> = {
  vat: "مالیات",
  service: "سرویس",
  tip: "انعام",
  discount: "تخفیف",
  other: "سایر"
};

/** Default label for an extra: its kind name plus the percent when percent-based ("مالیات ۱۰٪"). */
export function defaultExtraLabel(kind: SessionExtraKind, mode: SessionExtraMode, value: number): string {
  const base = EXTRA_KIND_LABELS[kind];
  return mode === "percent" && value > 0 ? `${base} ${toPersianDigits(value)}٪` : base;
}

/** "۲ × کباب برگ (۵۰۰٬۰۰۰) = ۱٬۰۰۰٬۰۰۰"; a single unit: "۱ × کوبیده = ۵۰۰٬۰۰۰"; unpriced: "۲ × کوبیده". */
export function formatItemizedItem(item: { name: string; quantity: number; unitPrice: number | null; amount: number }): string {
  if (item.unitPrice === null) return `${toPersianDigits(item.quantity)} × ${item.name}`;
  if (item.quantity === 1) return `۱ × ${item.name} = ${formatAmount(item.amount)}`;
  return `${toPersianDigits(item.quantity)} × ${item.name} (${formatAmount(item.unitPrice)}) = ${formatAmount(item.amount)}`;
}
