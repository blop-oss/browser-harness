import type { Page } from "playwright";
import type { BrowserToolContext, NativeToolBridge } from "./types.js";

/**
 * Tools for discovering and switching between the pages/tabs of the browser
 * context — including popups the app opens via window.open or target=_blank.
 *
 * Without these, an agent driving only `context.page` is blind to popups: a
 * click that opens a new tab leaves the main page unchanged, so the agent
 * keeps asserting against the page that triggered the popup instead of the
 * popup itself. The runner registers every page the context opens into
 * `context.pages` (see runner.ts `attachPageListeners`); these tools expose
 * that list and let the agent switch the active page.
 */
export function createTabTools(context: BrowserToolContext): NativeToolBridge[] {
  return [
    {
      name: "browser_list_pages",
      description:
        "List all open pages/tabs in the browser context, including popups opened by the app via window.open or target=_blank. Returns the index, URL, and title of each page and marks the currently active one. Use after any click that may have opened a popup to discover it.",
      parameters: { type: "object", properties: {} },
      promptSnippet:
        "- browser_list_pages: List every open page/tab (including popups). Use after a click that may have opened a popup so you can switch to it.",
      execute: (input) => context.record("browser_list_pages", input, async () => {
        const pages = context.pages ?? [context.page];
        const active = context.getActivePage?.() ?? context.page;
        const summaries = await Promise.all(
          pages.map(async (page, index) => {
            let title = "";
            try {
              title = await page.title();
            } catch {
              // A popup may close before we read it; keep a stable entry.
            }
            let url = "";
            try {
              url = page.url();
            } catch {
              // page already closed
            }
            return {
              index,
              url,
              title,
              active: page === active,
              closed: url === "",
            };
          }),
        );
        const lines = summaries.map(
          (entry) =>
            `[${entry.index}]${entry.active ? " *" : " "} ${entry.closed ? "<closed>" : entry.url}${entry.title ? ` — ${entry.title}` : ""}`,
        );
        const content =
          summaries.length === 0
            ? "No open pages."
            : `${summaries.length} page(s) (* = active):\n${lines.join("\n")}`;
        return { content, metadata: { pages: summaries } };
      }),
    },
    {
      name: "browser_select_page",
      description:
        "Switch the active page the other browser tools operate on. Pass the index from browser_list_pages. Use this to interact with a popup or tab the app opened. The previously active page stays open in the background.",
      parameters: {
        type: "object",
        properties: { index: { type: "number" } },
        required: ["index"],
      },
      promptSnippet:
        "- browser_select_page: Switch the active page to a popup or tab (by index from browser_list_pages). Required before interacting with a popup's contents.",
      execute: (input) => context.record("browser_select_page", input, async () => {
        const pages = context.pages ?? [context.page];
        const index = Number(input.index);
        if (!Number.isInteger(index) || index < 0 || index >= pages.length) {
          throw new Error(
            `Invalid page index ${input.index}. There are ${pages.length} page(s) (0-${pages.length - 1}). Call browser_list_pages to see them.`,
          );
        }
        const target = pages[index];
        if (!target) {
          throw new Error(`Page at index ${index} is not available. Call browser_list_pages.`);
        }
        if (target.isClosed()) {
          throw new Error(`Page at index ${index} is closed. Call browser_list_pages for the current list.`);
        }
        context.setActivePage?.(target);
        let url = "";
        try {
          url = target.url();
        } catch {}
        let title = "";
        try {
          title = await target.title();
        } catch {}
        return {
          content: `Active page switched to index ${index}: ${url || "<unknown>"}${title ? ` — ${title}` : ""}`,
          metadata: { index, url, title },
        };
      }),
    },
    {
      name: "browser_close_page",
      description:
        "Close a popup or tab by its index from browser_list_pages. After closing, the main page (index 0) becomes active unless you select another. Use to dismiss popups the app opened that you no longer need.",
      parameters: {
        type: "object",
        properties: { index: { type: "number" } },
        required: ["index"],
      },
      promptSnippet:
        "- browser_close_page: Close a popup/tab by index from browser_list_pages. The main page becomes active afterward.",
      execute: (input) => context.record("browser_close_page", input, async () => {
        const pages = context.pages ?? [context.page];
        const index = Number(input.index);
        if (!Number.isInteger(index) || index < 0 || index >= pages.length) {
          throw new Error(
            `Invalid page index ${input.index}. There are ${pages.length} page(s) (0-${pages.length - 1}).`,
          );
        }
        const target: Page = pages[index];
        if (!target) throw new Error(`Page at index ${index} is not available.`);
        if (index === 0) {
          throw new Error(
            "Refusing to close the main page (index 0). Close popups individually or finish the test instead.",
          );
        }
        try {
          await target.close();
        } catch {
          // Already closing/closed; the registry's close listener prunes it.
        }
        // Activate the main page if we just closed the active one.
        const active = context.getActivePage?.() ?? context.page;
        if (active === target) {
          const main = pages[0];
          if (main && !main.isClosed()) context.setActivePage?.(main);
        }
        return {
          content: `Closed page at index ${index}.`,
          metadata: { index },
        };
      }),
    },
  ];
}