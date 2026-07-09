import type { BrowserToolContext, NativeToolBridge } from "./types.js";
import { locateTarget, selectorFor, targetParameterSchema } from "./locators.js";
import { describeBlockedSubmission } from "./form-validation.js";
import { describeFailure } from "./expect.js";

export function createMouseTools(context: BrowserToolContext): NativeToolBridge[] {
  return [
    {
      name: "browser_click",
      description: "Click by accessible role/name, visible text, label, CSS selector, or XPath selector.",
      parameters: {
        type: "object",
        properties: { target: targetParameterSchema },
        required: ["target"],
      },
      promptSnippet: "- browser_click: Click an interactive element. Prefer visible labels or accessible names.",
      execute: (input) => context.record("browser_click", input, async () => {
        const target = selectorFor(input.target);
        const locator = locateTarget(context.page, input.target);
        // Resolve the element BEFORE clicking so we can inspect it afterward
        // without auto-waiting on a locator that a successful submit navigated
        // away (the handle simply throws once its context is destroyed).
        const handle = await locator.elementHandle({ timeout: 5000 }).catch(() => null);
        try {
          await locator.click({ timeout: 5000 });
        } catch (error) {
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
          await locateTarget(context.page, input.target).dblclick({ timeout: 5000 });
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
          await locateTarget(context.page, input.target).click({ button: "right", timeout: 5000 });
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
          await locateTarget(context.page, input.target).hover({ timeout: 5000 });
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
          await locateTarget(context.page, input.source).dragTo(locateTarget(context.page, input.target), { timeout: 5000 });
        } catch (error) {
          throw await describeFailure(context.page, error);
        }
        return { content: `Dragged ${source} to ${target}` };
      }),
    },
  ];
}
