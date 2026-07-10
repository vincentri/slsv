import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiUrl = process.env.SLSV_API_URL;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: apiUrl
      ? {
          "/api": apiUrl,
          "/r": apiUrl,
        }
      : undefined,
  },
});
