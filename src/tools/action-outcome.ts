import type { Page } from "playwright";

export type ActionState = {
  url: string;
  title: string;
  focus: string;
  dialogs: number;
  alerts: number;
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
      let contentHash = 0;
      for (let index = 0; index < text.length; index += 1) {
        contentHash = ((contentHash * 31) + text.charCodeAt(index)) | 0;
      }
      return {
        url: location.href,
        focus,
        dialogs: document.querySelectorAll("dialog,[role='dialog']").length,
        alerts: document.querySelectorAll("[role='alert']").length,
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
  if (before.contentHash !== after.contentHash) changes.push("visible page content changed");
  return changes.length ? changes.join("; ") : "no meaningful page-state change detected";
}
