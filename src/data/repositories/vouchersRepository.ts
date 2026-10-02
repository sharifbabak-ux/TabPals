import { isEventClosed } from "@/domain/eventStatus";
import { amountsSumTo, percentsSumTo100, sharesFromExactAmounts, splitByWeight, splitEqual } from "@/domain/splitEngine";
import { db } from "../db";
import type { ItemizedSnapshot, SplitMode, Voucher, VoucherParticipant, VoucherPayer, VoucherShare } from "../types";
import { diffFields, logOperation, newBaseFields } from "./operationLog";

const VOUCHER_LOG_FIELDS: (keyof Voucher)[] = [
  "eventId",
  "number",
  "type",
  "expenseDate",
  "description",
  "totalAmount",
  "payers",
  "participants",
  "fromPersonId",
  "toPersonId",
  "shares",
  "status",
  "splitMode",
  "payerSplitMode",
  "itemizedSnapshot"
];

/** Maps a caller's chosen split mode to the stored, statement-facing SplitMode (docs/PLAN.md Stage 3B). */
const SPLIT_MODE_BY_INPUT_MODE: Record<ExpenseSplit["mode"], SplitMode> = {
  equal_all: "equal",
  equal_selected: "equal",
  weight: "weight",
  percent: "percent",
  exact: "exact"
};

export interface PayerEqualSplit {
  mode: "equal";
  payerPersonIds: string[];
}
export interface PayerWeightSplit {
  mode: "weight";
  weights: { personId: string; weight: number }[];
}
export interface PayerPercentSplit {
  mode: "percent";
  percents: { personId: string; percent: number }[];
}
export interface PayerExactSplit {
  mode: "exact";
  amounts: { personId: string; amount: number }[];
}
/** How a multi-payer expense's payer amounts are derived from the total (docs/PLAN.md Stage 3B.1) — reuses the same split engine as the participant share split, with the same exact-sum rounding guarantee. */
export type PayerSplit = PayerEqualSplit | PayerWeightSplit | PayerPercentSplit | PayerExactSplit;

export interface EqualAllSplit {
  mode: "equal_all";
}
export interface EqualSelectedSplit {
  mode: "equal_selected";
  participantPersonIds: string[];
}
export interface WeightSplit {
  mode: "weight";
  weights: { personId: string; weight: number }[];
}
export interface PercentSplit {
  mode: "percent";
  percents: { personId: string; percent: number }[];
}
export interface ExactSplit {
  mode: "exact";
  amounts: { personId: string; amount: number }[];
}
export type ExpenseSplit = EqualAllSplit | EqualSelectedSplit | WeightSplit | PercentSplit | ExactSplit;

export interface CreateExpenseInput {
  eventId: string;
  expenseDate: string;
  description: string;
  totalAmount: number;
  /** Used as-is (validated to sum to totalAmount) when `payerSplit` is omitted — the single-payer case, or a precomputed multi-payer list. */
  payers: VoucherPayer[];
  /** When provided, `payers` is ignored and the payer amounts are derived from this split instead (docs/PLAN.md Stage 3B.1 multi-payer entry). */
  payerSplit?: PayerSplit;
  split: ExpenseSplit;
}

function computePayerSplit(totalAmount: number, split: PayerSplit): { payers: VoucherPayer[]; payerSplitMode: SplitMode } {
  switch (split.mode) {
    case "equal": {
      if (split.payerPersonIds.length === 0) throw new Error("حداقل یک پرداخت‌کننده باید انتخاب شود");
      const shares = splitEqual(totalAmount, split.payerPersonIds);
      return { payers: shares.map((s) => ({ personId: s.personId, amount: s.share })), payerSplitMode: "equal" };
    }
    case "weight": {
      if (split.weights.length === 0) throw new Error("حداقل یک پرداخت‌کننده باید انتخاب شود");
      const shares = splitByWeight(totalAmount, split.weights);
      const weightByPerson = new Map(split.weights.map((w) => [w.personId, w.weight]));
      return {
        payers: shares.map((s) => ({ personId: s.personId, amount: s.share, weight: weightByPerson.get(s.personId) })),
        payerSplitMode: "weight"
      };
    }
    case "percent": {
      if (split.percents.length === 0) throw new Error("حداقل یک پرداخت‌کننده باید انتخاب شود");
      if (!percentsSumTo100(split.percents.map((p) => p.percent))) {
        throw new Error("مجموع درصدها باید ۱۰۰ باشد");
      }
      const shares = splitByWeight(totalAmount, split.percents.map((p) => ({ personId: p.personId, weight: p.percent })));
      const percentByPerson = new Map(split.percents.map((p) => [p.personId, p.percent]));
      return {
        payers: shares.map((s) => ({ personId: s.personId, amount: s.share, weight: percentByPerson.get(s.personId) })),
        payerSplitMode: "percent"
      };
    }
    case "exact": {
      if (split.amounts.length === 0) throw new Error("حداقل یک پرداخت‌کننده باید انتخاب شود");
      if (!amountsSumTo(totalAmount, split.amounts.map((a) => a.amount))) {
        throw new Error("مجموع مبالغ پرداخت‌کنندگان باید برابر مبلغ کل باشد");
      }
      return { payers: split.amounts.map((a) => ({ personId: a.personId, amount: a.amount })), payerSplitMode: "exact" };
    }
  }
}

