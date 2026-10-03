import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "/locus-os/";

/**
 * Inject the built hashed JS/CSS asset paths into the hand-written service
 * worker so the first launch is fully offline-capable (no "one online load
 * first" caveat). Replaces the __BUILD_ASSETS__ placeholder in dist/sw.js
 * with the real emitted-asset list after the bundle is written.
 */
function swPrecacheManifest(): Plugin {
  const assets: string[] = [];
  return {
    name: "locus-sw-precache-manifest",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const file of Object.keys(bundle)) {
        if (file.endsWith(".js") || file.endsWith(".css")) assets.push(`${BASE}${file}`);
      }
    },
    closeBundle() {
      const swPath = resolve(__dirname, "dist/sw.js");
      try {
        const src = readFileSync(swPath, "utf8");
        writeFileSync(
          swPath,
          src.replace("const BUILD_ASSETS = __BUILD_ASSETS__;", `const BUILD_ASSETS = ${JSON.stringify(assets)};`),
        );
      } catch (err) {
        this.warn(`Could not inject precache manifest into sw.js: ${String(err)}`);
      }
    },
  };
}

// Locus build config. Kept intentionally small: React plugin, a path alias,
// and the service-worker precache-manifest injection. The service worker and
// manifest live in /public and are copied verbatim, then sw.js gets its asset
// list injected so the PWA layer stays transparent and dependency-free.
export default defineConfig({
  base: BASE,
  plugins: [react(), swPrecacheManifest()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
