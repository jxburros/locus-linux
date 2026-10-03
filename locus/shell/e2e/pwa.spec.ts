import { test, expect } from "@playwright/test";

/*
 * PWA offline launch, against the PRODUCTION preview (the only build where the
 * service worker registers) — jsdom cannot run a service worker at all. Proves
 * the offline-first-launch gate: after one online visit installs and precaches
 * the shell, a reload with the network cut still boots the app.
 *
 * Served by the second webServer (preview on 4174); this spec uses absolute
 * URLs to reach it regardless of the default baseURL.
 */

const PREVIEW = "http://localhost:4174/locus-os/";

test("service worker registers and controls the page in the production build", async ({ page }) => {
  await page.goto(PREVIEW);
  const controlled = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(controlled).toBe(true);
});

test("the app launches offline after one online visit", async ({ page, context }) => {
  await page.goto(PREVIEW);
  // Wait for the service worker to install + precache and take control.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await new Promise((r) => setTimeout(r, 1000));
  });
  // One reload while still online, so this navigation is served by the now-
  // controlling SW (the page that registered it was not yet controlled).
  await page.reload();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));

  // Cut the network entirely, then reload — the SW must serve the shell.
  await context.setOffline(true);
  await page.reload();
  // The shell root mounts something (the desktop/onboarding), not a browser
  // "offline" error page.
  await expect(page.locator("#root")).not.toBeEmpty({ timeout: 15_000 });
  await context.setOffline(false);
});
