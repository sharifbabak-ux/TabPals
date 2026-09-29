import { canDeletePerson } from "@/domain/deletionGuards";
import { normalizeName } from "@/domain/nameNormalization";
import { validateCardNumber, validateIban } from "@/domain/paymentValidation";
import { db } from "../db";
import type { Person } from "../types";
import { diffFields, logOperation, newBaseFields, touchBaseFields } from "./operationLog";

export interface PersonInput {
  firstName: string;
  lastName: string;
  phone?: string;
  note?: string;
  /** Pass a Blob to set/replace the photo, null to remove it, or omit to leave it unchanged. */
  photo?: Blob | null;
  cardNumber?: string;
  iban?: string;
  bankName?: string;
  accountHolder?: string;
}

/** Photo is resolved from the tri-state PersonInput (set/remove/unchanged) down to Person's plain Blob|undefined field. */
interface NormalizedPersonFields {
  firstName?: string;
  lastName?: string;
  phone?: string;
  note?: string;
  photo?: Blob;
  cardNumber?: string;
  iban?: string;
  bankName?: string;
  accountHolder?: string;
}

const PERSON_LOG_FIELDS: (keyof Person)[] = [
  "firstName",
  "lastName",
  "phone",
  "note",
  "photo",
  "archived",
  "cardNumber",
  "iban",
  "bankName",
  "accountHolder",
  "needsNameReview"
];

function normalize(input: Partial<PersonInput>): NormalizedPersonFields {
  const result: NormalizedPersonFields = {};
  if (input.firstName !== undefined) {
    const trimmed = input.firstName.trim();
    if (!trimmed) throw new Error("نام الزامی است");
    result.firstName = trimmed;
  }
  if (input.lastName !== undefined) {
    const trimmed = input.lastName.trim();
    if (!trimmed) throw new Error("نام خانوادگی الزامی است");
    result.lastName = trimmed;
  }
  if (input.phone !== undefined) result.phone = input.phone.trim() || undefined;
  if (input.note !== undefined) result.note = input.note.trim() || undefined;
  if (input.photo !== undefined) result.photo = input.photo ?? undefined;
  if (input.cardNumber !== undefined) {
    const trimmed = input.cardNumber.trim();
    if (!trimmed) {
      result.cardNumber = undefined;
    } else {
      const validation = validateCardNumber(trimmed);
      if (!validation.valid) throw new Error(validation.error);
      result.cardNumber = validation.normalized;
    }
  }
  if (input.iban !== undefined) {
    const trimmed = input.iban.trim();
    if (!trimmed) {
      result.iban = undefined;
    } else {
      const validation = validateIban(trimmed);
      if (!validation.valid) throw new Error(validation.error);
      result.iban = validation.normalized;
    }
  }
  if (input.bankName !== undefined) result.bankName = input.bankName.trim() || undefined;
  if (input.accountHolder !== undefined) result.accountHolder = input.accountHolder.trim() || undefined;
  return result;
}

/** Blocks creating/renaming a person whose normalized firstName+lastName matches an existing non-archived one (see CLAUDE.md). */
async function assertNameAvailable(firstName: string, lastName: string, excludePersonId?: string): Promise<void> {
  const target = normalizeName(`${firstName} ${lastName}`.trim());
  const others = await db.persons.filter((p) => !p.deleted && !p.archived && p.id !== excludePersonId).toArray();
  const clash = others.find((p) => normalizeName(`${p.firstName} ${p.lastName}`.trim()) === target);
  if (clash) {
    const clashFullName = `${clash.firstName} ${clash.lastName}`.trim();
    throw new Error(
      `شخص دیگری با نام «${clashFullName}» وجود دارد. یک ویژگی متمایزکننده اضافه کنید، مثلاً «${firstName} ${lastName} (کرج)».`
    );
  }
}

/** True if `personId` is a member of, or a voucher party in, any event (including events currently in trash). */
async function isReferencedByAnyEvent(personId: string): Promise<boolean> {
  const membership = await db.eventMembers.where("personId").equals(personId).first();
  if (membership) return true;

  const allVouchers = await db.vouchers.toArray();
  return allVouchers.some(
    (voucher) =>
      voucher.payers.some((p) => p.personId === personId) ||
      voucher.participants.some((p) => p.personId === personId) ||
      voucher.shares.some((s) => s.personId === personId) ||
      voucher.fromPersonId === personId ||
      voucher.toPersonId === personId
  );
}

