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
      description: "Return URL, title, visible text, and a compact semantic interaction view with opaque references across the page and child frames. Prefer { ref: 'e1' } targets from the latest snapshot. Copy refs verbatim; never edit or predict their digits. Never act on an [occluded] entry; handle the visible dialog or blocker first. A frame-hosted control MUST be targeted by ref because page-level role/name locators cannot reach into its frame. Request includeAria only when semantic references and visible text are insufficient.",
      parameters: {
        type: "object",
        properties: {
          maxAriaChars: {
            type: "number",
            description: `ARIA character budget (${MIN_ARIA_SNAPSHOT_CHARS}-${MAX_ARIA_SNAPSHOT_CHARS}, default ${DEFAULT_ARIA_SNAPSHOT_CHARS}).`,
          },
          includeAria: {
            type: "boolean",
            description: "Include the full accessibility snapshot as an explicit fallback. Off by default.",
          },
        },
      },
      promptSnippet: "- browser_snapshot: Inspect visible text and the compact semantic interaction view. Prefer a current { ref: \"e1\" } target. Refs are opaque: copy them verbatim and never edit or predict their digits. A ref may persist across snapshots only while the exact element remains valid and exposed. Never act on an [occluded] entry: close or handle the visible dialog/blocker first. You MUST use the ref for entries with frame= metadata because role/name targets cannot cross frames. Request includeAria only if the needed content is missing, or use browser_extract for focused data.",
      execute: (input) => context.record("browser_snapshot", input, async () => {
        const title = await context.page.title();
        const bodyText = await context.page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
        const excerpt = bodyText.replace(/\s+/g, " ").trim().slice(0, 4000);
        const includeAria = input.includeAria === true || input.maxAriaChars !== undefined;
        const ariaSnapshot = includeAria
          ? truncateSnapshot(await readAriaSnapshot(context.page), clampAriaBudget(input.maxAriaChars))
          : undefined;
        // Collect interaction refs last: Playwright's aria-ref mapping belongs
        // to the most recent ARIA snapshot. The optional full fallback above
        // must not supersede the exact refs exposed to the model.
        const interactiveReferences = await collectInteractiveReferences(context.page)
          .catch(() => ({ elements: [], text: "", total: 0, omitted: 0 }));
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
        const snapshot = {
          url: context.page.url(),
          title,
          text: excerpt,
          semanticSnapshot: interactiveReferences.text,
          actionTargets: interactiveReferences.elements.slice(0, 8).map((entry) => ({
            target: { ref: entry.ref },
            role: entry.role,
            name: entry.name,
            actions: entry.actions,
            ...(entry.states?.length ? { states: entry.states } : {}),
            ...(entry.href ? { href: entry.href } : {}),
            ...(entry.region ? { region: entry.region } : {}),
            ...(entry.frame ? { frame: entry.frame } : {}),
          })),
          ...(ariaSnapshot !== undefined ? { ariaSnapshot } : {}),
          omittedInteractiveElements: interactiveReferences.omitted,
          focusedElement,
          viewport,
        };
        return {
          content: JSON.stringify(snapshot, null, 2),
          metadata: {
            url: context.page.url(),
            title,
            hasAriaSnapshot: Boolean(ariaSnapshot),
            interactiveElementCount: interactiveReferences.total,
            exposedInteractiveElementCount: interactiveReferences.elements.length,
            omittedInteractiveElementCount: interactiveReferences.omitted,
            ariaSnapshotTruncated: ariaSnapshot?.endsWith("\n...[ARIA snapshot truncated]") ?? false,
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
      description: "Capture an evidence screenshot and return its local path. Omit target for reliable page-level evidence. Use a target only when it is current on the present page; a ref clicked before navigation is stale.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          checkpoint: { type: "string" },
          reason: { type: "string" },
          target: {
            ...targetParameterSchema,
            description: "Optional current-page target. Never reuse a ref after it was clicked or after navigation; take a fresh snapshot first, or omit target for page-level evidence.",
          },
          fullPage: { type: "boolean" },
        },
      },
      promptSnippet: "- browser_screenshot: Capture useful checkpoint evidence. After navigation, omit target for page-level evidence unless a fresh snapshot exposed a new target. Never reuse the clicked pre-navigation ref.",
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
