# CLAUDE.md — rules for every future session on TabPals

Read `docs/PLAN.md` first, before making any change. It is the approved
product plan and the source of truth for what each stage covers — do not
build features from a later stage while working on an earlier one.

## Architecture

- Keep the layered structure: `src/ui` (screens, components), `src/domain`
  (pure business logic), `src/data` (Dexie DB + repository interfaces),
  `src/platform` (platform services), `src/config`.
- Business logic (calculations, formatting, validation) belongs in
  `src/domain`, must be pure (no DOM/IndexedDB/network access), and must
  be unit-tested.
- Platform-dependent features (files, sharing, speech-to-text, backups)
  must go through the interfaces in `src/platform`, never call browser or
  Capacitor APIs directly from `src/ui` or `src/domain`. This is what lets
  Stage 9 add native Android/iOS implementations without touching UI code.

## Data rules

- Every persisted entity extends the base record type in
  `src/data/types.ts` (id ULID, createdAt, updatedAt, deviceId, version,
  deleted).
- Never hard-delete accounting records (vouchers, revisions, ...).
  Deletion = soft delete (`deleted: true`) or, for vouchers, a void with a
  reason — see docs/PLAN.md #3.
- Every Dexie schema change must bump the schema version
  (`this.version(n).stores(...)`) with a migration that preserves existing
  data. Never edit a past version's `stores()` in place.

## UI

- All user-facing text is Persian, RTL. The app name is read from
  `src/config/app.ts` (`APP_NAME`), never hard-coded elsewhere.
- Dates/times shown to the user use the Jalali calendar and Persian
  digits via `src/domain/format.ts`.

## Releases

- Bump `package.json` "version" on every release. It is the single
  source of truth for the app version (shown in Settings, written to the
  build's `version.json`, and — from Stage 9 — used to derive the Android
  `versionCode`).

## Working style

- Keep replies to the user short.
