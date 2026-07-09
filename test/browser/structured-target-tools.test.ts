import { describe, expect, test } from "bun:test";
import { setupToolPage, tool } from "./tool-fixture";

describe("structured browser targets", () => {
  test("targets elements by role/name, test id, label, and selector", async () => {
    const fixture = await setupToolPage(`
      <main>
        <button data-testid="save-button" onclick="this.textContent='Saved'">Save</button>
        <label>Email <input name="email" /></label>
        <p class="status">Ready</p>
      </main>
    `);

    try {
      await tool(fixture.tools, "browser_click").execute({ target: { role: "button", name: "Save", exact: true } });
      await tool(fixture.tools, "browser_expect_text").execute({ text: "Saved" });
      await tool(fixture.tools, "browser_type").execute({ target: { label: "Email", exact: true }, text: "ada@example.com" });
      await tool(fixture.tools, "browser_expect_value").execute({ target: { selector: "input[name='email']" }, value: "ada@example.com" });
      const attribute = await tool(fixture.tools, "browser_get_attribute").execute({ target: { testId: "save-button" }, attribute: "data-testid" });
      const text = await tool(fixture.tools, "browser_get_text").execute({ target: { selector: ".status" } });

      expect(attribute.content).toBe("save-button");
      expect(text.content).toBe("Ready");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("structured targets preserve strict matching errors", async () => {
    const fixture = await setupToolPage(`
      <main>
        <button>Duplicate</button>
        <button>Duplicate</button>
      </main>
    `);

    try {
      await expect(tool(fixture.tools, "browser_click").execute({ target: { role: "button", name: "Duplicate" } })).rejects.toThrow("strict mode violation");
      await tool(fixture.tools, "browser_click").execute({ target: { role: "button", name: "Duplicate", first: true } });
    } finally {
      await fixture.cleanup();
    }
  }, 15000);
});
