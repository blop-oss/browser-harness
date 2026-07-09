import type { Page } from "playwright";

export type BrowserTarget = string | {
  selector?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  testId?: string;
  role?: Parameters<Page["getByRole"]>[0];
  name?: string;
  exact?: boolean;
  first?: boolean;
};

export const targetParameterSchema = {
  oneOf: [
    { type: "string" },
    {
      type: "object",
      properties: {
        selector: { type: "string" },
        text: { type: "string" },
        label: { type: "string" },
        placeholder: { type: "string" },
        testId: { type: "string" },
        role: { type: "string" },
        name: { type: "string" },
        exact: { type: "boolean" },
        first: { type: "boolean" },
      },
    },
  ],
} satisfies Record<string, unknown>;

export function selectorFor(target: unknown) {
  if (typeof target === "object" && target) return JSON.stringify(target);
  return String(target ?? "").trim();
}

/**
 * Like locateTarget but never narrows to `.first()`, so callers can count or
 * enumerate every element the target matches (browser_expect_count,
 * browser_extract).
 */
export function locateAllTargets(page: Page, target: unknown) {
  if (typeof target === "object" && target) {
    const structured = { ...(target as Exclude<BrowserTarget, string>), first: false };
    return locateTarget(page, structured);
  }

  const targetText = selectorFor(target);
  return candidatesFor(page, targetText).reduce((combined, candidate) => combined.or(candidate));
}

export function locateTarget(page: Page, target: unknown) {
  if (typeof target === "object" && target) {
    const structured = target as Exclude<BrowserTarget, string>;
    const exact = Boolean(structured.exact);
    const locator = structured.selector ? safeLocator(page, structured.selector)
      : structured.testId ? page.getByTestId(structured.testId)
      : structured.label ? page.getByLabel(structured.label, { exact })
      : structured.placeholder ? page.getByPlaceholder(structured.placeholder, { exact })
      : structured.role ? page.getByRole(structured.role, { name: structured.name, exact })
      : structured.text ? page.getByText(structured.text, { exact })
      : null;

    if (!locator) throw new Error(`Invalid browser target: ${JSON.stringify(target)}`);
    return structured.first ? locator.first() : locator;
  }

  const targetText = selectorFor(target);
  return candidatesFor(page, targetText).reduce((combined, candidate) => combined.or(candidate)).first();
}

/**
 * Wrap page.locator() so a malformed CSS/XPath selector throws a helpful
 * error instead of Playwright's raw "Malformed selector" message. The agent
 * frequently constructs selectors when accessible names don't match (e.g.
 * product cards with non-standard markup), and a clear error helps it
 * recover by switching to a different targeting strategy.
 */
function safeLocator(page: Page, selector: string) {
  try {
    validateSelectorShape(selector);
    return page.locator(selector);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Malformed selector "${selector}": ${detail}. ` +
      `Use browser_snapshot to inspect the page structure, then retry with ` +
      `a valid CSS selector, a role/name target (e.g. { role: "link", name: "Product name" }), ` +
      `or a text target (e.g. { text: "Preview" }).`,
    );
  }
}

function validateSelectorShape(selector: string): void {
  if (selector.startsWith("//") || selector.startsWith("xpath=")) return;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let brackets = 0;
  let parentheses = 0;

  for (const character of selector) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    if (brackets < 0 || parentheses < 0) break;
  }

  if (quote || brackets !== 0 || parentheses !== 0) {
    throw new Error("unbalanced quotes, brackets, or parentheses");
  }
}

function candidatesFor(page: Page, targetText: string) {
  const candidates = [
    page.getByRole("button", { name: targetText }),
    page.getByRole("link", { name: targetText }),
    page.getByRole("checkbox", { name: targetText }),
    page.getByRole("radio", { name: targetText }),
    page.getByRole("combobox", { name: targetText }),
    page.getByRole("textbox", { name: targetText }),
    page.getByLabel(targetText),
    page.getByPlaceholder(targetText),
    page.getByText(targetText, { exact: false }),
  ];
  // The raw selector fallback lets the agent pass CSS/XPath when accessible
  // names don't apply (e.g. "#submit", "main", "a[href*='/product']"). Guard
  // it: Playwright validates the selector eagerly at locator creation time,
  // and a malformed selector would throw here and poison the entire .or()
  // chain — killing the click even though a text-based candidate above would
  // have matched. Skip the fallback on error; role/label/text candidates
  // already cover plain-text matching.
  try {
    candidates.push(page.locator(targetText));
  } catch {
    // Malformed selector — the accessible-name and text candidates above
    // are still in the chain and will handle the resolution.
  }
  return candidates;
}