/** A finalized group order (docs/PLAN.md "Group Order"): shares are each person's final total; the snapshot freezes their items and extra shares. */
export interface CreateItemizedExpenseInput {
  eventId: string;
  expenseDate: string;
  description: string;
  totalAmount: number;
  payers: VoucherPayer[];
  payerSplitMode?: SplitMode;
  shares: VoucherShare[];
  itemizedSnapshot: ItemizedSnapshot;
}

export interface CreateTransferInput {
  eventId: string;
  expenseDate: string;
  description: string;
  totalAmount: number;
  fromPersonId: string;
  toPersonId: string;
}

/** Contributions always go to the event's treasurer, so the caller only picks who is giving. */
export interface CreateContributionInput {
  eventId: string;
  expenseDate: string;
  description: string;
  totalAmount: number;
  fromPersonId: string;
}

function computeExpenseSplit(
  totalAmount: number,
  split: ExpenseSplit,
  activeMemberPersonIds: string[]
): { participants: VoucherParticipant[]; shares: VoucherShare[] } {
  switch (split.mode) {
    case "equal_all": {
      if (activeMemberPersonIds.length === 0) throw new Error("این ایونت عضو فعالی ندارد");
      return {
        participants: activeMemberPersonIds.map((personId) => ({ personId, weight: 1 })),
        shares: splitEqual(totalAmount, activeMemberPersonIds)
      };
    }
    case "equal_selected": {
      if (split.participantPersonIds.length === 0) throw new Error("حداقل یک نفر باید انتخاب شود");
      return {
        participants: split.participantPersonIds.map((personId) => ({ personId, weight: 1 })),
        shares: splitEqual(totalAmount, split.participantPersonIds)
      };
    }
    case "weight": {
      if (split.weights.length === 0) throw new Error("حداقل یک نفر باید انتخاب شود");
      return {
        participants: split.weights.map((w) => ({ personId: w.personId, weight: w.weight })),
        shares: splitByWeight(totalAmount, split.weights)
      };
    }
    case "percent": {
      if (split.percents.length === 0) throw new Error("حداقل یک نفر باید انتخاب شود");
      if (!percentsSumTo100(split.percents.map((p) => p.percent))) {
        throw new Error("مجموع درصدها باید ۱۰۰ باشد");
      }
      return {
        participants: split.percents.map((p) => ({ personId: p.personId, weight: p.percent })),
        shares: splitByWeight(totalAmount, split.percents.map((p) => ({ personId: p.personId, weight: p.percent })))
      };
    }
    case "exact": {
      if (split.amounts.length === 0) throw new Error("حداقل یک نفر باید انتخاب شود");
      if (!amountsSumTo(totalAmount, split.amounts.map((a) => a.amount))) {
        throw new Error("مجموع مبالغ باید برابر مبلغ کل باشد");
      }
      return {
        participants: split.amounts.map((a) => ({ personId: a.personId, weight: a.amount })),
        shares: sharesFromExactAmounts(split.amounts)
      };
    }
  }
}

async function nextVoucherNumber(eventId: string): Promise<number> {
  const vouchers = await db.vouchers.where("eventId").equals(eventId).toArray();
  return vouchers.reduce((max, v) => Math.max(max, v.number), 0) + 1;
}

/** Blocks creating a voucher in a closed event — enforced here, not only in the UI (see CLAUDE.md). */
async function assertEventOpenForNewVoucher(eventId: string): Promise<void> {
  const event = await db.events.get(eventId);
  if (!event) throw new Error(`Event ${eventId} not found`);
  if (isEventClosed(event, new Date())) {
    throw new Error("این ایونت پایان یافته است و امکان ثبت سند جدید وجود ندارد.");
  }
}

