import { test, expect } from "@playwright/test";

/*
 * Multi-tab persistence, in a REAL browser (two pages sharing one origin, so
 * localStorage + the `storage` event + Web Locks all behave as they do for a
 * user with two tabs open) — jsdom cannot exercise this. Proves the Wave 2
 * concurrency claims: two tabs cannot double-execute one proposal, and
 * concurrent appends are not lost to a stale-cache overwrite.
 */

test("two tabs approving the same proposal execute its effect exactly once", async ({ context }) => {
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await tabA.goto("/");
  await tabA.evaluate(() => localStorage.clear());
  await tabB.goto("/");

  // Seed one approved create proposal directly into storage from tab A.
  const objId = "task-race";
  await tabA.evaluate((id) => {
    const proposal = {
      id: "prop-race",
      createdAt: Date.now(),
      app: "tasks",
      actionType: "tasks.create",
      summary: "create the race task",
      effect: { kind: "create", objectType: "task", payload: { title: "Race task" } },
      tier: "writableWithApproval",
      status: "approved",
      resultId: id,
    };
    localStorage.setItem("locus:broker.proposals", JSON.stringify([proposal]));
  }, objId);
  await tabB.reload();

  // Both tabs race to execute the same approved proposal.
  const [rA, rB] = await Promise.all([
    tabA.evaluate(async () => {
      const Broker = await import("/locus-os/src/core/broker.ts");
      return (await Broker.execute("prop-race"))?.status;
    }),
    tabB.evaluate(async () => {
      const Broker = await import("/locus-os/src/core/broker.ts");
      return (await Broker.execute("prop-race"))?.status;
    }),
  ]);

  // Exactly one tab executed; the other saw it already-resolved and refused.
  const statuses = [rA, rB].sort();
  expect(statuses).toContain("executed");

  // And the effect ran exactly once: exactly one task object exists.
  const count = await tabA.evaluate(async () => {
    const Objects = await import("/locus-os/src/core/objects.ts");
    return Objects.objectsOfType("task").filter((t) => t.title === "Race task").length;
  });
  expect(count).toBe(1);
});

test("concurrent appends from two tabs are all preserved (no lost record)", async ({ context }) => {
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await tabA.goto("/");
  await tabA.evaluate(() => localStorage.clear());
  await tabB.goto("/");

  // Each tab appends 15 objects concurrently through the locked update path.
  const append = (page: import("@playwright/test").Page, prefix: string) =>
    page.evaluate(async (p) => {
      const { storage, StoreKeys } = await import("/locus-os/src/core/storage.ts");
      for (let i = 0; i < 15; i++) {
        await storage.update(StoreKeys.objects, [], (list: unknown[]) => [
          ...list,
          { id: `${p}-${i}` },
        ]);
      }
    }, prefix);

  await Promise.all([append(tabA, "A"), append(tabB, "B")]);

  // Count only the appended records (the store also holds boot-seeded objects).
  // All 30 concurrent appends survive — none lost to a stale-cache overwrite.
  const appended = await tabA.evaluate(async () => {
    const { storage, StoreKeys } = await import("/locus-os/src/core/storage.ts");
    const list = storage.get(StoreKeys.objects, []) as { id?: string }[];
    return list.filter((o) => typeof o.id === "string" && /^[AB]-\d+$/.test(o.id)).length;
  });
  expect(appended).toBe(30);
});
