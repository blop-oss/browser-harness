import { describe, expect, test } from "bun:test";
import { setupToolPage, tool } from "./tool-fixture";

describe("tab/popup browser tools", () => {
  test("lists, selects, and closes a popup opened by the app", async () => {
    const fixture = await setupToolPage(`
      <main>
        <button id="open-popup">Open popup</button>
        <a href="/next" target="_blank">Open tab</a>
      </main>
      <script>
        document.getElementById("open-popup").addEventListener("click", () => {
          const popup = window.open("", "popup", "width=400,height=300");
          popup.document.write("<h1>Popup content</h1><p>Hello from popup</p>");
        });
      </script>
    `);

    try {
      // Trigger a window.open popup.
      await tool(fixture.tools, "browser_click").execute({ target: "Open popup" });

      // The popup opens asynchronously; the registry appends it on context.on("page").
      // List pages until two appear.
      let listed: { index: number; url: string; title: string; active: boolean }[] = [];
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const result = await tool(fixture.tools, "browser_list_pages").execute({});
        const parsed = (result.metadata?.pages ?? []) as { index: number; url: string; title: string; active: boolean }[];
        if (parsed.length >= 2) {
          listed = parsed;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(listed.length).toBeGreaterThanOrEqual(2);
      expect(listed[0].active).toBe(true);

      // Switch to the popup (index 1).
      await tool(fixture.tools, "browser_select_page").execute({ index: 1 });

      // Now snapshot reflects the popup's content, not the main page.
      const snapshot = await tool(fixture.tools, "browser_snapshot").execute({});
      expect(snapshot.content).toContain("Hello from popup");

      // Listing again marks the popup as active.
      const afterSelect = await tool(fixture.tools, "browser_list_pages").execute({});
      const parsedAfter = (afterSelect.metadata?.pages ?? []) as { index: number; active: boolean }[];
      expect(parsedAfter.find((entry) => entry.index === 1)?.active).toBe(true);

      // Close the popup and confirm we fall back to the main page.
      await tool(fixture.tools, "browser_close_page").execute({ index: 1 });
      const snapshotAfterClose = await tool(fixture.tools, "browser_snapshot").execute({});
      expect(String(snapshotAfterClose.metadata?.url).replace(/\/$/, "")).toBe(fixture.serverUrl);
    } finally {
      await fixture.cleanup();
    }
  }, 20000);

  test("rejects closing the main page", async () => {
    const fixture = await setupToolPage(`<main><h1>Main</h1></main>`);
    try {
      await expect(tool(fixture.tools, "browser_close_page").execute({ index: 0 })).rejects.toThrow(
        /Refusing to close the main page/,
      );
    } finally {
      await fixture.cleanup();
    }
  });

  test("rejects selecting an out-of-range index", async () => {
    const fixture = await setupToolPage(`<main><h1>Main</h1></main>`);
    try {
      await expect(tool(fixture.tools, "browser_select_page").execute({ index: 99 })).rejects.toThrow(
        /Invalid page index/,
      );
    } finally {
      await fixture.cleanup();
    }
  });
});