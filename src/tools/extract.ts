import type { BrowserToolContext, NativeToolBridge } from "./types.js";
import { locateAllTargets, selectorFor, targetParameterSchema } from "./locators.js";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const MAX_FIELD_LENGTH = 300;

/**
 * Structured bulk extraction: read text/value/attributes from every element a
 * target matches in one call. Inspired by Webwright, where extraction and
 * comparison happen in code over the whole result set instead of one
 * element-read per model round-trip — this is the controlled-tool version of
 * that. It is the grounding tool for ranking/sorting claims: extract the
 * visible metric for all rows, then compare.
 */
export function createExtractTools(context: BrowserToolContext): NativeToolBridge[] {
  return [
    {
      name: "browser_extract",
      description: "Extract text, input values, or attributes from every element matching a target in one call. Returns a JSON array plus the total match count.",
      parameters: {
        type: "object",
        properties: {
          target: targetParameterSchema,
          fields: {
            type: "array",
            items: { type: "string" },
            description: "Fields per element: \"text\" (default), \"value\", \"html\", or \"attribute:<name>\" e.g. \"attribute:href\".",
          },
          limit: { type: "number", description: `Max elements to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` },
        },
        required: ["target"],
      },
      promptSnippet: "- browser_extract: Read text/values/attributes from ALL matches of a target in one call. Use it to ground list, ranking, sort, and count claims in actual page data instead of reading rows one by one.",
      execute: (input) => context.record("browser_extract", input, async () => {
        const target = selectorFor(input.target);
        const fields = normalizeFields(input.fields);
        const limit = normalizeLimit(input.limit);

        const locator = locateAllTargets(context.page, input.target);
        // One page round-trip for everything: per-element locator reads would
        // re-evaluate the (possibly 10-way union) locator for every field of
        // every row.
        const { total, rows } = await locator.evaluateAll(
          (elements, args: { limit: number; fields: ExtractField[] }) => ({
            total: elements.length,
            rows: elements.slice(0, args.limit).map((element) => {
              const row: Record<string, string | null> = {};
              for (const field of args.fields) {
                row[field.key] = field.kind === "text" ? (element instanceof HTMLElement ? element.innerText : element.textContent)
                  : field.kind === "value" ? ("value" in element ? String((element as { value: unknown }).value) : null)
                  : field.kind === "html" ? element.innerHTML
                  : element.getAttribute(field.attribute ?? "");
              }
              return row;
            }),
          }),
          { limit, fields },
        );
        const items = rows.map((row) => Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, value === null ? null : compact(value)]),
        ));

        const payload = { target, total, returned: items.length, truncated: total > items.length, items };
        return {
          content: JSON.stringify(payload, null, 2),
          metadata: { target, total, returned: items.length, fields: fields.map((field) => field.key) },
        };
      }),
    },
  ];
}

type ExtractField = { key: string; kind: "text" | "value" | "html" | "attribute"; attribute?: string };

function normalizeFields(input: unknown): ExtractField[] {
  const raw = Array.isArray(input) && input.length > 0 ? input.map(String) : ["text"];
  return raw.map((field) => {
    if (field === "text" || field === "value" || field === "html") return { key: field, kind: field };
    if (field.startsWith("attribute:")) {
      const attribute = field.slice("attribute:".length).trim();
      if (!attribute) throw new Error(`Invalid extract field: ${field}`);
      return { key: field, kind: "attribute" as const, attribute };
    }
    throw new Error(`Unknown extract field "${field}". Use text, value, html, or attribute:<name>.`);
  });
}

function normalizeLimit(input: unknown) {
  const limit = Number(input ?? DEFAULT_LIMIT);
  if (!Number.isInteger(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

function compact(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > MAX_FIELD_LENGTH ? `${trimmed.slice(0, MAX_FIELD_LENGTH)}…` : trimmed;
}
