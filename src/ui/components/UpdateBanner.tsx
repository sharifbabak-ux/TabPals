import { useRegisterSW } from "virtual:pwa-register/react";
import "./UpdateBanner.css";

/**
 * Shows a Persian banner when a new service worker is waiting to
 * activate. Confirming reloads the page with the new version; local
 * data (IndexedDB) is untouched by a service worker update.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = useRegisterSW({
    onRegisterError: (error) => console.error("SW registration failed", error)
  });

  if (!needRefresh) return null;

  return (
    <div className="update-banner" role="status">
      <span>نسخه‌ی جدید آماده است</span>
      <div className="update-banner__actions">
        <button type="button" onClick={() => updateServiceWorker(true)}>
          به‌روزرسانی
        </button>
        <button type="button" className="update-banner__dismiss" onClick={() => setNeedRefresh(false)}>
          بعداً
        </button>
      </div>
    </div>
  );
}
