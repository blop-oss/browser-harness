import type { BrowserToolContext, NativeToolBridge } from "./types.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const ERROR_LEVELS = new Set(["error", "pageerror", "requestfailed"]);

/**
 * Hosts of common third-party services that the test sandbox/VM often cannot
 * reach (egress blocked, CORS not granted to the sandbox origin). A failed
 * request to one of these is an environment limitation, not an app bug, so the
 * agent must not fail the site over it — surfaced as evidence with that label.
 */
const THIRD_PARTY_HOST_PATTERNS = [
  "web3forms.com",
  "stripe.com",
  "js.stripe.com",
  "api.stripe.com",
  "checkout.stripe.com",
  "paypal.com",
  "www.paypal.com",
  "api.paypal.com",
  "checkout.razorpay.com",
  "api.razorpay.com",
  "api.lemonsqueezy.com",
  "api.paddle.com",
  "api2.mollie.com",
  "recaptcha",
  "google.com/recaptcha",
  "www.google.com/recaptcha",
  "hcaptcha.com",
  "api.hcaptcha.com",
  "sentry.io",
  "amplitude.com",
  "mixpanel.com",
  "segment.io",
  "analytics.google.com",
  "googletagmanager.com",
  "fullstory.com",
  "logrocket.com",
];

function classifyFailedRequest(url: string | undefined, pageUrl: string | undefined): "first-party" | "third-party" | "unknown" {
  if (!url) return "unknown";
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return "unknown";
  }
  if (pageUrl) {
    try {
      if (new URL(pageUrl).host === host) return "first-party";
    } catch {
      // ignore malformed page URL
    }
  }
  if (THIRD_PARTY_HOST_PATTERNS.some((pattern) => host === pattern || host.endsWith(`.${pattern}`) || host.includes(pattern))) {
    return "third-party";
  }
  return "unknown";
}

/**
 * Surface the console/page-error/request-failure log the runner already
 * collects to the agent itself. Without this the agent can only infer app
 * breakage from the UI; with it, a blank page or dead button can be tied to
 * the actual exception or failed request before failing a test.
 */
export function createLogTools(context: BrowserToolContext): NativeToolBridge[] {
  return [
    {
      name: "browser_console_logs",
      description: "Read recent browser console messages, uncaught page errors, and failed network requests. Defaults to errors only; pass level=all for everything.",
      parameters: {
        type: "object",
        properties: {
          level: { type: "string", enum: ["error", "all"], description: "error (default): console errors, page errors, failed requests. all: every captured message." },
          limit: { type: "number", description: `Max entries to return, newest last (default ${DEFAULT_LIMIT}).` },
        },
      },
      promptSnippet: "- browser_console_logs: Check console errors, uncaught exceptions, and failed requests when the app misbehaves, and before failing a test as an app bug — cite the log line as evidence. Failed requests are tagged [first-party] (site origin → app bug) or [third-party] (external service like web3forms/stripe/captcha → usually a sandbox/VM network or CORS block, not an app bug).",
      execute: (input) => context.record("browser_console_logs", input, async () => {
        if (!context.browserLogs) {
          return { content: "Browser log capture is not enabled for this run.", metadata: { enabled: false } };
        }
        const logs = context.browserLogs;
        const level = input.level === "all" ? "all" : "error";
        const limit = normalizeLimit(input.limit);

        const filtered = level === "all" ? logs : logs.filter((log) =>
          log.type === "pageerror" || log.type === "requestfailed" || (log.type === "console" && ERROR_LEVELS.has(log.level ?? "")),
        );
        const recent = filtered.slice(-limit);
        const lines = recent.map((log) => {
          const origin = log.type === "console" ? `console.${log.level ?? "log"}` : log.type;
          let suffix = "";
          if (log.type === "requestfailed") {
            const scope = classifyFailedRequest(log.url, context.page.url());
            if (scope !== "unknown") suffix = ` [${scope}]`;
          }
          return `[${log.timestamp}] ${origin} ${log.url ?? ""}\n  ${truncate(log.message)}${suffix}`;
        });

        const thirdPartyCount = recent.filter(
          (log) => log.type === "requestfailed" && classifyFailedRequest(log.url, context.page.url()) === "third-party",
        ).length;
        const guidance =
          thirdPartyCount > 0
            ? `\n\nNote: ${thirdPartyCount} failed request(s) above are to third-party external services (e.g. form/checkout/analytics providers). These are typically blocked by the test sandbox/VM network or CORS policy, not by a defect in the site under test. Do not fail the site as an app bug solely because a third-party endpoint is unreachable — cite it as a test-environment limitation instead.`
            : "";

        const content = lines.length > 0
          ? `${filtered.length} matching log entr${filtered.length === 1 ? "y" : "ies"} (showing last ${recent.length}):\n\n${lines.join("\n")}${guidance}`
          : level === "error"
            ? "No console errors, page errors, or failed requests captured."
            : "No browser logs captured.";
        return { content, metadata: { level, total: filtered.length, returned: recent.length, thirdPartyFailures: thirdPartyCount } };
      }),
    },
  ];
}

function normalizeLimit(input: unknown) {
  const limit = Number(input ?? DEFAULT_LIMIT);
  if (!Number.isInteger(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

function truncate(value: string, max = 400) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}
