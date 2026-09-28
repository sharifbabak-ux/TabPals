/**
 * Pure per-event balance calculation (docs/PLAN.md #7, Stage 2 task
 * description part C). Takes plain voucher-shaped data (not a Dexie
 * record) so it stays independent of the data layer.
 *
 * - expense: each payer +paid, each participant -share.
 * - contribution (A gives to treasurer T): A +x, T -x.
 * - settlement (A pays B): A +x, B -x.
 *
 * Both contribution and settlement reduce to the same "transfer" shape:
 * the `from` person's paid total goes up by the amount, the `to`
 * person's share total goes up by the amount (which lowers their
 * balance). Because every voucher's paid-additions equal its
 * share-additions in total, the sum of all balances is always zero.
 */

export type BalanceVoucherType = "expense" | "contribution" | "settlement";

export interface BalanceVoucher {
  type: BalanceVoucherType;
  status: "active" | "void";
  /** Total amount of the voucher (payers' sum for expense, transfer amount for contribution/settlement). */
  totalAmount: number;
  /** expense only: who physically paid, and how much. */
  payers?: { personId: string; amount: number }[];
  /** expense only: computed per-participant shares (must sum to totalAmount). */
  shares?: { personId: string; share: number }[];
  /** contribution/settlement only: who the money moves from. */
  fromPersonId?: string;
  /** contribution/settlement only: who the money moves to. */
  toPersonId?: string;
}

export interface MemberBalance {
  personId: string;
  totalPaid: number;
  totalShare: number;
  /** totalPaid - totalShare. Positive = creditor (owed money), negative = debtor. */
  balance: number;
}

/** Computes paid/share/balance for every given member person id across the event's active vouchers. */
export function computeBalances(memberPersonIds: string[], vouchers: BalanceVoucher[]): MemberBalance[] {
  const paid = new Map<string, number>(memberPersonIds.map((id) => [id, 0]));
  const share = new Map<string, number>(memberPersonIds.map((id) => [id, 0]));

  const addPaid = (personId: string, amount: number) => paid.set(personId, (paid.get(personId) ?? 0) + amount);
  const addShare = (personId: string, amount: number) => share.set(personId, (share.get(personId) ?? 0) + amount);

  for (const voucher of vouchers) {
    if (voucher.status !== "active") continue;

    if (voucher.type === "expense") {
      for (const payer of voucher.payers ?? []) addPaid(payer.personId, payer.amount);
      for (const s of voucher.shares ?? []) addShare(s.personId, s.share);
    } else {
      if (voucher.fromPersonId) addPaid(voucher.fromPersonId, voucher.totalAmount);
      if (voucher.toPersonId) addShare(voucher.toPersonId, voucher.totalAmount);
    }
  }

  return memberPersonIds.map((personId) => {
    const totalPaid = paid.get(personId) ?? 0;
    const totalShare = share.get(personId) ?? 0;
    return { personId, totalPaid, totalShare, balance: totalPaid - totalShare };
  });
}
