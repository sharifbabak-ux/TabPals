/**
 * Group Order repository (docs/PLAN.md "Group Order", Stage GO-1): sessions,
 * quick-menu items, order lines, per-person totals and extras. Every write
 * goes through here so it is logged to the operation log, and every write is
 * rejected once the event is closed (sessions are read-only then) or the
 * session is in a terminal state — enforced here, not only in the UI.
 */
import { isEventClosed } from "@/domain/eventStatus";
import {
  DIFFERENCE_EXTRA_LABEL,
  buildItemizedSnapshot,
  bulkPriceLineIds,
  computeSession,
  recomputePayers,
  validateFinalize
} from "@/domain/groupOrder";
import { canEditLines, canEditSession, validateTransition } from "@/domain/orderSessionState";
import { db } from "../db";
import type {
  Event,
  ExtraAllocation,
  OrderCategory,
  OrderLine,
  OrderLineSource,
  OrderPersonTotal,
  OrderSession,
  OrderSessionStatus,
  SessionExtra,
  SessionExtraKind,
  SessionExtraMode,
  SessionMenuItem,
  SharedParticipant,
  SplitMode,
  Voucher,
  VoucherPayer
} from "../types";
import { DEFAULT_ORDER_CATEGORY, isOrderCategory } from "@/domain/orderCategory";
import { diffFields, logOperation, newBaseFields, touchBaseFields } from "./operationLog";
import { vouchersRepository } from "./vouchersRepository";

const SESSION_LOG_FIELDS: (keyof OrderSession)[] = [
  "eventId",
  "title",
  "restaurant",
  "scheduledAt",
  "status",
  "cancelReason",
  "adminPersonId",
  "deputyPersonId",
  "billTotal",
  "expenseDate",
  "payers",
  "payerSplitMode",
  "voucherId"
];
const MENU_ITEM_LOG_FIELDS: (keyof SessionMenuItem)[] = ["sessionId", "name", "price", "category", "sortOrder", "deleted"];
const LINE_LOG_FIELDS: (keyof OrderLine)[] = [
  "sessionId",
  "personId",
  "sharedParticipants",
  "menuItemId",
  "itemName",
  "category",
  "quantity",
  "unitPrice",
  "note",
  "source",
  "sourceVersion",
  "deleted"
];
const TOTAL_LOG_FIELDS: (keyof OrderPersonTotal)[] = ["sessionId", "personId", "total", "deleted"];
const EXTRA_LOG_FIELDS: (keyof SessionExtra)[] = ["sessionId", "kind", "label", "mode", "value", "allocation", "weights", "deleted"];

/** Why finalizing was refused — one message per unmet condition. */
export class FinalizeBlockedError extends Error {
  constructor(public readonly reasons: string[]) {
    super(reasons.join("\n"));
    this.name = "FinalizeBlockedError";
  }
}

export interface CreateSessionInput {
  eventId: string;
  title: string;
  restaurant?: string;
  /** ISO timestamp. */
  scheduledAt: string;
  menuPhoto?: Blob;
}

export interface UpdateSessionInput {
  title?: string;
  restaurant?: string;
  scheduledAt?: string;
  /** Pass null to remove the photo. */
  menuPhoto?: Blob | null;
  deputyPersonId?: string | null;
  billTotal?: number | null;
  expenseDate?: string;
  payers?: VoucherPayer[];
  payerSplitMode?: SplitMode;
}

export interface MenuItemInput {
  name: string;
  price?: number;
  category?: OrderCategory;
}

export interface OrderLineInput {
  personId: string | null;
  sharedParticipants?: SharedParticipant[];
  menuItemId?: string;
  itemName: string;
  category?: OrderCategory;
  quantity: number;
  unitPrice?: number;
  note?: string;
  source?: OrderLineSource;
  sourceVersion?: number;
}

export interface SessionExtraInput {
  kind: SessionExtraKind;
  label: string;
  mode: SessionExtraMode;
  value: number;
  allocation: ExtraAllocation;
  weights?: { personId: string; weight: number }[];
}

function todayIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function cleanPrice(price: number | undefined | null): number | undefined {
  if (price === undefined || price === null) return undefined;
  if (!Number.isFinite(price) || price < 0) throw new Error("قیمت نامعتبر است");
  return Math.round(price);
}

function cleanCategory(category: OrderCategory | undefined): OrderCategory {
  return isOrderCategory(category) ? category : DEFAULT_ORDER_CATEGORY;
}

