import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// The dev server proxies /api to the ASP.NET Core backend, so no CORS setup is needed.
// Start the API with: ASPNETCORE_URLS=http://localhost:5000 dotnet run --project ../src/VskOps.Api
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "VSK Gas Ops",
        short_name: "VSK Ops",
        description: "Gas cylinder distribution: orders, dispatch, deliveries, payments, reports.",
        theme_color: "#0F1316",
        background_color: "#0F1316",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache the app shell only. API responses are money data — always network,
        // never served stale from a cache.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/swagger/],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
});
