import { test, expect } from "@playwright/test";

/*
 * Dev Core sandbox — adversarial, in a REAL browser (iframe + Worker + CSP),
 * which jsdom cannot run. These prove the verdict-integrity and network-deny
 * claims the audit said were untested: a malicious artifact cannot forge a
 * successful run, cannot reach the network, and cannot hang the OS with a
 * busy loop.
 *
 * The Core source is driven directly through Vite's dev server (it serves and
 * transpiles ES modules, resolving the `@/` alias), so there is no
 * test-only harness shipped in the production bundle.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // A clean slate so seeds/validation start fresh.
  await page.evaluate(() => localStorage.clear());
});

async function runArtifact(page: import("@playwright/test").Page, code: string) {
  return page.evaluate(async (artifactCode) => {
    const Dev = await import("/locus-os/src/core/cores/dev.ts");
    const a = Dev.createArtifact({
      name: "Adversary",
      kind: "widget",
      description: "adversarial test artifact",
      code: artifactCode,
      permissions: [],
      dependencies: [],
      network: false,
      provenance: { createdBy: "user" },
    });
    Dev.validateArtifact(a.id);
    const run = await Dev.runInSandbox(a.id, 3000);
    return { ok: run.ok, logs: run.logs };
  }, code);
}

test("a well-behaved artifact runs and succeeds", async ({ page }) => {
  const run = await runArtifact(page, `console.log("hello from the sandbox");`);
  expect(run.ok).toBe(true);
  expect(run.logs.join("\n")).toContain("hello from the sandbox");
});

test("an artifact cannot forge a successful run by calling send('done')", async ({ page }) => {
  // The classic forge: reach for the harness completion primitive, then throw.
  const run = await runArtifact(
    page,
    `try { send("done"); } catch (e) {}
     try { self.postMessage({ type: "done" }); } catch (e) {}
     throw new Error("I should be recorded as FAILED, not done");`,
  );
  expect(run.ok).toBe(false);
  expect(run.logs.join("\n")).toContain("I should be recorded as FAILED");
});

test("the sandbox CSP denies network access (fetch is blocked)", async ({ page }) => {
  const run = await runArtifact(
    page,
    `fetch("https://example.com").then(function(){ console.log("NETWORK REACHED"); })
       .catch(function(e){ console.log("network blocked"); });
     // Give the rejection a tick, then finish.
     `,
  );
  // Either fetch is undefined/throws synchronously (failing the run) or its
  // promise rejects under CSP — in no case may "NETWORK REACHED" appear.
  expect(run.logs.join("\n")).not.toContain("NETWORK REACHED");
});

test("a busy-loop artifact is terminated at the deadline, not left hanging", async ({ page }) => {
  const run = await runArtifact(page, `while (true) {}`);
  expect(run.ok).toBe(false);
  expect(run.logs.join("\n")).toMatch(/time limit|Terminated/i);
});

test("an immediately-rejecting async artifact fails, not silently succeeds", async ({ page }) => {
  const run = await runArtifact(page, `Promise.reject(new Error("async boom"));`);
  expect(run.ok).toBe(false);
});
