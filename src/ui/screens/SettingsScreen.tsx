import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { setHidePaymentInExports } from "@/data/appSettings";
import { APP_NAME, APP_VERSION, ONLINE_ENABLED } from "@/config/app";
import { DEFAULT_API_BASE, getApiBase, getApiBaseOverride, setApiBaseOverride } from "@/config/online";
import { toPersianDigits } from "@/domain/format";
import { Switch } from "@/ui/components/Switch";
import { Tabs } from "@/ui/components/Tabs";
import { useHidePaymentInExports } from "@/ui/hooks/useHidePaymentInExports";
import { useTheme, type ThemeMode } from "@/ui/theme";
import { MessageTemplatesSection } from "./settings/MessageTemplatesSection";
import { JoinWithInviteSheet } from "./online/JoinWithInviteSheet";

/** Dev setting: point the app at another API server (e.g. a local Tabpals-Live). Not a secret, so it lives in localStorage. */
function ApiServerSection() {
  const [value, setValue] = useState(getApiBaseOverride() ?? "");
  const [saved, setSaved] = useState(false);
  return (
    <>
      <h2 className="section-title">سرور (تنظیم توسعه‌دهنده)</h2>
      <div className="field">
        <label htmlFor="api-base">نشانی سرور آنلاین</label>
        <input id="api-base" dir="ltr" placeholder={DEFAULT_API_BASE} value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }} />
        <p className="field__hint" dir="ltr">
          {getApiBase()}
        </p>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="form-actions__secondary"
          onClick={() => {
            setApiBaseOverride(null);
            setValue("");
            setSaved(true);
          }}
        >
          بازگشت به پیش‌فرض
        </button>
        <button
          type="button"
          className="form-actions__primary"
          onClick={() => {
            setApiBaseOverride(value);
            setSaved(true);
          }}
        >
          ذخیره
        </button>
      </div>
      {saved && <p className="field__hint">ذخیره شد؛ برای اتصال دوباره‌ی ایونت‌های آنلاین، برنامه را ببندید و دوباره باز کنید.</p>}
    </>
  );
}

export function SettingsScreen() {
  const navigate = useNavigate();
  const [joinOpen, setJoinOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const hidePayment = useHidePaymentInExports();

  const needsReviewCount = useLiveQuery(() => db.persons.filter((p) => !p.deleted && p.needsNameReview === true).count(), []);
  const trashedEventsCount = useLiveQuery(() => db.events.filter((e) => !e.deleted && Boolean(e.deletedAt)).count(), []);

  return (
    <section className="screen">
      <h1>تنظیمات</h1>
      <p>
        {APP_NAME} — نسخه‌ی {toPersianDigits(APP_VERSION)}
      </p>

      <h2 className="section-title">پوسته</h2>
      <Tabs<ThemeMode>
        options={[
          { value: "system", label: "سیستم" },
          { value: "light", label: "روشن" },
          { value: "dark", label: "تیره" }
        ]}
        value={theme}
        onChange={setTheme}
      />

      <h2 className="section-title">حریم خصوصی</h2>
      <ul className="list">
        <li className="list-item">
          <div className="list-item__main">
            <Switch checked={hidePayment} onChange={(value) => void setHidePaymentInExports(value)} label="عدم چاپ شماره‌کارت و شبا در خروجی‌ها" />
            <span className="list-item__subtitle">با روشن بودن، در PDF، تصویر و چاپ صورت‌حساب فقط نام مسئول صندوق دیده می‌شود.</span>
          </div>
        </li>
        <li className="list-item" onClick={() => navigate("/settings/privacy")}>
          <div className="list-item__main">
            <span className="list-item__title">حریم خصوصی</span>
            <span className="list-item__subtitle">چه چیزی ذخیره و رمزگذاری می‌شود و چه کسی چه چیزی می‌بیند</span>
          </div>
        </li>
      </ul>

      <h2 className="section-title">داده‌ها</h2>
      <ul className="list">
        <li className="list-item" onClick={() => navigate("/settings/name-review")}>
          <div className="list-item__main">
            <span className="list-item__title">بررسی نام‌ها</span>
            {Boolean(needsReviewCount) && <span className="list-item__subtitle">{toPersianDigits(needsReviewCount ?? 0)} مورد در انتظار بررسی</span>}
          </div>
        </li>
        {ONLINE_ENABLED && (
          <li className="list-item" onClick={() => setJoinOpen(true)}>
            <div className="list-item__main">
              <span className="list-item__title">پیوستن با دعوت</span>
              <span className="list-item__subtitle">ورود به ایونت آنلاین با اسکن QR یا کد دعوت</span>
            </div>
          </li>
        )}
        <li className="list-item" onClick={() => navigate("/settings/trash")}>
          <div className="list-item__main">
            <span className="list-item__title">سطل بازیافت</span>
            <span className="list-item__subtitle">{toPersianDigits(trashedEventsCount ?? 0)} ایونت</span>
          </div>
        </li>
      </ul>

      <MessageTemplatesSection />

      {ONLINE_ENABLED && <ApiServerSection />}
      <JoinWithInviteSheet open={joinOpen} onClose={() => setJoinOpen(false)} />
    </section>
  );
}
