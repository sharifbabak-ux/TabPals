import { APP_NAME, APP_VERSION } from "@/config/app";
import { toPersianDigits } from "@/domain/format";
import { Tabs } from "@/ui/components/Tabs";
import { useTheme, type ThemeMode } from "@/ui/theme";
import { MessageTemplatesSection } from "./settings/MessageTemplatesSection";

export function SettingsScreen() {
  const { theme, setTheme } = useTheme();

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

      <MessageTemplatesSection />
    </section>
  );
}
