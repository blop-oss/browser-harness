import { describe, expect, test } from "bun:test";
import { setupToolPage, tool } from "./tool-fixture";

describe("keyboard browser tools", () => {
  test("fills, clears, and presses keys", async () => {
    const fixture = await setupToolPage(`
      <main>
        <label>Name <input name="name" /></label>
        <button onclick="setTimeout(() => document.querySelector('#status').textContent='Saved Ada', 20)">Save</button>
        <p id="status">Idle</p>
      </main>
    `);

    try {
      await tool(fixture.tools, "browser_type").execute({ target: "Name", text: "Ada" });
      await tool(fixture.tools, "browser_press").execute({ target: "Name", key: "Control+A" });
      await tool(fixture.tools, "browser_press").execute({ target: "Name", key: "Backspace" });
      await tool(fixture.tools, "browser_type").execute({ target: "Name", text: "Ada" });
      await tool(fixture.tools, "browser_click").execute({ target: "Save" });
      await tool(fixture.tools, "browser_wait_for_text").execute({ text: "Saved Ada", timeoutMs: 1000 });

      expect(await fixture.page.locator("input[name='name']").inputValue()).toBe("Ada");

      await tool(fixture.tools, "browser_clear").execute({ target: "Name" });
      expect(await fixture.page.locator("input[name='name']").inputValue()).toBe("");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("tabs focus forward and backward", async () => {
    const fixture = await setupToolPage(`
      <main>
        <label>First <input name="first" /></label>
        <label>Second <input name="second" /></label>
      </main>
    `);

    try {
      await tool(fixture.tools, "browser_focus").execute({ target: "First" });
      await tool(fixture.tools, "browser_tab").execute({});
      expect(await fixture.page.evaluate(() => document.activeElement?.getAttribute("name"))).toBe("second");

      await tool(fixture.tools, "browser_tab").execute({ shift: true });
      expect(await fixture.page.evaluate(() => document.activeElement?.getAttribute("name"))).toBe("first");

      await tool(fixture.tools, "browser_blur").execute({});
      expect(await fixture.page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);
});
