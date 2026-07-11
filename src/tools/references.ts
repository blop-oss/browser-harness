import type { Locator, Page } from "playwright";

type ReferenceState = {
  attribute: string;
  snapshot: number;
  refs: Map<string, { tag: string; role: string; name: string }>;
};

export type InteractiveReference = {
  ref: string;
  role: string;
  name: string;
  value?: string;
  states?: string[];
};

const states = new WeakMap<Page, ReferenceState>();

export async function collectInteractiveReferences(page: Page): Promise<InteractiveReference[]> {
  const previous = states.get(page);
  const snapshot = (previous?.snapshot ?? 0) + 1;
  const attribute = previous?.attribute ?? `data-blop-ref-${Math.random().toString(36).slice(2, 10)}`;
  const selector = [
    "a[href]", "button", "input", "select", "textarea", "summary",
    "[contenteditable='true']", "[tabindex]",
    "[role='button']", "[role='link']", "[role='checkbox']", "[role='radio']",
    "[role='combobox']", "[role='textbox']", "[role='option']", "[role='menuitem']",
    "[role='slider']", "[role='spinbutton']", "[role='switch']", "[role='tab']",
  ].join(",");

  const entries = await page.locator(selector).evaluateAll((elements, args) => {
    const previousAttribute = args.previousAttribute;
    if (previousAttribute) {
      document.querySelectorAll(`[${previousAttribute}]`).forEach((element) => element.removeAttribute(previousAttribute));
    }

    return elements.flatMap((element, index) => {
      if (!(element instanceof HTMLElement)) return [];
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return [];

      const tag = element.tagName.toLowerCase();
      const explicitRole = element.getAttribute("role") ?? "";
      const input = element instanceof HTMLInputElement ? element : null;
      const role = explicitRole || (tag === "a" ? "link"
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
      const name = (element.getAttribute("aria-label")
        || labels
        || element.getAttribute("alt")
        || element.getAttribute("title")
        || element.getAttribute("placeholder")
        || element.innerText
        || "").replace(/\s+/g, " ").trim().slice(0, 200);
      const ref = `s${args.snapshot}:e${index + 1}`;
      element.setAttribute(args.attribute, ref);

      const state: string[] = [];
      if (element === document.activeElement) state.push("focused");
      if ((element as HTMLInputElement).disabled || element.getAttribute("aria-disabled") === "true") state.push("disabled");
      if (input?.checked || element.getAttribute("aria-checked") === "true") state.push("checked");
      if (element.getAttribute("aria-expanded") === "true") state.push("expanded");
      if (element.getAttribute("aria-selected") === "true") state.push("selected");
      const value = "value" in element ? String((element as HTMLInputElement).value) : undefined;
      return [{ ref, tag, role, name, ...(value ? { value: value.slice(0, 200) } : {}), ...(state.length ? { states: state } : {}) }];
    });
  }, { attribute, previousAttribute: previous?.attribute, snapshot });

  states.set(page, {
    attribute,
    snapshot,
    refs: new Map(entries.map((entry) => [entry.ref, { tag: entry.tag, role: entry.role, name: entry.name }])),
  });
  return entries.map(({ tag: _tag, ...entry }) => entry);
}

export function locateReference(page: Page, ref: string): Locator {
  const state = states.get(page);
  const expected = state?.refs.get(ref);
  if (!state || !expected) {
    throw new Error(`Unknown or stale element reference "${ref}". Take a new browser_snapshot and use a current reference.`);
  }

  return page.locator(`${expected.tag}[${state.attribute}=${JSON.stringify(ref)}]`);
}
