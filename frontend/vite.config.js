import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The dev server proxies /api to the ASP.NET Core backend, so no CORS setup is needed.
// Start the API with: ASPNETCORE_URLS=http://localhost:5000 dotnet run --project ../src/VskOps.Api
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
});
