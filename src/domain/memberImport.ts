/**
 * Pure logic for "import members from a previous event" (docs/PLAN.md #1
 * and the ایونت‌ها event detail screen). No DOM/IndexedDB access — the UI
 * loads the source event's members and the current event's member person
 * ids, and everything else happens here.
 */

export interface ImportCandidate {
  personId: string;
  name: string;
}

/**
 * Returns the source event's members that aren't already members of the
 * current event, in their original order.
 */
export function buildImportCandidates(
  sourceMembers: ImportCandidate[],
  currentMemberPersonIds: Iterable<string>
): ImportCandidate[] {
  const existing = new Set(currentMemberPersonIds);
  return sourceMembers.filter((member) => !existing.has(member.personId));
}

/** Selects every candidate (the "select all" action). */
export function selectAllCandidates(candidates: ImportCandidate[]): Set<string> {
  return new Set(candidates.map((candidate) => candidate.personId));
}

/** Clears the selection (the "select none" action). */
export function selectNoCandidates(): Set<string> {
  return new Set();
}

/** Returns a new selection with the given person's membership toggled. */
export function toggleCandidateSelection(selected: Set<string>, personId: string): Set<string> {
  const next = new Set(selected);
  if (next.has(personId)) {
    next.delete(personId);
  } else {
    next.add(personId);
  }
  return next;
}
