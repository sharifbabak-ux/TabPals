/**
 * Pure validation for the person name fields (اشخاص add/edit sheet). A
 * duplicate normalized firstName+lastName combination is BLOCKED, not
 * just warned about — see CLAUDE.md and docs/PLAN.md Stage 3B.1.
 */
import { normalizeName } from "./nameNormalization";

export interface PersonNameValidation {
  /** Whether the name can be saved. */
  valid: boolean;
  /** Persian error message when `valid` is false. */
  error: string | null;
}

export interface PersonNameCandidate {
  firstName: string;
  lastName: string;
}

function normalizedKey(name: PersonNameCandidate): string {
  return normalizeName(`${name.firstName} ${name.lastName}`.trim());
}

/**
 * @param firstName candidate first name, as typed.
 * @param lastName candidate last name, as typed.
 * @param existingNames first/last names of other non-archived persons to
 *   compare against (the caller excludes the person currently being edited).
 */
export function validatePersonName(
  firstName: string,
  lastName: string,
  existingNames: PersonNameCandidate[]
): PersonNameValidation {
  const trimmedFirst = firstName.trim();
  const trimmedLast = lastName.trim();

  if (!trimmedFirst) {
    return { valid: false, error: "نام الزامی است" };
  }
  if (!trimmedLast) {
    return { valid: false, error: "نام خانوادگی الزامی است" };
  }

  const normalized = normalizedKey({ firstName: trimmedFirst, lastName: trimmedLast });
  const clash = existingNames.find((existing) => normalizedKey(existing) === normalized);

  if (clash) {
    const clashFullName = `${clash.firstName} ${clash.lastName}`.trim();
    return {
      valid: false,
      error: `شخص دیگری با نام «${clashFullName}» وجود دارد. یک ویژگی متمایزکننده اضافه کنید، مثلاً «${trimmedFirst} ${trimmedLast} (کرج)».`
    };
  }

  return { valid: true, error: null };
}
