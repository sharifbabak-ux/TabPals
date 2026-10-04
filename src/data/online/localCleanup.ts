/** Removing / detaching an online event's local data (revoked device, purged event, leaving, "keep as offline"). */
import { db as defaultDb, type TabPalDB } from "../db";

export const ONLINE_NOTICE_META_KEY = "onlineNotice";

export interface OnlineNotice {
  message: string;
  at: string;
}

export async function setOnlineNotice(message: string, db: TabPalDB = defaultDb): Promise<void> {
  const notice: OnlineNotice = { message, at: new Date().toISOString() };
  await db.meta.put({ key: ONLINE_NOTICE_META_KEY, value: JSON.stringify(notice) });
}

export async function clearOnlineNotice(db: TabPalDB = defaultDb): Promise<void> {
  await db.meta.delete(ONLINE_NOTICE_META_KEY);
}

export async function readOnlineNotice(db: TabPalDB = defaultDb): Promise<OnlineNotice | null> {
  const row = await db.meta.get(ONLINE_NOTICE_META_KEY);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as OnlineNotice;
  } catch {
    return null;
  }
}

const ALL_TABLES = (db: TabPalDB) => [
  db.events,
  db.persons,
  db.eventMembers,
  db.vouchers,
  db.statements,
  db.orderSessions,
  db.sessionMenuItems,
  db.orderLines,
  db.orderPersonTotals,
  db.sessionExtras,
  db.outbox,
  db.appliedRemoteOps,
  db.onlineLinks,
  db.eventKeys
];

/** Drops the sync bookkeeping of an event (link with its token, queued ops, applied-op ids) but keeps the event's data: it becomes an offline event again. */
export async function detachOnlineEvent(localEventId: string, db: TabPalDB = defaultDb): Promise<void> {
  await db.transaction("rw", ALL_TABLES(db), async () => {
    await db.outbox.where("localEventId").equals(localEventId).delete();
    await db.appliedRemoteOps.where("localEventId").equals(localEventId).delete();
    await db.onlineLinks.delete(localEventId);
    await db.eventKeys.delete(localEventId);
  });
}

/**
 * Removes an online event and everything that belongs to it from this
 * device (no tombstone operations: the server already knows). Persons that
 * arrived through sync (`fromSync`) and belong to no other event are
 * removed too; persons the user created themselves stay in the directory.
 */
export async function wipeOnlineEvent(localEventId: string, db: TabPalDB = defaultDb): Promise<void> {
  await db.transaction("rw", ALL_TABLES(db), async () => {
    const members = await db.eventMembers.where("eventId").equals(localEventId).toArray();
    const sessionIds = (await db.orderSessions.where("eventId").equals(localEventId).primaryKeys()) as string[];
    for (const sessionId of sessionIds) {
      await db.sessionMenuItems.where("sessionId").equals(sessionId).delete();
      await db.orderLines.where("sessionId").equals(sessionId).delete();
      await db.orderPersonTotals.where("sessionId").equals(sessionId).delete();
      await db.sessionExtras.where("sessionId").equals(sessionId).delete();
    }
    await db.orderSessions.where("eventId").equals(localEventId).delete();
    await db.vouchers.where("eventId").equals(localEventId).delete();
    await db.statements.where("eventId").equals(localEventId).delete();
    await db.eventMembers.where("eventId").equals(localEventId).delete();
    await db.events.delete(localEventId);
    await db.outbox.where("localEventId").equals(localEventId).delete();
    await db.appliedRemoteOps.where("localEventId").equals(localEventId).delete();
    await db.onlineLinks.delete(localEventId);
    await db.eventKeys.delete(localEventId);

    for (const personId of new Set(members.map((m) => m.personId))) {
      const stillMember = await db.eventMembers.where("personId").equals(personId).count();
      if (stillMember > 0) continue;
      const person = await db.persons.get(personId);
      if (person?.fromSync) await db.persons.delete(personId);
    }
  });
}
