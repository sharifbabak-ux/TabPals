/**
 * Pure validation for the group name field (گروه‌ها add/edit sheet). A
 * duplicate name (after normalization) is BLOCKED — see CLAUDE.md and the
 * Stage 2 task description, part A.5.
 */
import { normalizeName } from "./nameNormalization";

export interface GroupNameValidation {
  valid: boolean;
  error: string | null;
}

/**
 * @param name candidate name, as typed.
 * @param existingNames names of other non-archived groups to compare
 *   against (the caller excludes the group currently being edited, if any).
 */
export function validateGroupName(name: string, existingNames: string[]): GroupNameValidation {
  const trimmed = name.trim();

  if (!trimmed) {
    return { valid: false, error: "نام الزامی است" };
  }

  const normalized = normalizeName(trimmed);
  const clash = existingNames.find((existing) => normalizeName(existing) === normalized);

  if (clash) {
    return {
      valid: false,
      error: `گروه دیگری با نام «${clash}» وجود دارد. یک ویژگی متمایزکننده اضافه کنید، مثلاً «${trimmed} (کرج)».`
    };
  }

  return { valid: true, error: null };
}
