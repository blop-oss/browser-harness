import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { startFixtureServer } from "../fixtures/server.js";
import { locateTarget } from "../../src/tools/locators.js";

// Verifies the malformed-selector guard added to locators.ts: a malformed CSS
// selector must not poison the .or() candidate chain when a string target is
// used, and a structured selector target must throw a helpful error instead
// of Playwright's raw "Malformed selector" message.

describe("locator malformed-selector guard", () => {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let server: Awaited<ReturnType<typeof startFixtureServer>> | undefined;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    page = await context.newPage();
    server = await startFixtureServer([
      {
        path: "/",
        body: `
          <main>
            <a href="/product/1">Blue Jacket</a>
            <a href="/product/2">Red Shirt</a>
            <button>Preview</button>
            <p>Some descriptive text about products</p>
          </main>
        `,
      },
      { path: "/product/1", body: "<h1>Blue Jacket Detail</h1><img src='/img.jpg' alt='Blue Jacket' /><p>$99.00</p>" },
    ]);
    await page.goto(server.url);
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  test("string target with accessible name resolves via role/text candidates", async () => {
    // "Preview" is both a valid CSS type selector (matches <preview> elements)
    // and a button label. The role-based candidate should match the <button>.
    const locator = locateTarget(page!, "Preview");
    const count = await locator.count();
    expect(count).toBeGreaterThan(0);
  });

  test("structured target with malformed selector throws a helpful error", async () => {
    // A genuinely malformed selector (unclosed bracket) in the structured path
    // should throw an error that includes guidance, not a raw Playwright error.
    expect(() =>
      locateTarget(page!, { selector: "[data-id=" }),
    ).toThrow(/Malformed selector/);

    expect(() =>
      locateTarget(page!, { selector: "[data-id=" }),
    ).toThrow(/browser_snapshot/);
  });

  test("structured target with valid selector still works", async () => {
    const locator = locateTarget(page!, { selector: "a[href='/product/1']" });
    const text = await locator.innerText();
    expect(text).toContain("Blue Jacket");
  });

  test("string target that is valid CSS still uses the selector fallback", async () => {
    const locator = locateTarget(page!, "main");
    const text = await locator.innerText();
    expect(text).toContain("Blue Jacket");
  });
});
