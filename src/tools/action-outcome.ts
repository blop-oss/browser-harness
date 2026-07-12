import type { Page } from "playwright";

export type ActionState = {
  url: string;
  title: string;
  focus: string;
  dialogs: number;
  alerts: number;
  headings: string;
  contentHash: number;
};

export async function captureActionState(page: Page): Promise<ActionState | null> {
  try {
    const title = await page.title();
    const state = await page.evaluate(() => {
      const active = document.activeElement;
      const focus = active instanceof HTMLElement
        ? [active.getAttribute("role") || active.tagName.toLowerCase(), active.getAttribute("aria-label") || active.getAttribute("name") || active.id || ""]
          .filter(Boolean).join(":")
        : "";
      const text = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
      const headingElements = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,[role='heading']"))
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        })
        .map((element, index) => {
          const rect = element.getBoundingClientRect();
          const levelOne = element.tagName === "H1" || element.getAttribute("aria-level") === "1";
          const inMain = Boolean(element.closest("main,[role='main']"));
          const inViewport = rect.bottom > 0 && rect.top < innerHeight;
          return { element, index, priority: (inMain ? 4 : 0) + (levelOne ? 4 : 0) + (inViewport ? 2 : 0) };
        })
        .sort((left, right) => right.priority - left.priority || left.index - right.index);
      const headings = headingElements
        .map(({ element }) => element.innerText.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(" | ")
        .slice(0, 300);
      let contentHash = 0;
      for (let index = 0; index < text.length; index += 1) {
        contentHash = ((contentHash * 31) + text.charCodeAt(index)) | 0;
      }
      return {
        url: location.href,
        focus,
        dialogs: document.querySelectorAll("dialog,[role='dialog']").length,
        alerts: document.querySelectorAll("[role='alert']").length,
        headings,
        contentHash,
      };
    });
    return { ...state, title };
  } catch {
    return null;
  }
}

export function describeActionOutcome(before: ActionState | null, after: ActionState | null) {
  if (!before || !after) return null;
  const changes: string[] = [];
  if (before.url !== after.url) changes.push(`URL changed to ${after.url}`);
  if (before.title !== after.title) changes.push(`title changed to ${JSON.stringify(after.title)}`);
  if (before.focus !== after.focus) changes.push(`focus changed to ${after.focus || "none"}`);
  if (before.dialogs !== after.dialogs) changes.push(`dialogs ${before.dialogs} -> ${after.dialogs}`);
  if (before.alerts !== after.alerts) changes.push(`alerts ${before.alerts} -> ${after.alerts}`);
  if (before.headings !== after.headings && after.headings) {
    changes.push(`headings now ${JSON.stringify(after.headings)}`);
  }
  if (before.contentHash !== after.contentHash) changes.push("visible page content changed");
  return changes.length ? changes.join("; ") : "no meaningful page-state change detected";
}
