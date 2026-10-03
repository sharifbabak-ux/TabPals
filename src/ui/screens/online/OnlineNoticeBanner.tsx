import { useLiveQuery } from "dexie-react-hooks";
import { clearOnlineNotice, readOnlineNotice } from "@/data/online/localCleanup";
import "./online.css";

/** Persian message shown after this device was revoked / an event was purged / an event was kept offline; persisted so it is not lost if it happened while the app was closed. */
export function OnlineNoticeBanner() {
  const notice = useLiveQuery(async () => (await readOnlineNotice()) ?? null, []);
  if (!notice) return null;
  return (
    <div className="online-notice" role="status">
      <span>{notice.message}</span>
      <button type="button" onClick={() => void clearOnlineNotice()}>
        متوجه شدم
      </button>
    </div>
  );
}
