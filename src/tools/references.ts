import type { Locator, Page } from "playwright";

type ReferenceState = {
  snapshot: number;
  refs: Map<string, Locator>;
};

export type InteractiveReference = {
  ref: string;
  role: string;
  name: string;
  value?: string;
  href?: string;
  region?: string;
  frame?: string;
  states?: string[];
};

export type InteractiveReferences = {
  elements: InteractiveReference[];
  text: string;
  total: number;
  omitted: number;
};

const states = new WeakMap<Page, ReferenceState>();
const MAX_EXPOSED_REFERENCES = 60;
const INTERACTIVE_SELECTOR = [
  "a[href]", "button", "input", "select", "textarea", "summary",
  "[contenteditable='true']", "[tabindex]",
  "[role='button']", "[role='link']", "[role='checkbox']", "[role='radio']",
  "[role='combobox']", "[role='textbox']", "[role='option']", "[role='menuitem']",
  "[role='slider']", "[role='spinbutton']", "[role='switch']", "[role='tab']",
].join(",");

export async function collectInteractiveReferences(page: Page): Promise<InteractiveReferences> {
  const snapshot = (states.get(page)?.snapshot ?? 0) + 1;
  const refs = new Map<string, Locator>();
  const collected: (InteractiveReference & { locator: Locator })[] = [];
  let sequence = 0;

  for (const frame of page.frames()) {
    const locator = frame.locator(INTERACTIVE_SELECTOR);
    const entries = await locator.evaluateAll((elements) => elements.flatMap((element, index) => {
      if (!(element instanceof HTMLElement)) return [];
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return [];

      const tag = element.tagName.toLowerCase();
      const input = element instanceof HTMLInputElement ? element : null;
      const role = element.getAttribute("role") || (tag === "a" ? "link"
        : tag === "button" || tag === "summary" ? "button"
        : tag === "textarea" ? "textbox"
        : tag === "select" ? "combobox"
        : input?.type === "checkbox" ? "checkbox"
        : input?.type === "radio" ? "radio"
        : input?.type === "range" ? "slider"
        : input?.type === "number" ? "spinbutton"
        : input ? "textbox"
        : element.isContentEditable ? "textbox"
        : "interactive");
      const labels = "labels" in element
        ? Array.from((element as HTMLInputElement).labels ?? []).map((label) => label.innerText.trim()).filter(Boolean).join(" ")
        : "";
      const labelledBy = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "").filter(Boolean).join(" ");
      const name = (element.getAttribute("aria-label") || labelledBy || labels
        || element.getAttribute("alt") || element.getAttribute("title")
        || element.getAttribute("placeholder") || element.innerText || "")
        .replace(/\s+/g, " ").trim().slice(0, 160);
      if (!name && element !== document.activeElement) return [];

      const state: string[] = [];
      if (element === document.activeElement) state.push("focused");
      if ((element as HTMLInputElement).disabled || element.getAttribute("aria-disabled") === "true") state.push("disabled");
      if (input?.checked || element.getAttribute("aria-checked") === "true") state.push("checked");
      if (element.getAttribute("aria-expanded") === "true") state.push("expanded");
      if (element.getAttribute("aria-selected") === "true") state.push("selected");
      const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
      if (inViewport) {
        state.push("in-viewport");
        const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
        const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
        const top = document.elementFromPoint(x, y);
        if (top && top !== element && !element.contains(top)) state.push("occluded");
      }

      const regionElement = element.closest("dialog,[role='dialog'],form,nav,main,[role='navigation'],[role='main'],[role='search']");
      const region = regionElement ? [
        regionElement.getAttribute("role") || regionElement.tagName.toLowerCase(),
        regionElement.getAttribute("aria-label") || "",
      ].filter(Boolean).join(":") : undefined;
      const value = "value" in element ? String((element as HTMLInputElement).value).slice(0, 160) : undefined;
      const href = element instanceof HTMLAnchorElement ? element.href : undefined;
      return [{ index, role, name, value, href, region, states: state }];
    }));

    for (const entry of entries) {
      sequence += 1;
      const ref = `s${snapshot}:e${sequence}`;
      const entryLocator = locator.nth(entry.index);
      refs.set(ref, entryLocator);
      collected.push({
        ref,
        role: entry.role,
        name: entry.name,
        ...(entry.value ? { value: entry.value } : {}),
        ...(entry.href ? { href: entry.href } : {}),
        ...(entry.region ? { region: entry.region } : {}),
        ...(frame !== page.mainFrame() ? { frame: compactFrame(frame.url()) } : {}),
        ...(entry.states.length ? { states: entry.states } : {}),
        locator: entryLocator,
      });
    }
  }

  states.set(page, { snapshot, refs });
  collected.sort((left, right) => referencePriority(right) - referencePriority(left));
  const exposed = collected.slice(0, MAX_EXPOSED_REFERENCES);
  const elements = exposed.map(({ locator: _locator, ...entry }) => entry);
  return {
    elements,
    text: elements.map(formatReference).join("\n"),
    total: collected.length,
    omitted: Math.max(0, collected.length - elements.length),
  };
}

export function locateReference(page: Page, ref: string): Locator {
  const locator = states.get(page)?.refs.get(ref);
  if (!locator) {
    throw new Error(`Unknown or stale element reference "${ref}". Take a new browser_snapshot and use a current reference.`);
  }
  return locator;
}

function referencePriority(entry: InteractiveReference) {
  const current = entry.states ?? [];
  return (entry.frame ? 1 : 0)
    + (current.includes("focused") ? 8 : 0)
    + (current.includes("in-viewport") ? 4 : 0)
    - (current.includes("occluded") ? 2 : 0)
    - (current.includes("disabled") ? 1 : 0);
}

function formatReference(entry: InteractiveReference) {
  const details = [
    entry.value ? `value=${JSON.stringify(entry.value)}` : "",
    entry.href ? `href=${JSON.stringify(entry.href)}` : "",
    entry.region ? `region=${JSON.stringify(entry.region)}` : "",
    entry.frame ? `frame=${JSON.stringify(entry.frame)}` : "",
    entry.states?.length ? `[${entry.states.join(",")}]` : "",
  ].filter(Boolean).join(" ");
  return `[${entry.ref}] ${entry.role} ${JSON.stringify(entry.name)}${details ? ` ${details}` : ""}`;
}

function compactFrame(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`.slice(0, 120);
  } catch {
    return url.slice(0, 120);
  }
}
