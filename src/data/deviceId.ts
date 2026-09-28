import { ulid } from "ulid";

const DEVICE_ID_STORAGE_KEY = "tabpal:deviceId";

/**
 * Returns this device's ULID, generating and persisting one on first
 * launch. Stored in localStorage (not Dexie) so it is available
 * synchronously before the database is opened.
 */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!id) {
    id = ulid();
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
  }
  return id;
}