export const personsRepository = {
  async create(input: PersonInput): Promise<Person> {
    const normalized = normalize(input) as Required<Pick<NormalizedPersonFields, "firstName" | "lastName">> & NormalizedPersonFields;
    await assertNameAvailable(normalized.firstName, normalized.lastName);
    const person: Person = {
      ...newBaseFields(),
      firstName: normalized.firstName,
      lastName: normalized.lastName,
      phone: normalized.phone,
      note: normalized.note,
      photo: normalized.photo,
      cardNumber: normalized.cardNumber,
      iban: normalized.iban,
      bankName: normalized.bankName,
      accountHolder: normalized.accountHolder,
      archived: false,
      needsNameReview: false
    };
    await db.transaction("rw", db.persons, db.operations, async () => {
      await db.persons.add(person);
      await logOperation(db, "persons", person.id, "create", diffFields(undefined, person, PERSON_LOG_FIELDS));
    });
    return person;
  },

  async update(id: string, changes: Partial<PersonInput>): Promise<void> {
    const normalized = normalize(changes);
    const nameChanged = normalized.firstName !== undefined || normalized.lastName !== undefined;
    await db.transaction("rw", db.persons, db.operations, async () => {
      const existing = await db.persons.get(id);
      if (!existing) throw new Error(`Person ${id} not found`);
      if (nameChanged) {
        await assertNameAvailable(normalized.firstName ?? existing.firstName, normalized.lastName ?? existing.lastName, id);
      }
      const updated: Person = {
        ...existing,
        ...normalized,
        ...(nameChanged ? { needsNameReview: false } : {}),
        ...touchBaseFields(existing)
      };
      const diff = diffFields(existing, updated, PERSON_LOG_FIELDS);
      if (Object.keys(diff).length === 0) return;
      await db.persons.put(updated);
      await logOperation(db, "persons", id, "update", diff);
    });
  },

  /**
   * "بررسی نام‌ها": confirms (optionally edited) split names for a person
   * flagged `needsNameReview` by the v6 migration. Unlike `update`, an
   * empty last name is accepted here — the user may genuinely have a
   * single-word name.
   */
  async confirmNameReview(id: string, names: { firstName: string; lastName: string }): Promise<void> {
    const firstName = names.firstName.trim();
    if (!firstName) throw new Error("نام الزامی است");
    const lastName = names.lastName.trim();
    await assertNameAvailable(firstName, lastName, id);
    await db.transaction("rw", db.persons, db.operations, async () => {
      const existing = await db.persons.get(id);
      if (!existing) throw new Error(`Person ${id} not found`);
      const updated: Person = { ...existing, firstName, lastName, needsNameReview: false, ...touchBaseFields(existing) };
      const diff = diffFields(existing, updated, ["firstName", "lastName", "needsNameReview"]);
      if (Object.keys(diff).length === 0) return;
      await db.persons.put(updated);
      await logOperation(db, "persons", id, "update", diff);
    });
  },

  async setArchived(id: string, archived: boolean): Promise<void> {
    await db.transaction("rw", db.persons, db.operations, async () => {
      const existing = await db.persons.get(id);
      if (!existing) throw new Error(`Person ${id} not found`);
      if (existing.archived === archived) return;
      const updated: Person = { ...existing, archived, ...touchBaseFields(existing) };
      await db.persons.put(updated);
      await logOperation(db, "persons", id, "archive", diffFields(existing, updated, ["archived"]));
    });
  },

  /** Returns the events (open, closed, or in trash) that reference this person as a member or voucher party — shown to the user when permanent delete is blocked. */
  async referencingEvents(personId: string): Promise<{ eventId: string; title: string }[]> {
    const eventIds = new Set((await db.eventMembers.where("personId").equals(personId).toArray()).map((m) => m.eventId));
    const allVouchers = await db.vouchers.toArray();
    for (const voucher of allVouchers) {
      const referenced =
        voucher.payers.some((p) => p.personId === personId) ||
        voucher.participants.some((p) => p.personId === personId) ||
        voucher.shares.some((s) => s.personId === personId) ||
        voucher.fromPersonId === personId ||
        voucher.toPersonId === personId;
      if (referenced) eventIds.add(voucher.eventId);
    }
    if (eventIds.size === 0) return [];
    const events = await db.events.bulkGet(Array.from(eventIds));
    return events.filter((e): e is NonNullable<typeof e> => Boolean(e)).map((e) => ({ eventId: e.id, title: e.title }));
  },

  /** Permanent delete (docs/PLAN.md Stage 3B.1): only an archived person referenced by no event, anywhere (including trash). Hard-deletes the row and writes a tombstone operation. */
  async permanentlyDelete(id: string): Promise<void> {
    await db.transaction("rw", db.persons, db.eventMembers, db.vouchers, db.events, db.operations, async () => {
      const existing = await db.persons.get(id);
      if (!existing) throw new Error(`Person ${id} not found`);
      const referencedByAnyEvent = await isReferencedByAnyEvent(id);
      const check = canDeletePerson(existing, { referencedByAnyEvent });
      if (!check.allowed) throw new Error(check.reason ?? "حذف دائمی امکان‌پذیر نیست.");
      await db.persons.delete(id);
      await logOperation(db, "persons", id, "purge", {});
    });
  }
};
