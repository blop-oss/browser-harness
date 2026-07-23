import { describe, expect, test } from "bun:test";
import { setupToolPage, tool } from "./tool-fixture";

describe("navigation and wait browser tools", () => {
  test("waits for selectors and asserts URL", async () => {
    const fixture = await setupToolPage(`
      <main>
        <a href="/next">Next</a>
        <section data-ready="true">Ready section</section>
      </main>
    `);

    try {
      await tool(fixture.tools, "browser_wait_for_selector").execute({ selector: "section[data-ready='true']" });
      await tool(fixture.tools, "browser_click").execute({ target: "Next" });
      await tool(fixture.tools, "browser_expect_url").execute({ url: `${fixture.serverUrl}/next`, exact: true });
      const url = await tool(fixture.tools, "browser_get_url").execute({});

      expect(url.content).toBe(`${fixture.serverUrl}/next`);
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("waits for URL and navigates browser history", async () => {
    const fixture = await setupToolPage(`<main><a href="/next">Next</a></main>`);

    try {
      await tool(fixture.tools, "browser_click").execute({ target: "Next" });
      await tool(fixture.tools, "browser_wait_for_url").execute({ url: "/next" });
      await tool(fixture.tools, "browser_go_back").execute({});
      await tool(fixture.tools, "browser_expect_url").execute({ url: `${fixture.serverUrl}/`, exact: true });
      await tool(fixture.tools, "browser_go_forward").execute({});
      await tool(fixture.tools, "browser_expect_url").execute({ url: `${fixture.serverUrl}/next`, exact: true });
      await tool(fixture.tools, "browser_reload").execute({});
      await tool(fixture.tools, "browser_expect_text").execute({ text: "Next page" });
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("waits for active-page network requests to become idle", async () => {
    const fixture = await setupToolPage(
      `<button onclick="fetch('/slow').then(() => this.dataset.loaded='true')">Load data</button>`,
      [{
        path: "/slow",
        body: "ok",
        onRequest: async () => {
          await new Promise((resolve) => setTimeout(resolve, 250));
        },
      }],
    );

    try {
      await tool(fixture.tools, "browser_click").execute({ target: { role: "button", name: "Load data" } });
      const started = Date.now();
      const result = await tool(fixture.tools, "browser_wait_for_network_idle").execute({
        timeoutMs: 2000,
        idleMs: 100,
      });
      expect(Date.now() - started).toBeGreaterThanOrEqual(80);
      expect(result.metadata?.inflightRequests).toBe(0);
      expect(await fixture.page.getByRole("button").getAttribute("data-loaded")).toBe("true");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);
});
