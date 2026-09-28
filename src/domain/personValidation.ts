/**
 * Pure validation for the person name field (اشخاص add/edit sheet). A
 * duplicate name is a warning, never a blocking error — see the Stage 1
 * task description.
 */

export interface PersonNameValidation {
  /** Whether the name can be saved. Only an empty name blocks saving. */
  valid: boolean;
  /** Persian error message when `valid` is false. */
  error: string | null;
  /** True when another existing person already has this name (case-insensitive). */
  isDuplicate: boolean;
}

/**
 * @param name candidate name, as typed.
 * @param existingNames names of other persons to compare against (the
 *   caller excludes the person currently being edited, if any).
 */
export function validatePersonName(name: string, existingNames: string[]): PersonNameValidation {
  const trimmed = name.trim();

  if (!trimmed) {
    return { valid: false, error: "نام الزامی است", isDuplicate: false };
  }

  const isDuplicate = existingNames.some((existing) => existing.trim().toLowerCase() === trimmed.toLowerCase());

  return { valid: true, error: null, isDuplicate };
}