async function loadEvent(eventId: string): Promise<Event> {
  const event = await db.events.get(eventId);
  if (!event) throw new Error(`Event ${eventId} not found`);
  return event;
}

/** Loads a session for writing: the event must be open (closed events make sessions read-only). */
async function loadWritableSession(sessionId: string): Promise<{ session: OrderSession; event: Event }> {
  const session = await db.orderSessions.get(sessionId);
  if (!session || session.deleted) throw new Error(`Session ${sessionId} not found`);
  const event = await loadEvent(session.eventId);
  if (isEventClosed(event, new Date())) {
    throw new Error("این ایونت پایان یافته است؛ نشست‌های آن فقط‌خواندنی است.");
  }
  return { session, event };
}

async function loadEditableSession(sessionId: string): Promise<OrderSession> {
  const { session } = await loadWritableSession(sessionId);
  if (!canEditSession(session.status)) throw new Error("این نشست پایان یافته است و قابل ویرایش نیست.");
  return session;
}

async function loadLineEditableSession(sessionId: string, source: OrderLineSource): Promise<OrderSession> {
  const { session } = await loadWritableSession(sessionId);
  if (!canEditLines(session.status, source)) {
    throw new Error(source === "admin-device" ? "در این وضعیت امکان تغییر سفارش‌ها وجود ندارد." : "ثبت سفارش بسته شده است.");
  }
  return session;
}

function normalizeLineInput(input: OrderLineInput): Pick<OrderLine, "personId" | "sharedParticipants" | "itemName" | "category" | "quantity" | "unitPrice" | "note" | "menuItemId"> {
  const itemName = input.itemName.trim();
  if (!itemName) throw new Error("نام قلم را وارد کنید");
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error("تعداد باید عدد صحیح و حداقل ۱ باشد");
  let sharedParticipants: SharedParticipant[] | undefined;
  if (input.personId === null) {
    sharedParticipants = (input.sharedParticipants ?? []).filter((p) => p.weight > 0);
    if (sharedParticipants.length === 0) throw new Error("برای قلم مشترک حداقل یک نفر را انتخاب کنید");
    if (new Set(sharedParticipants.map((p) => p.personId)).size !== sharedParticipants.length) throw new Error("یک نفر نباید دوبار انتخاب شود");
  }
  return {
    personId: input.personId,
    sharedParticipants,
    itemName,
    category: cleanCategory(input.category),
    quantity: input.quantity,
    unitPrice: cleanPrice(input.unitPrice),
    note: input.note?.trim() || undefined,
    menuItemId: input.menuItemId
  };
}

