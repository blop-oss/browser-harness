import { afterEach, describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startScreencast } from "../../src/screencast.js";
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

async function waitForFrame(latest: () => unknown, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (latest()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("playwright screencast streaming", () => {
  test("streams live frames and serves step screenshots from memory", async () => {
    const server = await startFixtureServer([
      { path: "/", body: `<main><h1>Streaming fixture</h1><button>Go</button></main>` },
    ]);
    closeServer = server.close;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();

    const frames: number[] = [];
    const screencast = await startScreencast({ page, onFrame: (f) => frames.push(f.seq) });
    expect(screencast).not.toBeNull();

    await page.goto(`${server.url}/`, { waitUntil: "domcontentloaded" });
    // Nudge a repaint so a frame is guaranteed even on a static page.
    await page.mouse.move(20, 20);
    await waitForFrame(() => screencast!.latest());

    const latest = screencast!.latest();
    expect(latest).not.toBeNull();
    expect(latest!.data.byteLength).toBeGreaterThan(0);
    expect(screencast!.frameCount()).toBeGreaterThan(0);
    expect(frames.length).toBeGreaterThan(0);

    // A recorded action with captureStepScreenshots should write the in-memory
    // frame (no blocking page.screenshot()), and attach its path.
    const screenshotDir = join(".blop-test-screenshots", "screencast");
    await rm(screenshotDir, { recursive: true, force: true });
    const actions: HarnessAction[] = [];
    const finishState: FinishState = { status: null, reason: null };
    const tools = await createBrowserTools({
      page,
      testId: "test_screencast",
      screenshotDir,
      actions,
      screenshots: [],
      finishState,
      captureStepScreenshots: true,
      liveFrame: () => screencast!.latest(),
    });

    await tools.find((t) => t.name === "browser_get_url")!.execute({});
    const shotPath = actions[0]?.metadata?.stepScreenshotPath as string | undefined;
    expect(shotPath).toBeTruthy();
    const written = await readFile(shotPath!);
    expect(written.byteLength).toBeGreaterThan(0);

    await screencast!.stop();
    // Second stop is a no-op and must not throw.
    await screencast!.stop();
  }, 20000);
});
