import { describe, expect, test } from "bun:test";
import { setupToolPage, tool } from "./tool-fixture";

describe("assertion browser tools", () => {
  test("asserts visibility, hidden state, values, checked state, enabled state, and attributes", async () => {
    const fixture = await setupToolPage(`
      <main>
        <h1>Visible title</h1>
        <p id="hidden" hidden>Hidden text</p>
        <label>Name <input name="name" value="Ada" /></label>
        <label><input type="checkbox" name="terms" checked /> Accept terms</label>
        <button>Enabled action</button>
        <button disabled>Disabled action</button>
        <a href="/next" data-state="ready">Next</a>
      </main>
    `);

    try {
      await tool(fixture.tools, "browser_expect_visible").execute({ target: "Visible title" });
      await tool(fixture.tools, "browser_expect_hidden").execute({ target: "#hidden" });
      await tool(fixture.tools, "browser_expect_value").execute({ target: "Name", value: "Ada" });
      await tool(fixture.tools, "browser_expect_checked").execute({ target: "Accept terms" });
      await tool(fixture.tools, "browser_expect_enabled").execute({ target: "Enabled action" });
      await tool(fixture.tools, "browser_expect_disabled").execute({ target: "Disabled action" });
      const attribute = await tool(fixture.tools, "browser_get_attribute").execute({ target: "Next", attribute: "data-state" });

      expect(attribute.content).toBe("ready");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("auto-retries assertions until async UI settles", async () => {
    const fixture = await setupToolPage(`
      <main>
        <label>City <input name="city" value="" /></label>
        <ul id="results"></ul>
        <script>
          setTimeout(() => {
            document.querySelector("input[name=city]").value = "Copenhagen";
            document.getElementById("results").innerHTML =
              "<li class='row'>Alpha</li><li class='row'>Beta</li><li class='row'>Gamma</li>";
          }, 400);
        </script>
      </main>
    `);

    try {
      await tool(fixture.tools, "browser_expect_value").execute({ target: "City", value: "Copenhagen" });
      await tool(fixture.tools, "browser_expect_count").execute({ target: ".row", count: 3 });
      await tool(fixture.tools, "browser_expect_count").execute({ target: ".row", count: 2, comparison: "at_least" });
      await tool(fixture.tools, "browser_expect_text").execute({ target: "#results", text: "Beta" });
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("accepts structured targets when waiting for an element to become hidden", async () => {
    const fixture = await setupToolPage(`<button aria-label="Dismiss">Close</button>`);

    try {
      await fixture.page.getByRole("button", { name: "Dismiss" }).evaluate((element) => {
        setTimeout(() => element.remove(), 50);
      });
      const result = await tool(fixture.tools, "browser_expect_hidden").execute({
        target: { role: "button", name: "Dismiss" },
        timeoutMs: 1000,
      });
      expect(result.content).toContain("is hidden");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("page text assertions ignore a hidden first duplicate", async () => {
    const fixture = await setupToolPage(`
      <main>
        <span hidden>Weekend</span>
        <h1>Weekend Forecast</h1>
      </main>
    `);

    try {
      await tool(fixture.tools, "browser_expect_text").execute({ text: "Weekend" });
      await tool(fixture.tools, "browser_wait_for_text").execute({ text: "Weekend" });
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("page text assertions normalize rendered block whitespace", async () => {
    const fixture = await setupToolPage(`
      <main>
        <h1>Weekend Forecast</h1>
        <p>Allenford, ON</p>
      </main>
    `);

    try {
      await tool(fixture.tools, "browser_expect_text").execute({ text: "Weekend Forecast Allenford, ON" });
      await tool(fixture.tools, "browser_expect_text").execute({
        target: "main",
        text: "Weekend Forecast Allenford, ON",
      });
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("asserts attributes and focus, and reports page context on failure", async () => {
    const fixture = await setupToolPage(`
      <main>
        <h1>Login</h1>
        <a href="/docs/setup" class="nav-link active">Setup guide</a>
        <input id="email" autofocus />
      </main>
    `);

    try {
      await tool(fixture.tools, "browser_expect_attribute").execute({ target: "Setup guide", attribute: "href", value: "/docs/setup" });
      await tool(fixture.tools, "browser_expect_attribute").execute({ target: "Setup guide", attribute: "class", value: "active", contains: true });
      await tool(fixture.tools, "browser_expect_focused").execute({ target: "#email" });

      const failure = await tool(fixture.tools, "browser_expect_value")
        .execute({ target: "#email", value: "missing", timeoutMs: 500 })
        .then(() => null, (error: Error) => error);
      expect(failure?.message).toContain("Expected #email value to be missing");
      expect(failure?.message).toContain("Page context:");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);
});