export const orderSessionsRepository = {
  /** Creates a draft session; the admin is the event's treasurer (required). */
  async create(input: CreateSessionInput): Promise<OrderSession> {
    const title = input.title.trim();
    if (!title) throw new Error("عنوان نشست را وارد کنید");
    return db.transaction("rw", db.events, db.orderSessions, db.operations, async () => {
      const event = await loadEvent(input.eventId);
      if (isEventClosed(event, new Date())) throw new Error("این ایونت پایان یافته است و امکان ایجاد نشست جدید وجود ندارد.");
      if (!event.treasurerPersonId) throw new Error("برای ایجاد نشست، ابتدا مسئول صندوق ایونت را تعیین کنید.");
      const session: OrderSession = {
        ...newBaseFields(),
        eventId: input.eventId,
        title,
        restaurant: input.restaurant?.trim() || undefined,
        scheduledAt: input.scheduledAt,
        status: "draft",
        menuPhoto: input.menuPhoto,
        adminPersonId: event.treasurerPersonId,
        deputyPersonId: null,
        billTotal: null,
        expenseDate: todayIso(new Date(input.scheduledAt)),
        payers: [],
        voucherId: null
      };
      await db.orderSessions.add(session);
      await logOperation(db, "orderSessions", session.id, "create", diffFields(undefined, session, SESSION_LOG_FIELDS));
      return session;
    });
  },

  async update(sessionId: string, input: UpdateSessionInput): Promise<void> {
    await db.transaction("rw", db.events, db.orderSessions, db.operations, async () => {
      const existing = await loadEditableSession(sessionId);
      const updated: OrderSession = { ...existing, ...touchBaseFields(existing) };
      if (input.title !== undefined) {
        const title = input.title.trim();
        if (!title) throw new Error("عنوان نشست را وارد کنید");
        updated.title = title;
      }
      if (input.restaurant !== undefined) updated.restaurant = input.restaurant.trim() || undefined;
      if (input.scheduledAt !== undefined) updated.scheduledAt = input.scheduledAt;
      if (input.menuPhoto !== undefined) updated.menuPhoto = input.menuPhoto ?? undefined;
      if (input.deputyPersonId !== undefined) updated.deputyPersonId = input.deputyPersonId;
      if (input.billTotal !== undefined) {
        if (input.billTotal !== null && (!Number.isInteger(input.billTotal) || input.billTotal < 0)) throw new Error("مبلغ فاکتور نامعتبر است");
        updated.billTotal = input.billTotal;
      }
      if (input.expenseDate !== undefined) updated.expenseDate = input.expenseDate;
      if (input.payers !== undefined) updated.payers = input.payers;
      if (input.payerSplitMode !== undefined) updated.payerSplitMode = input.payerSplitMode;
      const diff = diffFields(existing, updated, SESSION_LOG_FIELDS);
      const photoChanged = input.menuPhoto !== undefined && existing.menuPhoto !== updated.menuPhoto;
      if (Object.keys(diff).length === 0 && !photoChanged) return;
      await db.orderSessions.put(updated);
      await logOperation(db, "orderSessions", sessionId, "update", {
        ...diff,
        ...(photoChanged ? { menuPhoto: { before: Boolean(existing.menuPhoto), after: Boolean(updated.menuPhoto) } } : {})
      });
    });
  },

  /** Moves the session along the state machine; cancelling needs a reason. Finalizing goes through `finalize`. */
  async transition(sessionId: string, to: OrderSessionStatus, cancelReason?: string): Promise<void> {
    if (to === "finalized") throw new Error("برای نهایی کردن از «نهایی و ثبت سند» استفاده کنید.");
    await db.transaction("rw", db.events, db.orderSessions, db.operations, async () => {
      const { session: existing } = await loadWritableSession(sessionId);
      const error = validateTransition(existing.status, to, cancelReason);
      if (error) throw new Error(error);
      const updated: OrderSession = {
        ...existing,
        status: to,
        cancelReason: to === "cancelled" ? (cancelReason ?? "").trim() : existing.cancelReason,
        ...touchBaseFields(existing)
      };
      await db.orderSessions.put(updated);
      await logOperation(db, "orderSessions", sessionId, to === "cancelled" ? "cancel" : "update", diffFields(existing, updated, SESSION_LOG_FIELDS));
    });
  },

  /**
   * Finalizes a priced session: validates everything, creates ONE expense
   * voucher (shares = each person's final total, splitMode "itemized"),
   * links it to the session and sets status "finalized" — atomically.
   */
  async finalize(sessionId: string): Promise<Voucher> {
    return db.transaction(
      "rw",
      [db.events, db.vouchers, db.orderSessions, db.orderLines, db.orderPersonTotals, db.sessionExtras, db.operations],
      async () => {
        const { session, event } = await loadWritableSession(sessionId);
        const lines = (await db.orderLines.where("sessionId").equals(sessionId).filter((l) => !l.deleted).toArray()) as OrderLine[];
        const totals = await db.orderPersonTotals.where("sessionId").equals(sessionId).filter((t) => !t.deleted).toArray();
        const extras = await db.sessionExtras.where("sessionId").equals(sessionId).filter((e) => !e.deleted).toArray();

        let computation;
        try {
          computation = computeSession(lines, totals, extras);
        } catch (e) {
          throw new FinalizeBlockedError([e instanceof Error ? e.message : "محاسبه ناموفق بود"]);
        }
        const billTotal = session.billTotal;
        const payers = billTotal !== null ? recomputePayers(billTotal, session.payers, session.payerSplitMode) : session.payers;
        const reasons = validateFinalize({
          status: session.status,
          eventClosed: isEventClosed(event, new Date()),
          billTotal,
          payers,
          computation
        });
        if (reasons.length > 0 || billTotal === null) throw new FinalizeBlockedError(reasons);

        const voucher = await vouchersRepository.createItemizedExpense({
          eventId: session.eventId,
          expenseDate: session.expenseDate,
          description: session.restaurant ? `${session.title} – ${session.restaurant}` : session.title,
          totalAmount: billTotal,
          payers,
          payerSplitMode: session.payers.length > 1 ? session.payerSplitMode : undefined,
          shares: computation.bills.map((b) => ({ personId: b.personId, share: b.finalTotal })),
          itemizedSnapshot: buildItemizedSnapshot({
            sessionId,
            sessionTitle: session.title,
            restaurant: session.restaurant,
            billTotal,
            computation
          })
        });

        const updated: OrderSession = { ...session, status: "finalized", voucherId: voucher.id, payers, ...touchBaseFields(session) };
        await db.orderSessions.put(updated);
        await logOperation(db, "orderSessions", sessionId, "finalize", diffFields(session, updated, SESSION_LOG_FIELDS));
        return voucher;
      }
    );
  },

  // --- Quick menu -----------------------------------------------------------

  async addMenuItem(sessionId: string, input: MenuItemInput): Promise<SessionMenuItem> {
    const name = input.name.trim();
    if (!name) throw new Error("نام قلم را وارد کنید");
    return db.transaction("rw", db.events, db.orderSessions, db.sessionMenuItems, db.operations, async () => {
      await loadEditableSession(sessionId);
      const siblings = await db.sessionMenuItems.where("sessionId").equals(sessionId).filter((i) => !i.deleted).toArray();
      const item: SessionMenuItem = {
        ...newBaseFields(),
        sessionId,
        name,
        price: cleanPrice(input.price),
        category: cleanCategory(input.category),
        sortOrder: siblings.reduce((max, i) => Math.max(max, i.sortOrder), -1) + 1
      };
      await db.sessionMenuItems.add(item);
      await logOperation(db, "sessionMenuItems", item.id, "create", diffFields(undefined, item, MENU_ITEM_LOG_FIELDS));
      return item;
    });
  },

  async updateMenuItem(itemId: string, input: Partial<MenuItemInput>): Promise<void> {
    await db.transaction("rw", db.events, db.orderSessions, db.sessionMenuItems, db.operations, async () => {
      const existing = await db.sessionMenuItems.get(itemId);
      if (!existing || existing.deleted) throw new Error("قلم منو پیدا نشد");
      await loadEditableSession(existing.sessionId);
      const updated: SessionMenuItem = { ...existing, ...touchBaseFields(existing) };
      if (input.name !== undefined) {
        const name = input.name.trim();
        if (!name) throw new Error("نام قلم را وارد کنید");
        updated.name = name;
      }
      if ("price" in input) updated.price = cleanPrice(input.price);
      if (input.category !== undefined) updated.category = cleanCategory(input.category);
      const diff = diffFields(existing, updated, MENU_ITEM_LOG_FIELDS);
      if (Object.keys(diff).length === 0) return;
      await db.sessionMenuItems.put(updated);
      await logOperation(db, "sessionMenuItems", itemId, "update", diff);
    });
  },

  async removeMenuItem(itemId: string): Promise<void> {
    await db.transaction("rw", db.events, db.orderSessions, db.sessionMenuItems, db.operations, async () => {
      const existing = await db.sessionMenuItems.get(itemId);
      if (!existing || existing.deleted) return;
      await loadEditableSession(existing.sessionId);
      const updated: SessionMenuItem = { ...existing, deleted: true, ...touchBaseFields(existing) };
      await db.sessionMenuItems.put(updated);
      await logOperation(db, "sessionMenuItems", itemId, "delete", diffFields(existing, updated, MENU_ITEM_LOG_FIELDS));
    });
  },

  /** Rewrites sortOrder to match `orderedItemIds`. */
  async reorderMenuItems(sessionId: string, orderedItemIds: string[]): Promise<void> {
    await db.transaction("rw", db.events, db.orderSessions, db.sessionMenuItems, db.operations, async () => {
      await loadEditableSession(sessionId);
      for (let i = 0; i < orderedItemIds.length; i++) {
        const existing = await db.sessionMenuItems.get(orderedItemIds[i]);
        if (!existing || existing.sessionId !== sessionId || existing.sortOrder === i) continue;
        const updated: SessionMenuItem = { ...existing, sortOrder: i, ...touchBaseFields(existing) };
        await db.sessionMenuItems.put(updated);
        await logOperation(db, "sessionMenuItems", existing.id, "update", diffFields(existing, updated, MENU_ITEM_LOG_FIELDS));
      }
    });
  },

  // --- Order lines ------------------------------------------------------------

  async addLine(sessionId: string, input: OrderLineInput): Promise<OrderLine> {
    const source = input.source ?? "admin-device";
    const normalized = normalizeLineInput(input);
    return db.transaction("rw", db.events, db.orderSessions, db.orderLines, db.operations, async () => {
      await loadLineEditableSession(sessionId, source);
      const line: OrderLine = { ...newBaseFields(), sessionId, ...normalized, source, sourceVersion: input.sourceVersion ?? 1 };
      await db.orderLines.add(line);
      await logOperation(db, "orderLines", line.id, "create", diffFields(undefined, line, LINE_LOG_FIELDS));
      return line;
    });
  },

  async updateLine(lineId: string, patch: Partial<Pick<OrderLineInput, "itemName" | "category" | "quantity" | "note" | "sharedParticipants">> & { unitPrice?: number | null }): Promise<void> {
    await db.transaction("rw", db.events, db.orderSessions, db.orderLines, db.operations, async () => {
      const existing = await db.orderLines.get(lineId);
      if (!existing || existing.deleted) throw new Error("قلم سفارش پیدا نشد");
      await loadLineEditableSession(existing.sessionId, "admin-device");
      const merged = normalizeLineInput({
        personId: existing.personId,
        sharedParticipants: patch.sharedParticipants ?? existing.sharedParticipants,
        itemName: patch.itemName ?? existing.itemName,
        category: patch.category ?? existing.category,
        quantity: patch.quantity ?? existing.quantity,
        unitPrice: "unitPrice" in patch ? (patch.unitPrice ?? undefined) : existing.unitPrice,
        note: "note" in patch ? patch.note : existing.note,
        menuItemId: existing.menuItemId
      });
      const updated: OrderLine = { ...existing, ...merged, ...touchBaseFields(existing) };
      const diff = diffFields(existing, updated, LINE_LOG_FIELDS);
      if (Object.keys(diff).length === 0) return;
      await db.orderLines.put(updated);
      await logOperation(db, "orderLines", lineId, "update", diff);
    });
  },

  async removeLine(lineId: string): Promise<void> {
    await db.transaction("rw", db.events, db.orderSessions, db.orderLines, db.operations, async () => {
      const existing = await db.orderLines.get(lineId);
      if (!existing || existing.deleted) return;
      await loadLineEditableSession(existing.sessionId, "admin-device");
      const updated: OrderLine = { ...existing, deleted: true, ...touchBaseFields(existing) };
      await db.orderLines.put(updated);
      await logOperation(db, "orderLines", lineId, "delete", diffFields(existing, updated, LINE_LOG_FIELDS));
    });
  },

  /** Bulk pricing: gives `price` to every line of that (normalized) item name that has none yet. Returns how many lines were priced. */
  async applyBulkPrice(sessionId: string, itemName: string, price: number): Promise<number> {
    const cleaned = cleanPrice(price);
    if (cleaned === undefined) throw new Error("قیمت را وارد کنید");
    return db.transaction("rw", db.events, db.orderSessions, db.orderLines, db.operations, async () => {
      await loadLineEditableSession(sessionId, "admin-device");
      const lines = await db.orderLines.where("sessionId").equals(sessionId).filter((l) => !l.deleted).toArray();
      const ids = bulkPriceLineIds(lines, itemName);
      for (const id of ids) {
        const existing = lines.find((l) => l.id === id)!;
        const updated: OrderLine = { ...existing, unitPrice: cleaned, ...touchBaseFields(existing) };
        await db.orderLines.put(updated);
        await logOperation(db, "orderLines", id, "update", diffFields(existing, updated, LINE_LOG_FIELDS));
      }
      return ids.length;
    });
  },

  // --- Per-person totals --------------------------------------------------------

  /** Sets (or, with null, clears) a person's optional "جمع سفارش این نفر". */
  async setPersonTotal(sessionId: string, personId: string, total: number | null): Promise<void> {
    await db.transaction("rw", db.events, db.orderSessions, db.orderPersonTotals, db.operations, async () => {
      await loadLineEditableSession(sessionId, "admin-device");
      const existing = await db.orderPersonTotals.where("[sessionId+personId]").equals([sessionId, personId]).first();
      if (total === null) {
        if (!existing || existing.deleted) return;
        const removed: OrderPersonTotal = { ...existing, deleted: true, ...touchBaseFields(existing) };
        await db.orderPersonTotals.put(removed);
        await logOperation(db, "orderPersonTotals", existing.id, "delete", diffFields(existing, removed, TOTAL_LOG_FIELDS));
        return;
      }
      if (!Number.isInteger(total) || total < 0) throw new Error("مبلغ نامعتبر است");
      if (existing) {
        const updated: OrderPersonTotal = { ...existing, total, deleted: false, ...touchBaseFields(existing) };
        const diff = diffFields(existing, updated, TOTAL_LOG_FIELDS);
        if (Object.keys(diff).length === 0) return;
        await db.orderPersonTotals.put(updated);
        await logOperation(db, "orderPersonTotals", existing.id, "update", diff);
      } else {
        const record: OrderPersonTotal = { ...newBaseFields(), sessionId, personId, total };
        await db.orderPersonTotals.add(record);
        await logOperation(db, "orderPersonTotals", record.id, "create", diffFields(undefined, record, TOTAL_LOG_FIELDS));
      }
    });
  },

  // --- Extras -----------------------------------------------------------------

  async addExtra(sessionId: string, input: SessionExtraInput): Promise<SessionExtra> {
    const label = input.label.trim();
    if (!label) throw new Error("عنوان را وارد کنید");
    if (!Number.isFinite(input.value)) throw new Error("مقدار نامعتبر است");
    return db.transaction("rw", db.events, db.orderSessions, db.sessionExtras, db.operations, async () => {
      await loadEditableSession(sessionId);
      const extra: SessionExtra = {
        ...newBaseFields(),
        sessionId,
        kind: input.kind,
        label,
        mode: input.mode,
        value: input.value,
        allocation: input.allocation,
        weights: input.allocation === "weight" ? input.weights : undefined
      };
      await db.sessionExtras.add(extra);
      await logOperation(db, "sessionExtras", extra.id, "create", diffFields(undefined, extra, EXTRA_LOG_FIELDS));
      return extra;
    });
  },

  async updateExtra(extraId: string, input: Partial<SessionExtraInput>): Promise<void> {
    await db.transaction("rw", db.events, db.orderSessions, db.sessionExtras, db.operations, async () => {
      const existing = await db.sessionExtras.get(extraId);
      if (!existing || existing.deleted) throw new Error("قلم هزینه پیدا نشد");
      await loadEditableSession(existing.sessionId);
      const updated: SessionExtra = { ...existing, ...input, ...touchBaseFields(existing) };
      updated.label = updated.label.trim();
      if (!updated.label) throw new Error("عنوان را وارد کنید");
      if (updated.allocation !== "weight") updated.weights = undefined;
      const diff = diffFields(existing, updated, EXTRA_LOG_FIELDS);
      if (Object.keys(diff).length === 0) return;
      await db.sessionExtras.put(updated);
      await logOperation(db, "sessionExtras", extraId, "update", diff);
    });
  },

  async removeExtra(extraId: string): Promise<void> {
    await db.transaction("rw", db.events, db.orderSessions, db.sessionExtras, db.operations, async () => {
      const existing = await db.sessionExtras.get(extraId);
      if (!existing || existing.deleted) return;
      await loadEditableSession(existing.sessionId);
      const updated: SessionExtra = { ...existing, deleted: true, ...touchBaseFields(existing) };
      await db.sessionExtras.put(updated);
      await logOperation(db, "sessionExtras", extraId, "delete", diffFields(existing, updated, EXTRA_LOG_FIELDS));
    });
  },

  /**
   * Reconciliation option (b): stores (or refreshes) the "اختلاف فاکتور" extra
   * so the computed total absorbs `difference` with the chosen allocation.
   * `difference` is bill total − computed total WITHOUT any previous
   * difference extra; pass 0 to remove it.
   */
  async setDifferenceExtra(sessionId: string, difference: number, allocation: ExtraAllocation, weights?: { personId: string; weight: number }[]): Promise<void> {
    const existing = (await db.sessionExtras.where("sessionId").equals(sessionId).filter((e) => !e.deleted && e.kind === "other" && e.label === DIFFERENCE_EXTRA_LABEL).first()) ?? null;
    if (difference === 0) {
      if (existing) await this.removeExtra(existing.id);
      return;
    }
    const input: SessionExtraInput = { kind: "other", label: DIFFERENCE_EXTRA_LABEL, mode: "amount", value: difference, allocation, weights };
    if (existing) await this.updateExtra(existing.id, input);
    else await this.addExtra(sessionId, input);
  }
};
