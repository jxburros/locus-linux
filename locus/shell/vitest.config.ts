import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Test-only config, separate from vite.config.ts so build/dev stay untouched.
// jsdom gives Core modules a real localStorage/window (src/core/storage.ts
// depends on both), matching the browser runtime Locus actually ships to.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
  },
});
