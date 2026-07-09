import { describe, expect, test } from "bun:test";
import { createBrowserTools } from "../../src/create-tools.js";
import type { HarnessBrowserLog } from "../../src/types.js";
import { setupToolPage, tool } from "./tool-fixture";

describe("extract browser tool", () => {
  test("extracts text and attributes from every match in one call", async () => {
    const fixture = await setupToolPage(`
      <main>
        <ul>
          <li class="product" data-price="19">Notebook — $19</li>
          <li class="product" data-price="7">Pen — $7</li>
          <li class="product" data-price="42">Backpack — $42</li>
        </ul>
      </main>
    `);

    try {
      const result = await tool(fixture.tools, "browser_extract").execute({
        target: ".product",
        fields: ["text", "attribute:data-price"],
      });
      const payload = JSON.parse(result.content);

      expect(payload.total).toBe(3);
      expect(payload.truncated).toBe(false);
      expect(payload.items.map((item: Record<string, string>) => item["attribute:data-price"])).toEqual(["19", "7", "42"]);
      expect(payload.items[2].text).toContain("Backpack");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("caps returned items at the requested limit and flags truncation", async () => {
    const items = Array.from({ length: 8 }, (_, index) => `<li class="row">Row ${index + 1}</li>`).join("");
    const fixture = await setupToolPage(`<ul>${items}</ul>`);

    try {
      const result = await tool(fixture.tools, "browser_extract").execute({ target: ".row", limit: 3 });
      const payload = JSON.parse(result.content);

      expect(payload.total).toBe(8);
      expect(payload.returned).toBe(3);
      expect(payload.truncated).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  }, 15000);
});

describe("batch browser tool", () => {
  test("runs a sequence of tools in one call and records each step action", async () => {
    const fixture = await setupToolPage(`
      <main>
        <label>Name <input name="name" /></label>
        <button onclick="document.getElementById('done').textContent = 'Saved ' + document.querySelector('input').value">Save</button>
        <p id="done"></p>
      </main>
    `);

    try {
      const result = await tool(fixture.tools, "browser_run_steps").execute({
        steps: [
          { tool: "browser_type", input: { target: "Name", text: "Ada" } },
          { tool: "browser_click", input: { target: "Save" } },
          { tool: "browser_expect_text", input: { text: "Saved Ada" } },
        ],
      });
      const summary = JSON.parse(result.content);

      expect(summary.status).toBe("passed");
      expect(summary.completedSteps).toBe(3);
      const batchedActions = fixture.actions.map((action) => action.name);
      expect(batchedActions).toContain("browser_type");
      expect(batchedActions).toContain("browser_click");
      expect(batchedActions).toContain("browser_expect_text");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("stops at the first failing step and reports its index", async () => {
    const fixture = await setupToolPage(`<main><h1>Home</h1></main>`);

    try {
      const result = await tool(fixture.tools, "browser_run_steps").execute({
        steps: [
          { tool: "browser_expect_text", input: { text: "Home" } },
          { tool: "browser_expect_text", input: { text: "Does not exist", timeoutMs: 300 } },
          { tool: "browser_expect_text", input: { text: "Home" } },
        ],
      });
      const summary = JSON.parse(result.content);

      expect(summary.status).toBe("failed");
      expect(summary.failedStep).toBe(2);
      expect(summary.completedSteps).toBe(1);
      expect(summary.steps).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("refuses finish_test and nested batches inside a batch", async () => {
    const fixture = await setupToolPage(`<main><h1>Home</h1></main>`);

    try {
      const result = await tool(fixture.tools, "browser_run_steps").execute({
        steps: [{ tool: "finish_test", input: { status: "passed", reason: "nope" } }],
      });
      const summary = JSON.parse(result.content);

      expect(summary.status).toBe("failed");
      expect(summary.steps[0].output).toContain("disallowed");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);
});

describe("console logs browser tool", () => {
  test("returns collected errors and failed requests as evidence", async () => {
    const browserLogs: HarnessBrowserLog[] = [
      { type: "console", level: "log", message: "boot ok", timestamp: "2026-06-11T00:00:00.000Z", url: "http://app.local/" },
      { type: "console", level: "error", message: "TypeError: cart is undefined", timestamp: "2026-06-11T00:00:01.000Z", url: "http://app.local/checkout" },
      { type: "requestfailed", message: "net::ERR_CONNECTION_REFUSED", timestamp: "2026-06-11T00:00:02.000Z", url: "http://app.local/api/cart" },
    ];
    const tools = await createBrowserTools({
      page: { url: () => "http://app.local/checkout" } as never,
      testId: "test_logs",
      screenshotDir: ".blop-test-screenshots",
      actions: [],
      screenshots: [],
      finishState: { status: null, reason: null },
      browserLogs,
    });

    const errorsOnly = await tools.find((candidate) => candidate.name === "browser_console_logs")!.execute({});
    expect(errorsOnly.content).toContain("TypeError: cart is undefined");
    expect(errorsOnly.content).toContain("net::ERR_CONNECTION_REFUSED");
    expect(errorsOnly.content).not.toContain("boot ok");

    const everything = await tools.find((candidate) => candidate.name === "browser_console_logs")!.execute({ level: "all" });
    expect(everything.content).toContain("boot ok");
  });

  test("tags request failures as first-party vs third-party and warns about sandbox blocks", async () => {
    const browserLogs: HarnessBrowserLog[] = [
      { type: "requestfailed", message: "net::ERR_FAILED", timestamp: "2026-06-20T09:17:01.000Z", url: "https://api.web3forms.com/submit" },
      { type: "requestfailed", message: "net::ERR_FAILED", timestamp: "2026-06-20T09:17:02.000Z", url: "https://api.stripe.com/v1/payment_intents" },
      { type: "requestfailed", message: "net::ERR_CONNECTION_REFUSED", timestamp: "2026-06-20T09:17:03.000Z", url: "http://app.local/api/contact" },
    ];
    const tools = await createBrowserTools({
      page: { url: () => "http://app.local/contact" } as never,
      testId: "test_scope",
      screenshotDir: ".blop-test-screenshots-scope",
      actions: [],
      screenshots: [],
      finishState: { status: null, reason: null },
      browserLogs,
    });

    const result = await tools.find((candidate) => candidate.name === "browser_console_logs")!.execute({});
    // Third-party failures are tagged so the agent can tell they are not app bugs.
    expect(result.content).toContain("api.web3forms.com/submit");
    expect(result.content).toContain("[third-party]");
    expect(result.content).toContain("api.stripe.com/v1/payment_intents");
    // First-party failures are tagged as real app bugs.
    expect(result.content).toContain("http://app.local/api/contact");
    expect(result.content).toContain("[first-party]");
    // The sandbox caveat is surfaced when any third-party failure is present.
    expect(result.content).toContain("test-environment limitation");
    expect(result.metadata?.thirdPartyFailures).toBe(2);
  });

  test("does not emit the third-party caveat when only first-party failures are present", async () => {
    const browserLogs: HarnessBrowserLog[] = [
      { type: "requestfailed", message: "net::ERR_CONNECTION_REFUSED", timestamp: "2026-06-20T09:17:03.000Z", url: "http://app.local/api/cart" },
    ];
    const tools = await createBrowserTools({
      page: { url: () => "http://app.local/checkout" } as never,
      testId: "test_scope_only_first",
      screenshotDir: ".blop-test-screenshots-only-first",
      actions: [],
      screenshots: [],
      finishState: { status: null, reason: null },
      browserLogs,
    });

    const result = await tools.find((candidate) => candidate.name === "browser_console_logs")!.execute({});
    expect(result.content).toContain("http://app.local/api/cart");
    expect(result.content).toContain("[first-party]");
    expect(result.content).not.toContain("test-environment limitation");
    expect(result.metadata?.thirdPartyFailures).toBe(0);
  });
});
