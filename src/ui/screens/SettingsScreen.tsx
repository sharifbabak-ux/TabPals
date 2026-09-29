import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { APP_NAME, APP_VERSION } from "@/config/app";
import { toPersianDigits } from "@/domain/format";
import { Tabs } from "@/ui/components/Tabs";
import { useTheme, type ThemeMode } from "@/ui/theme";
import { MessageTemplatesSection } from "./settings/MessageTemplatesSection";

export function SettingsScreen() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

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

      <h2 className="section-title">داده‌ها</h2>
      <ul className="list">
        <li className="list-item" onClick={() => navigate("/settings/name-review")}>
          <div className="list-item__main">
            <span className="list-item__title">بررسی نام‌ها</span>
            {Boolean(needsReviewCount) && <span className="list-item__subtitle">{toPersianDigits(needsReviewCount ?? 0)} مورد در انتظار بررسی</span>}
          </div>
        </li>
        <li className="list-item" onClick={() => navigate("/settings/trash")}>
          <div className="list-item__main">
            <span className="list-item__title">سطل بازیافت</span>
            <span className="list-item__subtitle">{toPersianDigits(trashedEventsCount ?? 0)} ایونت</span>
          </div>
        </li>
      </ul>

      <MessageTemplatesSection />
    </section>
  );
}
