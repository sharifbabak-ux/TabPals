/**
 * Pure validation for the person name field (اشخاص add/edit sheet). A
 * duplicate name (after normalization) is BLOCKED, not just warned about
 * — see CLAUDE.md and the Stage 2 task description, part A.5.
 */
import { normalizeName } from "./nameNormalization";

export interface PersonNameValidation {
  /** Whether the name can be saved. */
  valid: boolean;
  /** Persian error message when `valid` is false. */
  error: string | null;
}

/**
 * @param name candidate name, as typed.
 * @param existingNames names of other non-archived persons to compare
 *   against (the caller excludes the person currently being edited, if any).
 */
export function validatePersonName(name: string, existingNames: string[]): PersonNameValidation {
  const trimmed = name.trim();

  if (!trimmed) {
    return { valid: false, error: "نام الزامی است" };
  }

  const normalized = normalizeName(trimmed);
  const clash = existingNames.find((existing) => normalizeName(existing) === normalized);

  if (clash) {
    return {
      valid: false,
      error: `شخص دیگری با نام «${clash}» وجود دارد. یک ویژگی متمایزکننده اضافه کنید، مثلاً «${trimmed} (کرج)».`
    };
  }

  return { valid: true, error: null };
}
