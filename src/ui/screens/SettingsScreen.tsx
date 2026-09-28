import { APP_NAME, APP_VERSION } from "@/config/app";
import { toPersianDigits } from "@/domain/format";

export function SettingsScreen() {
  return (
    <section className="screen">
      <h1>تنظیمات</h1>
      <p>
        {APP_NAME} — نسخه‌ی {toPersianDigits(APP_VERSION)}
      </p>
    </section>
  );
}
