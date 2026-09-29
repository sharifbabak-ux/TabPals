import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { BottomNav } from "./components/BottomNav";
import { UpdateBanner } from "./components/UpdateBanner";
import { EventsScreen } from "./screens/EventsScreen";
import { EventDetailScreen } from "./screens/EventDetailScreen";
import { StatementViewScreen } from "./screens/StatementViewScreen";
import { PeopleScreen } from "./screens/PeopleScreen";
import { BackupScreen } from "./screens/BackupScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { NameReviewScreen } from "./screens/NameReviewScreen";
import { TrashScreen } from "./screens/TrashScreen";

const NAME_REVIEW_PROMPT_META_KEY = "nameReviewPromptShown";

/** Shows the "بررسی نام‌ها" screen once, automatically, the first time any migrated person needs review (docs/PLAN.md Stage 3B.1). Afterward it's only reachable from Settings. */
function useAutoNameReviewPrompt() {
  const navigate = useNavigate();
  const needsReviewCount = useLiveQuery(() => db.persons.filter((p) => !p.deleted && p.needsNameReview === true).count(), []);

  useEffect(() => {
    if (!needsReviewCount) return;
    (async () => {
      const alreadyShown = await db.meta.get(NAME_REVIEW_PROMPT_META_KEY);
      if (alreadyShown) return;
      await db.meta.put({ key: NAME_REVIEW_PROMPT_META_KEY, value: "true" });
      navigate("/settings/name-review");
    })();
  }, [needsReviewCount, navigate]);
}

export function App() {
  useAutoNameReviewPrompt();

  return (
    <div className="app-shell">
      <UpdateBanner />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/events" replace />} />
          <Route path="/events" element={<EventsScreen />} />
          <Route path="/events/:eventId" element={<EventDetailScreen />} />
          <Route path="/events/:eventId/statements/:statementId" element={<StatementViewScreen />} />
          <Route path="/people" element={<PeopleScreen />} />
          <Route path="/backup" element={<BackupScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/settings/name-review" element={<NameReviewScreen />} />
          <Route path="/settings/trash" element={<TrashScreen />} />
          <Route path="*" element={<Navigate to="/events" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}
