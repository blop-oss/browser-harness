import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { chromium, type Browser } from "playwright";
import { createBrowserTools, type FinishState } from "../../src/create-tools.js";
import type { HarnessAction } from "../../src/types.js";
import { startFixtureServer } from "../fixtures/server.js";

let closeServer: (() => Promise<void>) | undefined;
let browser: Browser | undefined;

afterEach(async () => {
  await browser?.close();
  await closeServer?.();
  browser = undefined;
  closeServer = undefined;
});

describe("real browser agent tools", () => {
  test("navigates fixture app, reads URL, and controls viewport", async () => {
    const server = await startFixtureServer([
      {
        path: "/",
        body: `<main><h1>Agent checkout fixture</h1><button>Start checkout</button></main>`,
      },
    ]);
    closeServer = server.close;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const actions: HarnessAction[] = [];
    const finishState: FinishState = { status: null, reason: null };
    const tools = await createBrowserTools({
      page,
      testId: "test_real_browser",
      screenshotDir: ".blop-test-screenshots",
      actions,
      screenshots: [],
      finishState,
    });

    await tool(tools, "browser_goto").execute({ url: server.url });
    const url = await tool(tools, "browser_get_url").execute({});
    await tool(tools, "browser_expect_text").execute({ text: "Agent checkout fixture" });
    const viewport = await tool(tools, "browser_set_viewport").execute({ width: 390, height: 844 });
    const currentViewport = await tool(tools, "browser_get_viewport").execute({});

    expect(url.content).toBe(`${server.url}/`);
    expect(viewport.metadata).toEqual({ width: 390, height: 844 });
    expect(currentViewport.content).toBe("390x844");
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    expect(actions.map((action) => action.name)).toEqual([
      "browser_goto",
      "browser_get_url",
      "browser_expect_text",
      "browser_set_viewport",
      "browser_get_viewport",
    ]);
  }, 15000);

  test("bounds page screenshots for model-safe evidence", async () => {
    const server = await startFixtureServer([{
      path: "/",
      body: `<main style="width:2400px;height:1600px">Large evidence surface</main>`,
    }]);
    closeServer = server.close;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 2400, height: 1200 } });
    const page = await context.newPage();
    const tools = await createBrowserTools({
      page,
      testId: "bounded_screenshot",
      screenshotDir: ".blop-test-screenshots",
      actions: [],
      screenshots: [],
      finishState: { status: null, reason: null },
    });
    await tool(tools, "browser_goto").execute({ url: server.url });

    const result = await tool(tools, "browser_screenshot").execute({
      name: "bounded-model-evidence",
      fullPage: true,
      maxDimension: 800,
    });
    const png = await readFile(result.content);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(Math.max(width, height)).toBeLessThanOrEqual(800);
    expect(result.metadata?.scaled).toBe(true);
    expect(result.metadata?.pixelWidth).toBe(width);
    expect(result.metadata?.pixelHeight).toBe(height);
  }, 15000);
});

function tool(tools: Awaited<ReturnType<typeof createBrowserTools>>, name: string) {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing tool: ${name}`);
  return found;
}
