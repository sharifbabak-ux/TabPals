import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { BottomNav } from "./components/BottomNav";
import { UpdateBanner } from "./components/UpdateBanner";
import { EventsScreen } from "./screens/EventsScreen";
import { EventDetailScreen } from "./screens/EventDetailScreen";
import { OrderSessionScreen } from "./screens/orders/OrderSessionScreen";
import { OrderPricingScreen } from "./screens/orders/OrderPricingScreen";
import { StatementViewScreen } from "./screens/StatementViewScreen";
import { SharedStatementScreen } from "./screens/SharedStatementScreen";
import { SendQueueScreen } from "./screens/SendQueueScreen";
import { PeopleScreen } from "./screens/PeopleScreen";
import { BackupScreen } from "./screens/BackupScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { NameReviewScreen } from "./screens/NameReviewScreen";
import { PrivacyScreen } from "./screens/PrivacyScreen";
import { TrashScreen } from "./screens/TrashScreen";
import { AccessScreen } from "./screens/online/AccessScreen";
import { JoinScreen } from "./screens/online/JoinScreen";
import { MyStatementPreviewScreen } from "./screens/online/MyStatementPreviewScreen";
import { OnlineNoticeBanner } from "./screens/online/OnlineNoticeBanner";

const NAME_REVIEW_PROMPT_META_KEY = "nameReviewPromptShown";

/** Shows the "بررسی نام‌ها" screen once, automatically, the first time any migrated person needs review (docs/PLAN.md Stage 3B.1). Afterward it's only reachable from Settings. */
function useAutoNameReviewPrompt() {
  const navigate = useNavigate();
  const location = useLocation();
  const needsReviewCount = useLiveQuery(() => db.persons.filter((p) => !p.deleted && p.needsNameReview === true).count(), []);

  useEffect(() => {
    // Never redirect away from the no-server shared statement link (docs/PLAN.md Stage 3C) — it must render standalone.
    if (!needsReviewCount || location.pathname.startsWith("/s/") || location.pathname.startsWith("/join")) return;
    (async () => {
      const alreadyShown = await db.meta.get(NAME_REVIEW_PROMPT_META_KEY);
      if (alreadyShown) return;
      await db.meta.put({ key: NAME_REVIEW_PROMPT_META_KEY, value: "true" });
      navigate("/settings/name-review");
    })();
  }, [needsReviewCount, navigate, location.pathname]);
}

export function App() {
  useAutoNameReviewPrompt();

  return (
    <div className="app-shell">
      <UpdateBanner />
      <OnlineNoticeBanner />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/events" replace />} />
          <Route path="/events" element={<EventsScreen />} />
          <Route path="/events/:eventId" element={<EventDetailScreen />} />
          <Route path="/join" element={<JoinScreen />} />
          <Route path="/events/:eventId/access" element={<AccessScreen />} />
          <Route path="/events/:eventId/my-statement" element={<MyStatementPreviewScreen />} />
          <Route path="/events/:eventId/orders/:sessionId" element={<OrderSessionScreen />} />
          <Route path="/events/:eventId/orders/:sessionId/pricing" element={<OrderPricingScreen />} />
          <Route path="/events/:eventId/statements/send-queue" element={<SendQueueScreen />} />
          <Route path="/events/:eventId/statements/:statementId" element={<StatementViewScreen />} />
          <Route path="/s/:payload" element={<SharedStatementScreen />} />
          <Route path="/people" element={<PeopleScreen />} />
          <Route path="/backup" element={<BackupScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/settings/name-review" element={<NameReviewScreen />} />
          <Route path="/settings/trash" element={<TrashScreen />} />
          <Route path="/settings/privacy" element={<PrivacyScreen />} />
          <Route path="*" element={<Navigate to="/events" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}
