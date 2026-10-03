import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as WebModule from "./web";
import type * as MonitorModule from "./monitor";
import type * as BrokerModule from "../broker";

let Web: typeof WebModule;
let Monitor: typeof MonitorModule;
let Broker: typeof BrokerModule;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  Web = await import("./web");
  Monitor = await import("./monitor");
  Broker = await import("../broker");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("normalizeUrl", () => {
  it("accepts a bare domain, defaulting to https", () => {
    expect(Web.normalizeUrl("example.com")).toBe("https://example.com/");
  });

  it("preserves an explicit http(s) scheme", () => {
    expect(Web.normalizeUrl("http://example.com/path")).toBe("http://example.com/path");
  });

  it("rejects empty or whitespace-only input", () => {
    expect(Web.normalizeUrl("")).toBeNull();
    expect(Web.normalizeUrl("   ")).toBeNull();
  });

  it("rejects garbage text that cannot parse as a URL", () => {
    expect(Web.normalizeUrl("hello world")).toBeNull();
  });

  it("rejects a javascript: URL even though it parses", () => {
    expect(Web.normalizeUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects data: and file: schemes", () => {
    expect(Web.normalizeUrl("data:text/html,hi")).toBeNull();
    expect(Web.normalizeUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects a hostname with no dot (no recognizable TLD)", () => {
    expect(Web.normalizeUrl("https://localhost")).toBeNull();
    expect(Web.normalizeUrl("intranet")).toBeNull();
  });

  it("every SUGGESTED_PWAS entry is itself a valid, normalizable URL", () => {
    for (const pwa of Web.SUGGESTED_PWAS) {
      expect(Web.normalizeUrl(pwa.url)).not.toBeNull();
    }
  });
});

describe("addWebApp / removeWebApp", () => {
  it("rejects an invalid URL, adding nothing", () => {
    expect(Web.addWebApp({ name: "Bad", url: "not a url" })).toBeNull();
    expect(Web.listWebApps()).toHaveLength(0);
  });

  it("defaults the name to the hostname when none is given", () => {
    const app = Web.addWebApp({ name: "  ", url: "https://example.com" });
    expect(app?.name).toBe("example.com");
  });

  it("de-duplicates by normalized URL, returning the existing entry", () => {
    const first = Web.addWebApp({ name: "Example", url: "example.com" });
    const second = Web.addWebApp({ name: "Example again", url: "https://example.com/" });
    expect(second?.id).toBe(first?.id);
    expect(Web.listWebApps()).toHaveLength(1);
  });

  it("removeWebApp deletes the entry", () => {
    const app = Web.addWebApp({ name: "Example", url: "example.com" })!;
    Web.removeWebApp(app.id);
    expect(Web.listWebApps()).toHaveLength(0);
  });
});

describe("openWebApp / openUrl", () => {
  it("openWebApp opens the URL, bumps openCount/lastOpenedAt, audited", () => {
    const spy = vi.spyOn(window, "open").mockImplementation(() => null);
    const app = Web.addWebApp({ name: "Example", url: "example.com" })!;
    Web.openWebApp(app.id);
    expect(spy).toHaveBeenCalledWith(app.url, "_blank", "noopener,noreferrer");
    const updated = Web.listWebApps()[0];
    expect(updated.openCount).toBe(1);
    expect(updated.lastOpenedAt).toBeDefined();
  });

  it("openWebApp is a no-op for an unknown id", () => {
    const spy = vi.spyOn(window, "open").mockImplementation(() => null);
    Web.openWebApp("missing");
    expect(spy).not.toHaveBeenCalled();
  });

  it("openUrl returns false and does not open anything for an invalid URL", () => {
    const spy = vi.spyOn(window, "open").mockImplementation(() => null);
    expect(Web.openUrl("not a url")).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("openUrl opens a normalized URL and returns true", () => {
    const spy = vi.spyOn(window, "open").mockImplementation(() => null);
    expect(Web.openUrl("example.com")).toBe(true);
    expect(spy).toHaveBeenCalledWith("https://example.com/", "_blank", "noopener,noreferrer");
  });
});

describe("normalizeFetchUrl — strict AI-fetch policy (2026-07-10 audit)", () => {
  it("accepts a plain https URL", () => {
    expect(Web.normalizeFetchUrl("https://example.com/page")).toBe("https://example.com/page");
  });
  it("rejects http, URL userinfo, and private/loopback hosts", () => {
    expect(Web.normalizeFetchUrl("http://example.com")).toBeNull();
    expect(Web.normalizeFetchUrl("https://user:pass@example.com")).toBeNull();
    expect(Web.normalizeFetchUrl("https://localhost/admin")).toBeNull();
    expect(Web.normalizeFetchUrl("https://127.0.0.1/")).toBeNull();
    expect(Web.normalizeFetchUrl("https://192.168.1.1/")).toBeNull();
    expect(Web.normalizeFetchUrl("https://169.254.169.254/latest/meta-data")).toBeNull();
    expect(Web.normalizeFetchUrl("https://10.0.0.5/")).toBeNull();
  });

  it("does NOT misclassify public domains that start with fc/fd/fe80 as private", () => {
    // The IPv6 ULA/link-local prefix checks must apply only to IPv6 literals,
    // not to any hostname (regression guard: fcc.gov, fda.gov, fdic.gov).
    expect(Web.normalizeFetchUrl("https://fcc.gov")).toBe("https://fcc.gov/");
    expect(Web.normalizeFetchUrl("https://fda.gov")).toBe("https://fda.gov/");
    expect(Web.normalizeFetchUrl("https://fdic.gov")).toBe("https://fdic.gov/");
  });

  it("blocks IPv6 loopback and IPv4-mapped metadata addresses", () => {
    expect(Web.normalizeFetchUrl("https://[::1]/")).toBeNull();
    expect(Web.normalizeFetchUrl("https://[::ffff:169.254.169.254]/")).toBeNull();
  });
});

describe("requestPageContext + capturePageContext (mocked fetch)", () => {
  it("returns null for an unknown web app", async () => {
    expect(await Web.requestPageContext("missing", "test")).toBeNull();
  });

  it("captures title/description on a readable page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          `<html><head><title>Example Site</title><meta name="description" content="An example."></head></html>`,
          { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
        ),
      ),
    );
    const app = Web.addWebApp({ name: "Example", url: "example.com" })!;
    Web.initWebCore();
    const proposal = await Web.requestPageContext(app.id, "summarize");
    expect(proposal).not.toBeNull();
    if (proposal!.status === "pending") await Broker.approve(proposal!.id);

    await vi.waitFor(() => {
      expect(Web.listPageContexts()).toHaveLength(1);
    });
    const ctx = Web.listPageContexts()[0];
    expect(ctx.readable).toBe(true);
    expect(ctx.title).toBe("Example Site");
    expect(ctx.description).toBe("An example.");
  });

  it("records an honest unreadable result on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    const app = Web.addWebApp({ name: "Example", url: "example.com" })!;
    Web.initWebCore();
    const proposal = (await Web.requestPageContext(app.id, "summarize"))!;
    if (proposal.status === "pending") await Broker.approve(proposal.id);

    await vi.waitFor(() => {
      expect(Web.listPageContexts()).toHaveLength(1);
    });
    expect(Web.listPageContexts()[0].readable).toBe(false);
    expect(Web.listPageContexts()[0].note).toContain("404");
  });

  it("records an honest unreadable result on a network/CORS error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("blocked")));
    const app = Web.addWebApp({ name: "Example", url: "example.com" })!;
    Web.initWebCore();
    const proposal = (await Web.requestPageContext(app.id, "summarize"))!;
    if (proposal.status === "pending") await Broker.approve(proposal.id);

    await vi.waitFor(() => {
      expect(Web.listPageContexts()).toHaveLength(1);
    });
    expect(Web.listPageContexts()[0].readable).toBe(false);
    expect(Web.listPageContexts()[0].note).toContain("cross-origin");
  });
});

describe("createPageWatch", () => {
  it("creates a Monitor Core webpage watch sourced from the saved app's URL", () => {
    const app = Web.addWebApp({ name: "Example", url: "example.com" })!;
    const watch = Web.createPageWatch(app.id);
    expect(watch?.type).toBe("webpage");
    expect(watch?.params.url).toBe(app.url);
    expect(watch?.params.checkEnabled).toBe(true);
    expect(Monitor.listWatches().map((w) => w.id)).toEqual([watch!.id]);
  });

  it("returns null for an unknown web app", () => {
    expect(Web.createPageWatch("missing")).toBeNull();
  });
});