export const vouchersRepository = {
  async createExpense(input: CreateExpenseInput): Promise<Voucher> {
    let payers: VoucherPayer[];
    let payerSplitMode: SplitMode | undefined;
    if (input.payerSplit) {
      const computed = computePayerSplit(input.totalAmount, input.payerSplit);
      payers = computed.payers;
      payerSplitMode = computed.payerSplitMode;
    } else {
      if (!amountsSumTo(input.totalAmount, input.payers.map((p) => p.amount))) {
        throw new Error("مجموع مبلغ پرداخت‌کنندگان باید برابر مبلغ کل باشد");
      }
      payers = input.payers;
      payerSplitMode = input.payers.length > 1 ? "exact" : undefined;
    }

    return db.transaction("rw", db.events, db.eventMembers, db.vouchers, db.operations, async () => {
      await assertEventOpenForNewVoucher(input.eventId);

      let activeMemberPersonIds: string[] = [];
      if (input.split.mode === "equal_all") {
        activeMemberPersonIds = (
          await db.eventMembers
            .where("eventId")
            .equals(input.eventId)
            .filter((m) => !m.deleted && m.active)
            .toArray()
        ).map((m) => m.personId);
      }

      const { participants, shares } = computeExpenseSplit(input.totalAmount, input.split, activeMemberPersonIds);
      const number = await nextVoucherNumber(input.eventId);
      const now = new Date().toISOString();

      const voucher: Voucher = {
        ...newBaseFields(),
        eventId: input.eventId,
        number,
        type: "expense",
        recordedAt: now,
        expenseDate: input.expenseDate,
        description: input.description.trim(),
        totalAmount: input.totalAmount,
        payers,
        participants,
        shares,
        status: "active",
        splitMode: SPLIT_MODE_BY_INPUT_MODE[input.split.mode],
        payerSplitMode
      };

      await db.vouchers.add(voucher);
      await logOperation(db, "vouchers", voucher.id, "create", diffFields(undefined, voucher, VOUCHER_LOG_FIELDS));
      return voucher;
    });
  },

  /**
   * The voucher a finalized group-order session produces. Validates that
   * payers and shares both sum exactly to the total. Runs in its own
   * transaction, which joins an enclosing one (the session finalize) when
   * called from inside it.
   */
  async createItemizedExpense(input: CreateItemizedExpenseInput): Promise<Voucher> {
    if (!amountsSumTo(input.totalAmount, input.payers.map((p) => p.amount))) {
      throw new Error("مجموع مبلغ پرداخت‌کنندگان باید برابر مبلغ کل باشد");
    }
    if (!amountsSumTo(input.totalAmount, input.shares.map((s) => s.share))) {
      throw new Error("مجموع سهم‌ها باید برابر مبلغ کل باشد");
    }
    return db.transaction("rw", db.events, db.vouchers, db.operations, async () => {
      await assertEventOpenForNewVoucher(input.eventId);
      const voucher: Voucher = {
        ...newBaseFields(),
        eventId: input.eventId,
        number: await nextVoucherNumber(input.eventId),
        type: "expense",
        recordedAt: new Date().toISOString(),
        expenseDate: input.expenseDate,
        description: input.description.trim(),
        totalAmount: input.totalAmount,
        payers: input.payers,
        participants: input.shares.map((s) => ({ personId: s.personId, weight: s.share })),
        shares: input.shares,
        status: "active",
        splitMode: "itemized",
        payerSplitMode: input.payers.length > 1 ? (input.payerSplitMode ?? "exact") : undefined,
        itemizedSnapshot: input.itemizedSnapshot
      };
      await db.vouchers.add(voucher);
      await logOperation(db, "vouchers", voucher.id, "create", diffFields(undefined, voucher, VOUCHER_LOG_FIELDS));
      return voucher;
    });
  },

  /** Contribution to the treasurer. Resolves toPersonId from event.treasurerPersonId — never caller-supplied. */
  async createContribution(input: CreateContributionInput): Promise<Voucher> {
    const event = await db.events.get(input.eventId);
    if (!event) throw new Error(`Event ${input.eventId} not found`);
    if (!event.treasurerPersonId) throw new Error("برای این ایونت مسئول صندوق تعیین نشده است.");
    return createTransfer({ ...input, toPersonId: event.treasurerPersonId }, "contribution");
  },

  async createSettlement(input: CreateTransferInput): Promise<Voucher> {
    return createTransfer(input, "settlement");
  }
};

async function createTransfer(input: CreateTransferInput, type: "contribution" | "settlement"): Promise<Voucher> {
  if (input.fromPersonId === input.toPersonId) {
    throw new Error("گیرنده و پرداخت‌کننده نمی‌توانند یک نفر باشند");
  }

  return db.transaction("rw", db.events, db.vouchers, db.operations, async () => {
    await assertEventOpenForNewVoucher(input.eventId);

    const number = await nextVoucherNumber(input.eventId);
    const now = new Date().toISOString();

    const voucher: Voucher = {
      ...newBaseFields(),
      eventId: input.eventId,
      number,
      type,
      recordedAt: now,
      expenseDate: input.expenseDate,
      description: input.description.trim(),
      totalAmount: input.totalAmount,
      payers: [],
      participants: [],
      fromPersonId: input.fromPersonId,
      toPersonId: input.toPersonId,
      shares: [],
      status: "active"
    };

    await db.vouchers.add(voucher);
    await logOperation(db, "vouchers", voucher.id, "create", diffFields(undefined, voucher, VOUCHER_LOG_FIELDS));
    return voucher;
  });
}
