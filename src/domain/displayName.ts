/**
 * Per-event member display name (docs/PLAN.md Stage 3B.1). Statements,
 * tables, and lists inside one event always show the first name alone,
 * unless another person in the SAME event (active or inactive) shares the
 * same normalized first name — then the last name is added in parentheses
 * to disambiguate. The person-directory "full name" (firstName + lastName)
 * is a separate, simpler concern — see `personFullName` below.
 */
import { normalizeName } from "./nameNormalization";

export interface PersonNameParts {
  personId: string;
  firstName: string;
  lastName: string;
}

/**
 * @param person the member being displayed.
 * @param eventMembers every person in the same event (active or inactive),
 *   including `person` itself — duplicates are detected by personId.
 */
export function displayName(person: PersonNameParts, eventMembers: PersonNameParts[]): string {
  const normalizedFirst = normalizeName(person.firstName);
  const hasDuplicate = eventMembers.some(
    (other) => other.personId !== person.personId && normalizeName(other.firstName) === normalizedFirst
  );
  if (!hasDuplicate) return person.firstName;

  const lastName = person.lastName.trim();
  return lastName ? `${person.firstName} (${lastName})` : person.firstName;
}

/** The person-directory "full name" (اشخاص list, group member lists, treasurer picker) — always firstName + lastName, never disambiguated. */
export function personFullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}
