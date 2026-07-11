import { basename, join } from "node:path";
import type { BrowserToolContext, NativeToolBridge } from "./types.js";
import { locateTarget, selectorFor, targetParameterSchema } from "./locators.js";
import type { Page } from "playwright";
import { collectInteractiveReferences } from "./references.js";

const DEFAULT_ARIA_SNAPSHOT_CHARS = 12_000;
const MIN_ARIA_SNAPSHOT_CHARS = 1_000;
const MAX_ARIA_SNAPSHOT_CHARS = 50_000;

export function createPageTools(context: BrowserToolContext): NativeToolBridge[] {
  return [
    {
      name: "browser_snapshot",
      description: "Return the current URL, page title, visible text, accessibility snapshot, snapshot-scoped references for visible interactive elements, focused element, and viewport. Prefer { ref: 's1:e1' } targets from the latest snapshot. The ARIA tree is capped by default to control model context; increase maxAriaChars only when the required element is missing.",
      parameters: {
        type: "object",
        properties: {
          maxAriaChars: {
            type: "number",
            description: `ARIA character budget (${MIN_ARIA_SNAPSHOT_CHARS}-${MAX_ARIA_SNAPSHOT_CHARS}, default ${DEFAULT_ARIA_SNAPSHOT_CHARS}).`,
          },
        },
      },
      promptSnippet: "- browser_snapshot: Inspect URL, title, visible text, ARIA roles/labels, interactive element references, focus, and viewport before deciding the next action. Prefer a current { ref: \"s1:e1\" } target when available. References expire after the next snapshot. The ARIA tree is capped; increase maxAriaChars only if the needed element is missing, or use browser_extract for focused data.",
      execute: (input) => context.record("browser_snapshot", input, async () => {
        const title = await context.page.title();
        const bodyText = await context.page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
        const excerpt = bodyText.replace(/\s+/g, " ").trim().slice(0, 4000);
        const maxAriaChars = clampAriaBudget(input.maxAriaChars);
        const ariaSnapshot = truncateSnapshot(
          await readAriaSnapshot(context.page),
          maxAriaChars,
        );
        const interactiveElements = await collectInteractiveReferences(context.page).catch(() => []);
        const pageWithEvaluate = context.page as typeof context.page & { evaluate?: typeof context.page.evaluate };
        const focusedElement = pageWithEvaluate.evaluate ? await pageWithEvaluate.evaluate(() => {
          const element = document.activeElement;
          if (!element) return null;
          return {
            tag: element.tagName.toLowerCase(),
            text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
            ariaLabel: element.getAttribute("aria-label"),
            role: element.getAttribute("role"),
            id: element.id || null,
            name: element.getAttribute("name"),
          };
        }).catch(() => null) : null;
        const pageWithViewport = context.page as typeof context.page & { viewportSize?: typeof context.page.viewportSize };
        const viewport = pageWithViewport.viewportSize ? pageWithViewport.viewportSize() : null;
        const snapshot = { url: context.page.url(), title, text: excerpt, ariaSnapshot, interactiveElements, focusedElement, viewport };
        return {
          content: JSON.stringify(snapshot, null, 2),
          metadata: {
            url: context.page.url(),
            title,
            hasAriaSnapshot: Boolean(ariaSnapshot),
            interactiveElementCount: interactiveElements.length,
            ariaSnapshotTruncated: ariaSnapshot.endsWith("\n...[ARIA snapshot truncated]"),
            viewport: viewport ?? null,
          },
        };
      }),
    },
    {
      name: "browser_set_viewport",
      description: "Set the browser viewport size for responsive agent checks.",
      parameters: {
        type: "object",
        properties: {
          width: { type: "number" },
          height: { type: "number" },
        },
        required: ["width", "height"],
      },
      promptSnippet: "- browser_set_viewport: Set viewport width and height before responsive checks.",
      execute: (input) => context.record("browser_set_viewport", input, async () => {
        const width = Number(input.width);
        const height = Number(input.height);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          throw new Error("Viewport width and height must be positive numbers.");
        }

        await context.page.setViewportSize({ width, height });
        return { content: `Viewport set to ${width}x${height}`, metadata: { width, height } };
      }),
    },
    {
      name: "browser_get_viewport",
      description: "Return the current browser viewport size.",
      parameters: { type: "object", properties: {} },
      promptSnippet: "- browser_get_viewport: Read viewport size before responsive assertions.",
      execute: (input) => context.record("browser_get_viewport", input, async () => {
        const viewport = context.page.viewportSize();
        return {
          content: viewport ? `${viewport.width}x${viewport.height}` : "unknown",
          metadata: viewport ?? {},
        };
      }),
    },
    {
      name: "browser_screenshot",
      description: "Capture a focused evidence screenshot and return its local path. Use target for the smallest useful element or region; use fullPage only when the whole layout is the evidence.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          checkpoint: { type: "string" },
          reason: { type: "string" },
          target: targetParameterSchema,
          fullPage: { type: "boolean" },
        },
      },
      promptSnippet: "- browser_screenshot: Capture only useful checkpoint evidence. Pass target for the smallest relevant element/region; avoid fullPage unless the full layout is the evidence.",
      execute: (input) => context.record("browser_screenshot", input, async () => {
        const rawName = selectorFor(input.name) || selectorFor(input.checkpoint) || `screenshot-${context.screenshots.length + 1}`;
        const safeName = basename(rawName).replace(/[^a-zA-Z0-9._-]/g, "-");
        const filePath = join(context.screenshotDir, `${safeName}.png`);
        const target = selectorFor(input.target);
        const fullPage = Boolean(input.fullPage);
        if (target) {
          await locateTarget(context.page, input.target).first().screenshot({ path: filePath });
        } else {
          await context.page.screenshot({ path: filePath, fullPage });
        }
        const artifact = {
          path: filePath,
          name: safeName,
          ...(typeof input.checkpoint === "string" ? { checkpoint: input.checkpoint } : {}),
          ...(typeof input.reason === "string" ? { reason: input.reason } : {}),
          ...(target ? { target } : {}),
          focused: Boolean(target),
          fullPage,
          timestamp: new Date().toISOString(),
        };
        context.screenshots.push(filePath);
        context.screenshotArtifacts.push(artifact);
        return { content: filePath, metadata: artifact };
      }),
    },
  ];
}

async function readAriaSnapshot(page: Page) {
  const body = page.locator("body");
  const locatorWithSnapshot = body as typeof body & { ariaSnapshot?: (options?: { timeout?: number }) => Promise<string> };
  if (!locatorWithSnapshot.ariaSnapshot) return "";
  return locatorWithSnapshot.ariaSnapshot({ timeout: 5000 }).catch(() => "");
}

function clampAriaBudget(value: unknown): number {
  const requested = Number(value ?? DEFAULT_ARIA_SNAPSHOT_CHARS);
  if (!Number.isFinite(requested)) return DEFAULT_ARIA_SNAPSHOT_CHARS;
  return Math.min(MAX_ARIA_SNAPSHOT_CHARS, Math.max(MIN_ARIA_SNAPSHOT_CHARS, requested));
}

function truncateSnapshot(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[ARIA snapshot truncated]`;
}
