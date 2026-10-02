import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { displayName } from "@/domain/displayName";

export interface EventMemberOption {
  personId: string;
  /** Per-event display name (first name, disambiguated with the last name when needed). */
  name: string;
  photo?: Blob;
  active: boolean;
}

/** The event's members in their manual order, with per-event display names. Undefined while loading. */
export function useEventMembers(eventId: string): EventMemberOption[] | undefined {
  return useLiveQuery(async () => {
    const rows = await db.eventMembers
      .where("eventId")
      .equals(eventId)
      .filter((member) => !member.deleted)
      .toArray();
    rows.sort((a, b) => a.sortOrder - b.sortOrder);
    const persons = await db.persons.bulkGet(rows.map((row) => row.personId));
    const parts = rows.map((row, index) => ({
      personId: row.personId,
      firstName: persons[index]?.firstName ?? "؟",
      lastName: persons[index]?.lastName ?? ""
    }));
    return rows.map((row, index) => ({
      personId: row.personId,
      name: displayName(parts[index], parts),
      photo: persons[index]?.photo,
      active: row.active
    }));
  }, [eventId]);
}
