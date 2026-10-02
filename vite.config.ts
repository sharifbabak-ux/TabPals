/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_BASE ?? "/TabPals/";

  return {
    base,
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "prompt",
        injectRegister: false,
        includeAssets: ["favicon.svg", "apple-touch-icon.png"],
        manifest: {
          id: base,
          name: "TabPals – حساب دوستانه",
          short_name: "TabPals",
          description: "مدیریت آفلاین هزینه‌های گروهی سفر و دورهمی",
          lang: "fa",
          dir: "rtl",
          display: "standalone",
          orientation: "portrait",
          start_url: base,
          scope: base,
          background_color: "#F3EDDF",
          theme_color: "#4E5D2F",
          icons: [
            {
              src: `${base}icons/icon-192.png`,
              sizes: "192x192",
              type: "image/png"
            },
            {
              src: `${base}icons/icon-512.png`,
              sizes: "512x512",
              type: "image/png"
            },
            {
              src: `${base}icons/icon-maskable-512.png`,
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable"
            }
          ]
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,json}"],
          // Standalone network-test page: never precached, never served as the SPA fallback.
          globIgnores: ["nettest.html", "nettest-fonts/**"],
          navigateFallback: `${base}index.html`,
          navigateFallbackDenylist: [/nettest\.html$/],
          cleanupOutdatedCaches: true
        },
        devOptions: {
          enabled: false
        }
      })
    ],
    resolve: {
      alias: {
        "@": "/src"
      }
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"]
    }
  };
});
