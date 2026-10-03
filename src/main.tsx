import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/600.css";
import "@fontsource/vazirmatn/700.css";
import "@fontsource/fraunces/600.css";
import "./ui/theme.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./ui/App";
import { ThemeProvider } from "./ui/theme";
import { getDeviceId } from "./data/deviceId";
import { requestPersistentStorageOnce } from "./platform";
import { ONLINE_ENABLED } from "./config/app";
import { syncEngine } from "./data/online/syncEngine";

getDeviceId();
void requestPersistentStorageOnce();
// Online events: reconnect sockets, catch up and drain the outbox for every linked event.
if (ONLINE_ENABLED) void syncEngine.start();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeProvider>
  </StrictMode>
);
