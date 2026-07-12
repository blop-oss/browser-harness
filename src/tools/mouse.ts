import type { BrowserToolContext, NativeToolBridge } from "./types.js";
import { locateTarget, selectorFor, targetParameterSchema } from "./locators.js";
import { describeBlockedSubmission } from "./form-validation.js";
import { describeFailure } from "./expect.js";
import { blockedActionResult, referenceEntry } from "./references.js";

export function createMouseTools(context: BrowserToolContext): NativeToolBridge[] {
  return [
    {
      name: "browser_click",
      description: "Click an element. Prefer a current snapshot ref when available, especially for any element marked frame=. Otherwise use a structured target such as { role: 'button', name: 'Save' } or { text: 'Continue' }. A string is treated as plain accessible text or a real CSS/XPath selector; do not copy ARIA lines such as `button \"Save\"` into a string.",
      parameters: {
        type: "object",
        properties: { target: targetParameterSchema },
        required: ["target"],
      },
      promptSnippet: "- browser_click: Prefer an opaque ref such as { ref: \"e1\" } from the latest snapshot; copy it verbatim and never edit its digits. Never click a reference marked [occluded]; handle its visible blocker first. You MUST use a ref for frame-hosted controls. Otherwise use a unique { role: \"button\", name: \"Save\" } or { text: \"Continue\" }. Never copy an ARIA snapshot line as the target string.",
      execute: (input) => context.record("browser_click", input, async () => {
        const target = selectorFor(input.target);
        const locator = locateTarget(context.page, input.target);
        const ref = input.target && typeof input.target === "object" && "ref" in input.target
          ? String((input.target as { ref?: unknown }).ref ?? "")
          : "";
        const observedReference = ref ? referenceEntry(context.page, ref)?.entry : undefined;
        if (observedReference?.states?.includes("modal-scope") && await locator.count() === 0) {
          const visibleModalCount = await context.page.locator(
            "dialog:visible,[role='dialog'][aria-modal='true']:visible,[role='alertdialog'][aria-modal='true']:visible",
          ).count();
          if (visibleModalCount === 0) {
            return {
              content: `Click was not needed: the observed modal control ${target} disappeared and no modal remains.`,
              metadata: { skipped: true, modalAlreadyClosed: true },
            };
          }
        }
        const blockedResult = await blockedActionResult(context.page, locator, "Click");
        if (blockedResult) return blockedResult;
        // Resolve the element BEFORE clicking so we can inspect it afterward
        // without auto-waiting on a locator that a successful submit navigated
        // away (the handle simply throws once its context is destroyed).
        const handle = await locator.elementHandle({ timeout: 5000 }).catch(() => null);
        const beforeUrl = context.page.url();
        const expectedHref = handle ? await handle.evaluate((element) =>
          element instanceof HTMLAnchorElement ? element.href : null).catch(() => null) : null;
        try {
          await locator.click({ timeout: 5000 });
        } catch (error) {
          // A click can fire successfully and start a slow navigation, then
          // time out only while Playwright waits for the destination load.
          // Preserve that successful state transition instead of reporting
          // the action itself as failed.
          if (didDispatchTimedOutLinkClick(error, beforeUrl, context.page.url(), expectedHref)) {
            return {
              content: `Clicked ${target}; navigation started to ${context.page.url()}`,
              metadata: { navigationStarted: true, url: context.page.url() },
            };
          }
          // Attach page context (URL, title, ARIA snapshot) so the agent can
          // see what's actually on the page and pick a different targeting
          // strategy instead of blindly retrying with another malformed
          // selector.
          throw await describeFailure(context.page, error);
        }
        // If the click was a form submit that the browser silently blocked on
        // HTML5 validation, tell the agent which fields are missing/invalid so it
        // can fix them instead of assuming the button is dead.
        const blocked = handle ? await describeBlockedSubmission(handle, "click").catch(() => null) : null;
        return { content: blocked ? `Clicked ${target}. ${blocked}` : `Clicked ${target}`, ...(blocked ? { metadata: { submissionBlocked: true } } : {}) };
      }),
    },
    {
      name: "browser_double_click",
      description: "Double-click an element by accessible role/name, visible text, label, CSS selector, or XPath selector.",
      parameters: {
        type: "object",
        properties: { target: targetParameterSchema },
        required: ["target"],
      },
      promptSnippet: "- browser_double_click: Double-click an element when testing double-click behavior.",
      execute: (input) => context.record("browser_double_click", input, async () => {
        const target = selectorFor(input.target);
        try {
          const locator = locateTarget(context.page, input.target);
          const blockedResult = await blockedActionResult(context.page, locator, "Double-click");
          if (blockedResult) return blockedResult;
          await locator.dblclick({ timeout: 5000 });
        } catch (error) {
          throw await describeFailure(context.page, error);
        }
        return { content: `Double-clicked ${target}` };
      }),
    },
    {
      name: "browser_right_click",
      description: "Right-click an element by accessible role/name, visible text, label, CSS selector, or XPath selector.",
      parameters: {
        type: "object",
        properties: { target: targetParameterSchema },
        required: ["target"],
      },
      promptSnippet: "- browser_right_click: Open context-menu behavior on a target element.",
      execute: (input) => context.record("browser_right_click", input, async () => {
        const target = selectorFor(input.target);
        try {
          const locator = locateTarget(context.page, input.target);
          const blockedResult = await blockedActionResult(context.page, locator, "Right-click");
          if (blockedResult) return blockedResult;
          await locator.click({ button: "right", timeout: 5000 });
        } catch (error) {
          throw await describeFailure(context.page, error);
        }
        return { content: `Right-clicked ${target}` };
      }),
    },
    {
      name: "browser_hover",
      description: "Hover over an element by accessible role/name, visible text, label, CSS selector, or XPath selector.",
      parameters: {
        type: "object",
        properties: { target: targetParameterSchema },
        required: ["target"],
      },
      promptSnippet: "- browser_hover: Trigger hover states such as menus, tooltips, and hover cards.",
      execute: (input) => context.record("browser_hover", input, async () => {
        const target = selectorFor(input.target);
        try {
          const locator = locateTarget(context.page, input.target);
          const blockedResult = await blockedActionResult(context.page, locator, "Hover");
          if (blockedResult) return blockedResult;
          await locator.hover({ timeout: 5000 });
        } catch (error) {
          throw await describeFailure(context.page, error);
        }
        return { content: `Hovered ${target}` };
      }),
    },
    {
      name: "browser_drag_and_drop",
      description: "Drag a source element onto a target element.",
      parameters: {
        type: "object",
        properties: {
          source: targetParameterSchema,
          target: targetParameterSchema,
        },
        required: ["source", "target"],
      },
      promptSnippet: "- browser_drag_and_drop: Drag one element onto another, e.g. sortable lists or drop zones.",
      execute: (input) => context.record("browser_drag_and_drop", input, async () => {
        const source = selectorFor(input.source);
        const target = selectorFor(input.target);
        try {
          const sourceLocator = locateTarget(context.page, input.source);
          const targetLocator = locateTarget(context.page, input.target);
          const sourceBlocked = await blockedActionResult(context.page, sourceLocator, "Drag");
          if (sourceBlocked) return sourceBlocked;
          const targetBlocked = await blockedActionResult(context.page, targetLocator, "Drop");
          if (targetBlocked) return targetBlocked;
          await sourceLocator.dragTo(targetLocator, { timeout: 5000 });
        } catch (error) {
          throw await describeFailure(context.page, error);
        }
        return { content: `Dragged ${source} to ${target}` };
      }),
    },
  ];
}

export function didDispatchTimedOutLinkClick(
  error: unknown,
  beforeUrl: string,
  afterUrl: string,
  expectedHref: string | null,
) {
  if (!expectedHref || beforeUrl === afterUrl) return false;
  const message = error instanceof Error ? error.message : String(error);
  // Playwright writes these call-log entries only after the pointer action has
  // completed. A concurrent redirect alone is not evidence that we clicked.
  return /click action done|waiting for scheduled navigations to finish/i.test(message);
}
