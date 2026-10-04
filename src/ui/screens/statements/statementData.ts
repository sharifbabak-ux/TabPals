import { getHidePaymentInExports } from "@/data/appSettings";
import { db as defaultDb, type TabPalDB } from "@/data/db";
import type { Statement } from "@/data/types";
import { isPendingKey } from "@/domain/encryptedDisplay";
import { fillCreditorBankDetails, hidePaymentDetails, type CreditorProfile } from "@/domain/paymentVisibility";
import type { StatementLinkData } from "@/domain/statementLink";

export type ParsedSnapshot = StatementLinkData & { appVersion: string };

/** The statement's rendered data, or null while the snapshot is still ciphertext (no event key yet) or unreadable. */
export function parseSnapshot(snapshot: string): ParsedSnapshot | null {
  if (isPendingKey(snapshot)) return null;
  try {
    return JSON.parse(snapshot) as ParsedSnapshot;
  } catch {
    return null;
  }
}

/** Local profiles of the people a statement may pay out to (bank details exist only on devices that received member profiles). */
export async function loadCreditorProfiles(personIds: string[], db: TabPalDB = defaultDb): Promise<Map<string, CreditorProfile>> {
  const persons = await db.persons.bulkGet(personIds);
  const map = new Map<string, CreditorProfile>();
  for (const person of persons) {
    if (person) map.set(person.id, { cardNumber: person.cardNumber, iban: person.iban, bankName: person.bankName, accountHolder: person.accountHolder });
  }
  return map;
}

/** Fills creditors' bank details from local profiles (render time). */
export async function withCreditorDetails<T extends StatementLinkData>(data: T, db: TabPalDB = defaultDb): Promise<T> {
  const ids = (data as { hubSettlement?: { paysFromTreasurer: { personId: string }[] } | null }).hubSettlement?.paysFromTreasurer.map((r) => r.personId) ?? [];
  if (ids.length === 0) return data;
  return fillCreditorBankDetails(data, await loadCreditorProfiles(ids, db));
}

/** What leaves the app in an export/send: creditor details filled in, then removed again when the privacy setting is on. Null while the snapshot is encrypted. */
export async function loadExportData(statement: Pick<Statement, "snapshot">, db: TabPalDB = defaultDb): Promise<ParsedSnapshot | null> {
  const parsed = parseSnapshot(statement.snapshot);
  if (!parsed) return null;
  if (await getHidePaymentInExports(db)) return hidePaymentDetails(parsed);
  return withCreditorDetails(parsed, db);
}
