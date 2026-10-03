import { test, expect, type Page } from "@playwright/test";

/*
 * devwidget tile runtime — a REAL browser (iframe + postMessage), which
 * jsdom cannot exercise. Modeled on sandbox.spec.ts: the Core source is
 * driven directly through Vite's dev server via page.evaluate, so there is
 * no test-only harness shipped in the production bundle.
 *
 * These prove the claims buildWidgetSrcdoc/handleWidgetRpc make: a devwidget
 * can only reach the OS through the declared, permission-gated RPC — never
 * the network (its own CSP denies it) — and an undeclared request kind is
 * refused, not silently answered.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // A clean slate so seeds/validation start fresh.
  await page.evaluate(() => localStorage.clear());
});

/**
 * Create, validate, sandbox-run (a REAL Worker run — this is a real browser),
 * and install a widget artifact, then mount it via buildWidgetSrcdoc exactly
 * as DevWidgetTile would: an opaque-origin iframe, a page-side message
 * listener that answers "locus-widget-rpc" requests through handleWidgetRpc,
 * and posts the reply back with the same token+seq. The artifact code
 * reports its own findings back to the parent via a distinct message type
 * (not the RPC channel) so the test can read results without reaching into
 * the iframe's cross-origin document.
 */
async function setupInstalledWidget(
  page: Page,
  code: string,
  permissions: string[],
): Promise<{ ok: boolean; artifactId: string }> {
  return page.evaluate(
    async ({ code, permissions }) => {
      const Dev = await import("/locus-os/src/core/cores/dev.ts");
      const a = Dev.createArtifact({
        name: "E2E devwidget",
        kind: "widget",
        description: "adversarial devwidget test artifact",
        code,
        permissions,
        dependencies: [],
        network: false,
        provenance: { createdBy: "user" },
      });
      Dev.validateArtifact(a.id);
      const run = await Dev.runInSandbox(a.id, 3000);
      if (!run.ok) return { ok: false, artifactId: a.id };
      const installed = Dev.installArtifact(a.id);
      return { ok: !!installed, artifactId: a.id };
    },
    { code, permissions },
  );
}

/** Mount the installed artifact as a real devwidget iframe and collect every
    `{ type: "test-result", text }` message the artifact code reports, up to
    `expectedCount` or a timeout. */
async function mountAndCollect(
  page: Page,
  artifactId: string,
  expectedCount: number,
): Promise<string[]> {
  return page.evaluate(
    async ({ artifactId, expectedCount }) => {
      const Dev = await import("/locus-os/src/core/cores/dev.ts");
      const a = Dev.getArtifact(artifactId);
      if (!a) return ["ARTIFACT_MISSING"];

      const token = `e2e-tok-${Math.random().toString(36).slice(2)}`;
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.srcdoc = Dev.buildWidgetSrcdoc(a, token);
      document.body.appendChild(iframe);

      const results: string[] = [];
      const onMessage = (e: MessageEvent) => {
        if (e.source !== iframe.contentWindow) return;
        const d = e.data as { type?: string; text?: string; token?: string; seq?: number; kind?: string } | null;
        if (!d) return;
        if (d.type === "test-result") {
          results.push(String(d.text));
          return;
        }
        if (d.token !== token || d.type !== "locus-widget-rpc") return;
        Dev.handleWidgetRpc(artifactId, String(d.kind)).then(
          (res: { ok: true; data: string } | { ok: false; reason: string }) => {
            iframe.contentWindow?.postMessage({ token, seq: d.seq, ...res }, "*");
          },
        );
      };
      window.addEventListener("message", onMessage);

      const deadline = Date.now() + 4000;
      while (results.length < expectedCount && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      window.removeEventListener("message", onMessage);
      iframe.remove();
      return results;
    },
    { artifactId, expectedCount },
  );
}

test("a devwidget's RPC round-trip delivers declared data and its own fetch is blocked by the CSP", async ({
  page,
}) => {
  const code = `
    if (typeof document !== "undefined" && typeof locus !== "undefined") {
      var report = function (text) { parent.postMessage({ type: "test-result", text: text }, "*"); };
      locus.request("time.upcoming").then(
        function (data) { report("TIME_OK:" + data); },
        function (reason) { report("TIME_ERR:" + reason); }
      );
      fetch("https://example.com").then(
        function () { report("NETWORK REACHED"); }
      ).catch(function (e) { report("network blocked: " + (e && e.message)); });
    } else {
      console.log("sandbox check: no document/locus here");
    }
  `;
  const setup = await setupInstalledWidget(page, code, ["time.read"]);
  expect(setup.ok).toBe(true);

  const results = await mountAndCollect(page, setup.artifactId, 2);
  const joined = results.join(" | ");
  expect(joined).toContain("TIME_OK:");
  expect(joined).not.toContain("NETWORK REACHED");
});

test("an undeclared RPC kind is refused, not answered", async ({ page }) => {
  const code = `
    if (typeof document !== "undefined" && typeof locus !== "undefined") {
      var report = function (text) { parent.postMessage({ type: "test-result", text: text }, "*"); };
      locus.request("not.a.declared.kind").then(
        function (data) { report("UNDECLARED_OK:" + data); },
        function (reason) { report("UNDECLARED_DENIED:" + reason); }
      );
    } else {
      console.log("sandbox check: no document/locus here");
    }
  `;
  // Declares no permissions at all — even if the kind existed, it would still
  // need a declared permission; here the kind itself is not recognized.
  const setup = await setupInstalledWidget(page, code, []);
  expect(setup.ok).toBe(true);

  const results = await mountAndCollect(page, setup.artifactId, 1);
  expect(results.join(" | ")).toContain("UNDECLARED_DENIED:");
});
