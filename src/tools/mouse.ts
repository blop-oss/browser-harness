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
        properties: {
          target: targetParameterSchema,
          timeoutMs: { type: "number", description: "Max time in ms to wait for the element to become actionable (default 5000)." },
        },
        required: ["target"],
      },
      promptSnippet: "- browser_click: Prefer an opaque ref such as { ref: \"e1\" } from the latest snapshot; copy it verbatim and never edit its digits. Never click a reference marked [occluded]; handle its visible blocker first. You MUST use a ref for frame-hosted controls. Otherwise use a unique { role: \"button\", name: \"Save\" } or { text: \"Continue\" }. Never copy an ARIA snapshot line as the target string.",
      execute: (input) => context.record("browser_click", input, async () => {
        const timeout = actionTimeout(input.timeoutMs);
        const target = selectorFor(input.target);
        const locator = locateTarget(context.page, input.target);
        const ref = input.target && typeof input.target === "object" && "ref" in input.target
          ? String((input.target as { ref?: unknown }).ref ?? "")
          : "";
        const observedReference = ref ? referenceEntry(context.page, ref)?.entry : undefined;
        const targetCount = await locator.count();
        const referenceCount = ref ? targetCount : null;
        if (observedReference?.states?.includes("modal-scope") && referenceCount === 0) {
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
        if (ref && (referenceCount === 0 || !await locator.isVisible())) {
          throw new Error(`Unknown or stale element reference "${ref}". Take a new browser_snapshot and copy a currently exposed ref verbatim.`);
        }
        if (observedReference?.states?.includes("disabled")) {
          throw new Error(`Click was not performed because ${target} is disabled.`);
        }
        const blockedResult = targetCount > 0
          ? await blockedActionResult(context.page, locator, "Click")
          : null;
        if (blockedResult) return blockedResult;
        // Resolve the element BEFORE clicking so we can inspect it afterward
        // without auto-waiting on a locator that a successful submit navigated
        // away (the handle simply throws once its context is destroyed).
        const handle = targetCount > 0
          ? await locator.elementHandle({ timeout }).catch(() => null)
          : null;
        const beforeUrl = context.page.url();
        const expectedHref = handle ? await handle.evaluate((element) =>
          element instanceof HTMLAnchorElement ? element.href : null).catch(() => null) : null;
        try {
          await locator.click({ timeout });
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
      name: "browser_click_at",
      description: "Fallback coordinate click for canvas, image maps, closed shadow roots, or controls without a usable semantic target. Prefer browser_click whenever a snapshot reference or structured target exists. Coordinates are CSS viewport pixels and must be inside the current viewport. Requires a reason and reports the topmost element observed before dispatch.",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          button: { type: "string", enum: ["left", "right", "middle"] },
          clicks: { type: "number", description: "Click count (1-3, default 1)." },
          reason: { type: "string", description: "Why semantic or locator-based clicking cannot be used." },
        },
        required: ["x", "y", "reason"],
      },
      promptSnippet: "- browser_click_at: Last-resort click in CSS viewport coordinates for canvas or inaccessible widgets. First inspect a screenshot or box geometry, provide a reason, and verify the outcome. Never use it to bypass a visible modal or an actionable semantic target.",
      execute: (input) => context.record("browser_click_at", input, async () => {
        const x = Number(input.x);
        const y = Number(input.y);
        const reason = String(input.reason ?? "").trim();
        const viewport = context.page.viewportSize();
        if (!viewport || !Number.isFinite(x) || !Number.isFinite(y)
          || x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) {
          throw new Error(`Coordinate click must be inside the current viewport (${viewport?.width ?? "?"}x${viewport?.height ?? "?"}).`);
        }
        if (!reason) throw new Error("Coordinate click requires a non-empty reason.");
        const evidence = await context.page.evaluate(({ x, y }) => {
          const top = document.elementFromPoint(x, y);
          const modalCandidates = Array.from(document.querySelectorAll<HTMLElement>(
            "dialog,[role='dialog'][aria-modal='true'],[role='alertdialog'][aria-modal='true']",
          )).filter((candidate) => {
            const style = getComputedStyle(candidate);
            const rect = candidate.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          });
          const blockingModal = modalCandidates.filter((candidate) => {
            let nativeModal = false;
            try {
              nativeModal = candidate.matches(":modal");
            } catch {}
            const rect = candidate.getBoundingClientRect();
            const coversViewport = rect.left <= 1 && rect.top <= 1
              && rect.right >= innerWidth - 1 && rect.bottom >= innerHeight - 1;
            const backgroundSuppressed = Array.from(document.body.children).some((child) =>
              !child.contains(candidate) && (child.hasAttribute("inert") || child.getAttribute("aria-hidden") === "true"));
            return nativeModal || coversViewport || backgroundSuppressed;
          }).at(-1);
          const actionableAtPoint = top?.closest(
            "button,a[href],input,select,textarea,[role='button'],[role='link'],[role='checkbox'],[role='radio'],[role='option'],[role='menuitem']",
          );
          return {
            topmostElement: top ? {
              tag: top.tagName.toLowerCase(),
              role: top.getAttribute("role"),
              name: top.getAttribute("aria-label") || top.getAttribute("title") || "",
              id: top.id || null,
              text: (top.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
            } : null,
            blockingModal: blockingModal && (!top || !blockingModal.contains(top) || !actionableAtPoint)
              ? blockingModal.getAttribute("aria-label") || blockingModal.getAttribute("role") || "dialog"
              : null,
          };
        }, { x, y });
        if (evidence.blockingModal) {
          return {
            content: `Coordinate click was not performed because ${evidence.blockingModal} blocks the point. Use a semantic control inside the modal.`,
            metadata: { blocked: true, blocker: evidence.blockingModal, x, y, reason, topmostElement: evidence.topmostElement },
          };
        }
        const button = input.button === "right" || input.button === "middle" ? input.button : "left";
        const clicks = Math.min(3, Math.max(1, Math.floor(Number(input.clicks ?? 1) || 1)));
        await context.page.mouse.click(x, y, { button, clickCount: clicks });
        return {
          content: `Clicked viewport coordinates (${x}, ${y})`,
          metadata: { x, y, button, clicks, reason, topmostElement: evidence.topmostElement },
        };
      }),
    },
    {
      name: "browser_double_click",
      description: "Double-click an element by accessible role/name, visible text, label, CSS selector, or XPath selector.",
      parameters: {
        type: "object",
        properties: {
          target: targetParameterSchema,
          timeoutMs: { type: "number", description: "Max time in ms to wait for the element to become actionable (default 5000)." },
        },
        required: ["target"],
      },
      promptSnippet: "- browser_double_click: Double-click an element when testing double-click behavior.",
      execute: (input) => context.record("browser_double_click", input, async () => {
        const target = selectorFor(input.target);
        try {
          const locator = locateTarget(context.page, input.target);
          const blockedResult = await blockedActionResult(context.page, locator, "Double-click");
          if (blockedResult) return blockedResult;
          await locator.dblclick({ timeout: actionTimeout(input.timeoutMs) });
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
        properties: {
          target: targetParameterSchema,
          timeoutMs: { type: "number", description: "Max time in ms to wait for the element to become actionable (default 5000)." },
        },
        required: ["target"],
      },
      promptSnippet: "- browser_right_click: Open context-menu behavior on a target element.",
      execute: (input) => context.record("browser_right_click", input, async () => {
        const target = selectorFor(input.target);
        try {
          const locator = locateTarget(context.page, input.target);
          const blockedResult = await blockedActionResult(context.page, locator, "Right-click");
          if (blockedResult) return blockedResult;
          await locator.click({ button: "right", timeout: actionTimeout(input.timeoutMs) });
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
        properties: {
          target: targetParameterSchema,
          timeoutMs: { type: "number", description: "Max time in ms to wait for the element to become actionable (default 5000)." },
        },
        required: ["target"],
      },
      promptSnippet: "- browser_hover: Trigger hover states such as menus, tooltips, and hover cards.",
      execute: (input) => context.record("browser_hover", input, async () => {
        const target = selectorFor(input.target);
        try {
          const locator = locateTarget(context.page, input.target);
          const blockedResult = await blockedActionResult(context.page, locator, "Hover");
          if (blockedResult) return blockedResult;
          await locator.hover({ timeout: actionTimeout(input.timeoutMs) });
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
          timeoutMs: { type: "number", description: "Max time in ms to wait for the elements to become actionable (default 5000)." },
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
          await sourceLocator.dragTo(targetLocator, { timeout: actionTimeout(input.timeoutMs) });
        } catch (error) {
          throw await describeFailure(context.page, error);
        }
        return { content: `Dragged ${source} to ${target}` };
      }),
    },
  ];
}

function actionTimeout(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 5000;
  return Math.min(Math.max(value, 100), 60_000);
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
