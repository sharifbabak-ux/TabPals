/**
 * Pure open/closed status logic for an event (docs/PLAN.md item 2, Stage 2
 * task description part C). An event is closed if it was closed manually,
 * or automatically once `today` is after its `endDate` — unless it was
 * reopened after the moment it would have auto-closed, in which case it
 * stays open until closed manually again.
 */

export interface EventStatusInput {
  /** ISO timestamp of the last manual close, or null/undefined if not manually closed. */
  closedAt?: string | null;
  /** ISO timestamp of the last manual reopen, or null/undefined if never reopened. */
  reopenedAt?: string | null;
  /** ISO date ("YYYY-MM-DD") of the event's end date, or undefined if none is set. */
  endDate?: string | null;
}

function endOfDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

export function isEventClosed(event: EventStatusInput, today: Date): boolean {
  if (event.closedAt) return true;
  if (!event.endDate) return false;

  const closingMoment = endOfDay(event.endDate);
  if (today.getTime() <= closingMoment.getTime()) return false;

  if (event.reopenedAt) {
    const reopenedAt = new Date(event.reopenedAt);
    if (reopenedAt.getTime() > closingMoment.getTime()) return false;
  }

  return true;
}
