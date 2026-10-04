/**
 * Who sees which payment details in a statement (docs/PLAN.md "Encryption design").
 * Pure transformations over the parsed statement snapshot.
 *
 *  - `fillCreditorBankDetails`: statements that were synced never carry other
 *    members' bank details; on devices that hold member profiles (treasurer /
 *    admin) the creditors' details are filled in at render time.
 *  - `hidePaymentDetails`: the «عدم چاپ شماره‌کارت و شبا در خروجی‌ها» setting —
 *    exports then show only the treasurer's name.
 */
import { formatCardNumberGrouped, formatIbanGrouped } from "./paymentValidation";
import { isPendingKey } from "./encryptedDisplay";
import type { ComprehensiveReportData, HubSettlementSection, MemberStatementData } from "./statementBuilder";
import type { StatementLinkData } from "./statementLink";

export interface CreditorProfile {
  cardNumber?: string;
  iban?: string;
  bankName?: string;
  accountHolder?: string;
}

function hubOf(data: StatementLinkData): HubSettlementSection | null {
  return (data as MemberStatementData | ComprehensiveReportData).hubSettlement ?? null;
}

function withHub<T extends StatementLinkData>(data: T, hub: HubSettlementSection): T {
  return { ...data, hubSettlement: hub } as T;
}

/** Fills each «پرداخت به اعضا» row's bank details from local profiles (encrypted/pending values are skipped). */
export function fillCreditorBankDetails<T extends StatementLinkData>(data: T, profiles: ReadonlyMap<string, CreditorProfile>): T {
  const hub = hubOf(data);
  if (!hub || hub.paysFromTreasurer.length === 0) return data;
  const rows = hub.paysFromTreasurer.map((row) => {
    if (row.cardNumberGrouped || row.ibanGrouped || row.bankName || row.accountHolder) return row;
    const profile = profiles.get(row.personId);
    if (!profile) return row;
    const usable = (value: string | undefined) => (value && !isPendingKey(value) ? value : undefined);
    const card = usable(profile.cardNumber);
    const iban = usable(profile.iban);
    return {
      ...row,
      cardNumberGrouped: card ? formatCardNumberGrouped(card) : undefined,
      ibanGrouped: iban ? formatIbanGrouped(iban) : undefined,
      bankName: usable(profile.bankName),
      accountHolder: usable(profile.accountHolder)
    };
  });
  return withHub(data, { ...hub, paysFromTreasurer: rows });
}

/** Removes every card number, IBAN, bank name and account holder; names and amounts stay. */
export function hidePaymentDetails<T extends StatementLinkData>(data: T): T {
  let out: StatementLinkData = data;
  if (data.kind !== "comprehensive") {
    out = { ...data, treasurerCardNumberGrouped: null, treasurerIbanGrouped: null, treasurerBankName: null, treasurerAccountHolder: null };
  }
  const hub = hubOf(out);
  if (hub) {
    out = withHub(out, {
      ...hub,
      paysFromTreasurer: hub.paysFromTreasurer.map((row) => ({ ...row, cardNumberGrouped: undefined, ibanGrouped: undefined, bankName: undefined, accountHolder: undefined }))
    });
  }
  return out as T;
}

/** True when the statement shows any payment detail (used to decide whether the privacy setting changes anything). */
export function hasPaymentDetails(data: StatementLinkData): boolean {
  if (data.kind !== "comprehensive" && (data.treasurerCardNumberGrouped || data.treasurerIbanGrouped || data.treasurerBankName || data.treasurerAccountHolder)) return true;
  return (hubOf(data)?.paysFromTreasurer ?? []).some((r) => r.cardNumberGrouped || r.ibanGrouped || r.bankName || r.accountHolder);
}
