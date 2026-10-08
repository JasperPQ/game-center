import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dayTheme } from "./day-theme";
import { palette } from "./day-palette";

export default defineConfig({
  plugins: [react(), dayTheme(palette)],
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      "/socket.io": { target: "http://localhost:3000", ws: true },
      "/health": "http://localhost:3000",
      "/api": "http://localhost:3000"
    }
  }
});
