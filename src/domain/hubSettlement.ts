/**
 * Treasurer-hub settlement (docs/PLAN.md Stage 3B "وظایف تسویه‌ی صندوق").
 * Instead of a minimum-transfer graph among all members, every debtor
 * pays the treasurer and the treasurer pays every creditor — simple to
 * follow and matches how the treasurer already holds the fund.
 */

export interface HubSettlementBalance {
  personId: string;
  /** Same sign convention as MemberBalance: positive = creditor, negative = debtor. */
  balance: number;
}

export interface HubSettlementTransfer {
  fromPersonId: string;
  toPersonId: string;
  amount: number;
}

export interface HubSettlementPlan {
  /** One transfer per non-treasurer debtor (to the treasurer), then one per non-treasurer creditor (from the treasurer). */
  transfers: HubSettlementTransfer[];
  totalCollected: number;
  totalPaidOut: number;
}

/**
 * Builds the settlement plan. `balances` must include every member's
 * balance, including the treasurer's own — the treasurer is skipped as a
 * counterparty (never pays/collects from themselves) but their balance is
 * still what makes `totalCollected - totalPaidOut` equal it, since all
 * balances sum to zero (see balanceEngine.ts).
 */
export function computeHubSettlement(balances: HubSettlementBalance[], treasurerPersonId: string): HubSettlementPlan {
  const transfers: HubSettlementTransfer[] = [];
  let totalCollected = 0;
  let totalPaidOut = 0;

  for (const member of balances) {
    if (member.personId === treasurerPersonId || member.balance === 0) continue;

    if (member.balance < 0) {
      const amount = -member.balance;
      transfers.push({ fromPersonId: member.personId, toPersonId: treasurerPersonId, amount });
      totalCollected += amount;
    } else {
      transfers.push({ fromPersonId: treasurerPersonId, toPersonId: member.personId, amount: member.balance });
      totalPaidOut += member.balance;
    }
  }

  return { transfers, totalCollected, totalPaidOut };
}
