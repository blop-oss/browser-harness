import { describe, expect, test } from "bun:test";
import { didDispatchTimedOutLinkClick } from "../../src/tools/mouse.js";
import { setupToolPage, tool } from "./tool-fixture";

describe("mouse browser tools", () => {
  test("does not mistake an unrelated redirect for a dispatched link click", () => {
    expect(didDispatchTimedOutLinkClick(
      new Error("locator.click: Timeout exceeded while waiting for element to be stable"),
      "https://example.test/start",
      "https://example.test/redirected",
      "https://example.test/intended",
    )).toBe(false);
    expect(didDispatchTimedOutLinkClick(
      new Error("locator.click: click action done; waiting for scheduled navigations to finish"),
      "https://example.test/start",
      "https://example.test/intended",
      "https://example.test/intended",
    )).toBe(true);
  });

  test("reports why a target did not become actionable", async () => {
    const fixture = await setupToolPage(`
      <main>
        <button disabled>Submit</button>
        <button id="covered" style="position:absolute;left:20px;top:80px">Covered</button>
        <div style="position:absolute;left:0;top:60px;width:200px;height:80px">Overlay</div>
      </main>
    `);

    try {
      await expect(tool(fixture.tools, "browser_click").execute({
        target: { role: "button", name: "Submit" },
        timeoutMs: 100,
      })).rejects.toThrow("Reason: element is not enabled");

      const started = Date.now();
      await expect(tool(fixture.tools, "browser_click").execute({
        target: { role: "button", name: "Missing" },
        timeoutMs: 100,
      })).rejects.toThrow("Timeout 100ms exceeded");
      expect(Date.now() - started).toBeLessThan(1000);

      const hoverStarted = Date.now();
      await expect(tool(fixture.tools, "browser_hover").execute({
        target: { role: "button", name: "Missing" },
        timeoutMs: 100,
      })).rejects.toThrow("Timeout 100ms exceeded");
      expect(Date.now() - hoverStarted).toBeLessThan(1000);
      expect(fixture.actions.slice(-3).every((action) => action.durationMs >= 0)).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("clicks, double-clicks, right-clicks, and hovers", async () => {
    const fixture = await setupToolPage(`
      <main>
        <h1 id="heading">Ready</h1>
        <button id="clicker" onclick="window.clicks=(window.clicks||0)+1; document.querySelector('#heading').textContent='Completed'; this.insertAdjacentHTML('afterend', '<button>Continue</button>')">Click me</button>
        <button id="double" ondblclick="this.textContent='Double clicked'">Double me</button>
        <button id="context" oncontextmenu="event.preventDefault(); this.textContent='Context opened'">Right me</button>
        <div id="hover" onmouseenter="this.textContent='Hovered'">Hover me</div>
      </main>
    `);

    try {
      const click = await tool(fixture.tools, "browser_click").execute({ target: "Click me" });
      await tool(fixture.tools, "browser_double_click").execute({ target: "Double me" });
      await tool(fixture.tools, "browser_right_click").execute({ target: "Right me" });
      await tool(fixture.tools, "browser_hover").execute({ target: "#hover" });
      const text = await tool(fixture.tools, "browser_get_text").execute({ target: "main" });

      expect(await fixture.page.evaluate(() => (globalThis as { clicks?: number }).clicks)).toBe(1);
      expect(click.content).toContain('headings now "Completed"');
      expect(click.content).toContain('controls added: button "Continue"');
      expect(text.content).toContain("Double clicked");
      expect(text.content).toContain("Context opened");
      expect(text.content).toContain("Hovered");
      expect(fixture.actions.map((action) => action.name)).toEqual([
        "browser_goto",
        "browser_click",
        "browser_double_click",
        "browser_right_click",
        "browser_hover",
        "browser_get_text",
      ]);
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("drags source elements to targets", async () => {
    const fixture = await setupToolPage(`
      <main>
        <div id="source" draggable="true" style="width:100px;height:100px;background:red">Drag me</div>
        <div id="target" style="width:100px;height:100px;background:blue" ondragover="event.preventDefault(); this.textContent='Dropped'">Drop here</div>
      </main>
    `);

    try {
      await tool(fixture.tools, "browser_drag_and_drop").execute({ source: "#source", target: "#target" });
      await tool(fixture.tools, "browser_wait_for_text").execute({ text: "Dropped" });
      expect(await fixture.page.locator("#target").innerText()).toBe("Dropped");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("clicks viewport coordinates with topmost-element evidence and modal protection", async () => {
    const fixture = await setupToolPage(`
      <canvas id="surface" width="300" height="120" style="width:300px;height:120px"
        onclick="this.dataset.clicked='true'"></canvas>
    `);

    try {
      const box = await fixture.page.locator("#surface").boundingBox();
      expect(box).not.toBeNull();
      const x = box!.x + box!.width / 2;
      const y = box!.y + box!.height / 2;
      const click = await tool(fixture.tools, "browser_click_at").execute({
        x,
        y,
        reason: "Canvas control has no semantic target",
      });
      expect(click.metadata?.topmostElement).toEqual(expect.objectContaining({ tag: "canvas", id: "surface" }));
      expect(await fixture.page.locator("#surface").getAttribute("data-clicked")).toBe("true");

      await fixture.page.evaluate(() => {
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-label", "Consent");
        dialog.style.cssText = "position:fixed;inset:0;background:white;z-index:10";
        document.body.append(dialog);
      });
      const blocked = await tool(fixture.tools, "browser_click_at").execute({
        x,
        y,
        reason: "Attempt underlying canvas control",
      });
      expect(blocked.metadata?.blocked).toBe(true);
      expect(blocked.content).toContain("Consent");

      await expect(tool(fixture.tools, "browser_click_at").execute({
        x: -1,
        y: 20,
        reason: "Invalid point",
      })).rejects.toThrow("inside the current viewport");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);
});
