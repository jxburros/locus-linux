/*
 * Locus service worker.
 * ---------------------------------------------------------------------------
 * Small and legible on purpose (no build step beyond one manifest injection,
 * no Workbox). It precaches the app shell (HTML, manifest, icons) AND the
 * hashed JS/CSS bundles on install, so even the very first launch is fully
 * offline-capable — no "one online load first" caveat.
 *
 * The hashed bundle filenames only exist after a build, so the build injects
 * them into the BUILD_ASSETS constant below (a Vite plugin replaces its
 * placeholder token with the real emitted-asset list). Anything the injection
 * misses is still runtime-cached on first fetch as a backstop.
 *
 * All Locus caches are named with the LOCUS_CACHE_PREFIX so activation only
 * ever deletes its OWN old caches — on a shared origin (e.g. *.github.io)
 * another project's caches must never be collateral.
 *
 * Bump CACHE_VERSION to invalidate old caches on deploy (the injected asset
 * hashes also change the SW body, which retriggers install on deploy).
 */

const LOCUS_CACHE_PREFIX = "locus-";
const CACHE_VERSION = "locus-v4-svg";
const BASE_PATH = "/locus-os/";
/** Build-time-injected hashed bundle paths (JS/CSS). Empty in dev. */
const BUILD_ASSETS = __BUILD_ASSETS__;
const APP_SHELL = [
  BASE_PATH,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.webmanifest`,
  `${BASE_PATH}icons/icon.svg`,
  ...BUILD_ASSETS,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        // Only delete OUR own superseded caches — never another project's on a
        // shared origin. Prefix-scoped, not "everything that isn't me".
        Promise.all(
          keys
            .filter((k) => k.startsWith(LOCUS_CACHE_PREFIX) && k !== CACHE_VERSION)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the cached shell first, fall back to network, and keep
  // the shell fresh in the background. Guarantees an instant, offline launch.
  if (request.mode === "navigate") {
    event.respondWith(
      caches.match(`${BASE_PATH}index.html`, { ignoreSearch: true }).then((cached) => {
        const network = fetch(request)
          .then((res) => {
            // Only replace the cached shell with a real, OK, same-origin
            // document — never a 404 body or an error page. Keep the write
            // alive past respondWith with waitUntil so it can't be killed.
            if (res.ok && res.type === "basic") {
              const copy = res.clone();
              event.waitUntil(
                caches.open(CACHE_VERSION).then((c) => c.put(`${BASE_PATH}index.html`, copy)),
              );
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  // Static assets: cache-first, then populate the cache on first fetch.
  // ignoreVary/ignoreSearch so a cached asset still matches when the runtime
  // request carries headers (e.g. a preview/host Vary) the precached Request
  // did not — otherwise an offline launch misses its own precached bundles.
  event.respondWith(
    caches.match(request, { ignoreVary: true, ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
    }),
  );
});
