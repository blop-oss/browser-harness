import type { Locator, Page } from "playwright";

type ReferenceState = {
  snapshot: number;
  refs: Map<string, { locator: Locator; entry: InteractiveReference }>;
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
  actions: string[];
};

export type InteractiveReferences = {
  elements: InteractiveReference[];
  text: string;
  total: number;
  omitted: number;
};

const states = new WeakMap<Page, ReferenceState>();
const MAX_EXPOSED_REFERENCES = 30;
const INTERACTIVE_SELECTOR = [
  "a[href]", "button", "input", "select", "textarea", "summary",
  "[contenteditable='true']", "[tabindex]",
  "[role='button']", "[role='link']", "[role='checkbox']", "[role='radio']",
  "[role='combobox']", "[role='textbox']", "[role='option']", "[role='menuitem']",
  "[role='slider']", "[role='spinbutton']", "[role='switch']", "[role='tab']",
].join(",");

export async function collectInteractiveReferences(page: Page): Promise<InteractiveReferences> {
  const snapshot = (states.get(page)?.snapshot ?? 0) + 1;
  const refs = new Map<string, { locator: Locator; entry: InteractiveReference }>();
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
      const actions = input && (role === "textbox" || role === "combobox") || tag === "textarea" || element.isContentEditable
        ? ["fill", "press", "clear", "focus"]
        : role === "checkbox" || role === "radio" ? ["click", "check", "focus"]
        : tag === "select" ? ["click", "select", "focus"]
        : tag === "a" || tag === "button" || tag === "summary"
          || ["button", "link", "option", "menuitem", "switch", "tab"].includes(role)
          ? ["click", "focus"]
          : ["focus"];
      return [{ index, role, name, value, href, region, states: state, actions }];
    }));

    for (const entry of entries) {
      sequence += 1;
      const ref = `s${snapshot}:e${sequence}`;
      const entryLocator = locator.nth(entry.index);
      const reference: InteractiveReference = {
        ref,
        role: entry.role,
        name: entry.name,
        ...(entry.value ? { value: entry.value } : {}),
        ...(entry.href ? { href: entry.href } : {}),
        ...(entry.region ? { region: entry.region } : {}),
        ...(frame !== page.mainFrame() ? { frame: compactFrame(frame.url()) } : {}),
        ...(entry.states.length ? { states: entry.states } : {}),
        actions: entry.actions,
      };
      refs.set(ref, { locator: entryLocator, entry: reference });
      collected.push({
        ...reference,
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
  const stored = states.get(page)?.refs.get(ref);
  if (!stored) {
    throw new Error(`Unknown or stale element reference "${ref}". Take a new browser_snapshot and use a current reference.`);
  }
  return stored.locator;
}

export function validateReferenceAction(page: Page, target: unknown, toolName: string) {
  if (!target || typeof target !== "object" || !("ref" in target)) return;
  const ref = String((target as { ref?: unknown }).ref ?? "");
  const stored = states.get(page)?.refs.get(ref);
  if (!stored) return;
  const action = toolAction(toolName);
  if (!action || stored.entry.actions.includes(action)) return;
  throw new Error(
    `Cannot ${action} [${ref}] ${stored.entry.role} ${JSON.stringify(stored.entry.name)}. `
    + `Allowed actions: ${stored.entry.actions.join(", ")}.`,
  );
}

export function semanticActionSignature(page: Page, target: unknown, toolName: string) {
  if (!target || typeof target !== "object" || !("ref" in target)) {
    return `${toolName}:${JSON.stringify(target)}`;
  }
  const ref = String((target as { ref?: unknown }).ref ?? "");
  const entry = states.get(page)?.refs.get(ref)?.entry;
  return entry
    ? `${toolName}:${entry.frame ?? "main"}:${entry.role}:${entry.name}`
    : `${toolName}:${ref}`;
}

export async function describeLocatorBlocker(page: Page, locator: Locator) {
  const blocker = await locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return null;
    const rect = element.getBoundingClientRect();
    const insetX = Math.min(4, rect.width / 4);
    const insetY = Math.min(4, rect.height / 4);
    const points = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + insetX, rect.top + insetY],
      [rect.right - insetX, rect.top + insetY],
      [rect.left + insetX, rect.bottom - insetY],
      [rect.right - insetX, rect.bottom - insetY],
    ];
    const blockers = points.flatMap(([rawX, rawY]) => {
      const x = Math.max(0, Math.min(innerWidth - 1, rawX));
      const y = Math.max(0, Math.min(innerHeight - 1, rawY));
      const top = document.elementFromPoint(x, y);
      if (!top || top === element || element.contains(top)) return [];
      const overlay = top.closest("iframe,dialog,[role='dialog'],[aria-modal='true']") ?? top;
      const overlayStyle = getComputedStyle(overlay);
      const overlayRect = overlay.getBoundingClientRect();
      const isLargeFixedOverlay = ["fixed", "sticky"].includes(overlayStyle.position)
        && overlayRect.width * overlayRect.height > innerWidth * innerHeight * 0.2;
      const isSemanticOverlay = overlay instanceof HTMLIFrameElement
        || overlay instanceof HTMLDialogElement
        || overlay.getAttribute("role") === "dialog"
        || overlay.getAttribute("aria-modal") === "true";
      if (!isSemanticOverlay && !isLargeFixedOverlay) return [];
      return [{
        tag: overlay.tagName.toLowerCase(),
        name: overlay.getAttribute("aria-label") || overlay.getAttribute("title") || "",
        source: overlay instanceof HTMLIFrameElement ? overlay.src : "",
      }];
    });
    if (blockers.length < 3) return null;
    return blockers[0];
  }).catch(() => null);
  if (!blocker) return null;

  const frameControls = [...(states.get(page)?.refs.values() ?? [])]
    .map((stored) => stored.entry)
    .filter((entry) => entry.frame && entry.actions.includes("click") && entry.states?.includes("in-viewport"))
    .sort((left, right) => blockerPriority(right) - blockerPriority(left))
    .slice(0, 5)
    .map((entry) => `[${entry.ref}] ${entry.role} ${JSON.stringify(entry.name)}`);
  const identity = blocker.source || blocker.name || blocker.tag;
  return `Target is occluded by ${identity}. Do not retry it until the blocker is handled.`
    + (frameControls.length ? ` Available frame controls: ${frameControls.join("; ")}.` : "");
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
    `actions=[${entry.actions.join(",")}]`,
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

function blockerPriority(entry: InteractiveReference) {
  return /accept|reject|allow|agree|consent|cookie/i.test(entry.name) ? 10 : 0;
}

function toolAction(toolName: string) {
  if (["browser_click", "browser_double_click", "browser_right_click"].includes(toolName)) return "click";
  if (toolName === "browser_type") return "fill";
  if (toolName === "browser_press") return "press";
  if (toolName === "browser_clear") return "clear";
  if (["browser_check", "browser_uncheck"].includes(toolName)) return "check";
  if (toolName === "browser_select_option") return "select";
  if (toolName === "browser_focus") return "focus";
  return null;
}
