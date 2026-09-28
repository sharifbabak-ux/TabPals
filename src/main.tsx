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

getDeviceId();
void requestPersistentStorageOnce();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeProvider>
  </StrictMode>
);
