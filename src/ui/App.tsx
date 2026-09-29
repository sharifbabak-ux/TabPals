import { Navigate, Route, Routes } from "react-router-dom";
import { BottomNav } from "./components/BottomNav";
import { UpdateBanner } from "./components/UpdateBanner";
import { EventsScreen } from "./screens/EventsScreen";
import { EventDetailScreen } from "./screens/EventDetailScreen";
import { StatementViewScreen } from "./screens/StatementViewScreen";
import { PeopleScreen } from "./screens/PeopleScreen";
import { BackupScreen } from "./screens/BackupScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

export function App() {
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
          <Route path="*" element={<Navigate to="/events" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}
