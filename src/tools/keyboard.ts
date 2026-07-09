import type { BrowserToolContext, NativeToolBridge } from "./types.js";
import { locateTarget, selectorFor, targetParameterSchema } from "./locators.js";
import { describeBlockedSubmission } from "./form-validation.js";

export function createKeyboardTools(context: BrowserToolContext): NativeToolBridge[] {
  return [
    {
      name: "browser_type",
      description: "Fill an input. Prefer a structured target such as { label: 'Email' }, { placeholder: 'Search' }, or { role: 'textbox', name: 'Location' }. Do not pass ARIA lines or selector-like shorthand as strings.",
      parameters: {
        type: "object",
        properties: {
          target: targetParameterSchema,
          text: { type: "string" },
        },
        required: ["target", "text"],
      },
      promptSnippet: "- browser_type: Fill text using a structured target, such as { label: \"Email\" }, { placeholder: \"Search\" }, or { role: \"textbox\", name: \"Location\" }. Never copy `textbox \"Location\"` from a snapshot as a string.",
      execute: (input) => context.record("browser_type", input, async () => {
        const target = selectorFor(input.target);
        const text = String(input.text ?? "");
        await locateTarget(context.page, input.target).fill(text, { timeout: 5000 });
        return { content: `Typed into ${target}` };
      }),
    },
    {
      name: "browser_press",
      description: "Press a keyboard key, optionally scoped to a target element.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Playwright key name, e.g. Enter, Tab, Backspace, Control+A" },
          target: targetParameterSchema,
        },
        required: ["key"],
      },
      promptSnippet: "- browser_press: Press keyboard keys such as Enter, Tab, Escape, Backspace, or Control+A.",
      execute: (input) => context.record("browser_press", input, async () => {
        const key = String(input.key ?? "");
        const target = selectorFor(input.target);
        const isEnter = /^enter$/i.test(key);
        // Resolve the focused field before the keypress so a successful submit
        // that navigates away just throws on inspection instead of auto-waiting.
        const handle = isEnter && target
          ? await locateTarget(context.page, target).elementHandle({ timeout: 5000 }).catch(() => null)
          : null;
        if (target) await locateTarget(context.page, target).press(key, { timeout: 5000 });
        else await context.page.keyboard.press(key);
        // Enter inside a field submits the enclosing form; if validation silently
        // blocks that submit, surface the offending fields to the agent.
        const blocked = handle ? await describeBlockedSubmission(handle, "enter").catch(() => null) : null;
        const base = target ? `Pressed ${key} on ${target}` : `Pressed ${key}`;
        return { content: blocked ? `${base}. ${blocked}` : base, ...(blocked ? { metadata: { submissionBlocked: true } } : {}) };
      }),
    },
    {
      name: "browser_tab",
      description: "Move keyboard focus forward or backward with Tab.",
      parameters: {
        type: "object",
        properties: { shift: { type: "boolean" } },
      },
      promptSnippet: "- browser_tab: Move focus with Tab; pass shift=true to move backward.",
      execute: (input) => context.record("browser_tab", input, async () => {
        const shift = Boolean(input.shift);
        await context.page.keyboard.press(shift ? "Shift+Tab" : "Tab");
        return { content: shift ? "Pressed Shift+Tab" : "Pressed Tab", metadata: { shift } };
      }),
    },
    {
      name: "browser_focus",
      description: "Focus an element by accessible role/name, visible text, label, CSS selector, or XPath selector.",
      parameters: {
        type: "object",
        properties: { target: targetParameterSchema },
        required: ["target"],
      },
      promptSnippet: "- browser_focus: Focus an element before keyboard input or focus assertions.",
      execute: (input) => context.record("browser_focus", input, async () => {
        const target = selectorFor(input.target);
        await locateTarget(context.page, target).focus({ timeout: 5000 });
        return { content: `Focused ${target}` };
      }),
    },
    {
      name: "browser_blur",
      description: "Blur the currently focused element.",
      parameters: { type: "object", properties: {} },
      promptSnippet: "- browser_blur: Remove focus from the active element.",
      execute: (input) => context.record("browser_blur", input, async () => {
        await context.page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });
        return { content: "Blurred active element" };
      }),
    },
    {
      name: "browser_clear",
      description: "Clear an input, textarea, or editable element by label, placeholder, CSS selector, or XPath selector.",
      parameters: {
        type: "object",
        properties: { target: targetParameterSchema },
        required: ["target"],
      },
      promptSnippet: "- browser_clear: Clear existing text from a form field before entering a new value.",
      execute: (input) => context.record("browser_clear", input, async () => {
        const target = selectorFor(input.target);
        await locateTarget(context.page, target).fill("", { timeout: 5000 });
        return { content: `Cleared ${target}` };
      }),
    },
  ];
}
