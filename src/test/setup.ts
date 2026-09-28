// Provides an in-memory IndexedDB implementation so Dexie-backed code
// (db.ts, repositories) can be unit-tested under jsdom, which has no
// native IndexedDB.
import "fake-indexeddb/auto";
