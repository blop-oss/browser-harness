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
      expect(fixture.actions.at(-1)?.metadata?.error).toContain("strict mode violation");
      await tool(fixture.tools, "browser_click").execute({ target: { role: "button", name: "Duplicate", first: true } });
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("uses snapshot-scoped element references and rejects old snapshots", async () => {
    const fixture = await setupToolPage(`
      <main>
        <button data-position="first" onclick="this.dataset.clicked='true'">Save</button>
        <button data-position="second" onclick="this.dataset.clicked='true'">Save</button>
      </main>
    `);

    try {
      const first = await tool(fixture.tools, "browser_snapshot").execute({});
      const firstSnapshot = JSON.parse(first.content) as {
        semanticSnapshot: string;
      };
      const saves = [...firstSnapshot.semanticSnapshot.matchAll(/\[(s1:e\d+)\] button "Save"/g)];
      const saveRef = saves[1]?.[1];
      expect(saves).toHaveLength(2);
      expect(saveRef).toMatch(/^s1:e\d+$/);

      await tool(fixture.tools, "browser_click").execute({ target: { ref: saveRef } });
      expect(await fixture.page.locator("[data-position='first']").getAttribute("data-clicked")).toBeNull();
      expect(await fixture.page.locator("[data-position='second']").getAttribute("data-clicked")).toBe("true");

      await tool(fixture.tools, "browser_snapshot").execute({});
      await expect(tool(fixture.tools, "browser_click").execute({ target: { ref: saveRef } }))
        .rejects.toThrow("Unknown or stale element reference");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);
});
