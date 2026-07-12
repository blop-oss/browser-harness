import { readFileSync } from "node:fs";

type BenchmarkAction = {
  name?: string;
  output?: unknown;
  metadata?: { error?: unknown };
};

type BenchmarkResult = {
  status?: string;
  durationMs?: number;
  actions?: BenchmarkAction[];
};

type BenchmarkRun = {
  results?: BenchmarkResult[];
};

type BenchmarkEvent = {
  event_type?: string;
  metadata?: {
    input?: number;
    output?: number;
    is_error?: boolean;
  };
};

export type BenchmarkEvidenceExpectations = {
  urlIncludes?: string;
  titleIncludes?: string;
  textIncludes?: string;
};

export function summarizeMind2WebMetrics(
  run: BenchmarkRun,
  events: BenchmarkEvent[],
  expectations: BenchmarkEvidenceExpectations = {},
) {
  const result = run.results?.[0];
  const actions = result?.actions ?? [];
  const usage = events
    .filter((event) => event.event_type === "usage")
    .map((event) => event.metadata ?? {});
  const actionToolErrors = actions.filter((action) => action.metadata?.error).length;
  const eventToolErrors = events.filter((event) =>
    event.event_type === "step_complete" && event.metadata?.is_error
  ).length;
  const toolErrors = Math.max(actionToolErrors, eventToolErrors);
  const agentPassed = result?.status === "passed" ? 1 : 0;
  const evidencePassed = benchmarkEvidencePassed(actions, expectations) ? 1 : 0;

  return {
    passed: agentPassed === 1 && evidencePassed === 1 && toolErrors === 0 ? 1 : 0,
    agent_passed: agentPassed,
    evidence_passed: evidencePassed,
    llm_calls: usage.length,
    output_tokens: usage.reduce((sum, item) => sum + (item.output ?? 0), 0),
    actions: actions.length,
    snapshots: actions.filter((action) => action.name === "browser_snapshot").length,
    total_input_tokens: usage.reduce((sum, item) => sum + (item.input ?? 0), 0),
    peak_input_tokens: Math.max(0, ...usage.map((item) => item.input ?? 0)),
    duration_ms: result?.durationMs ?? 0,
    action_tool_errors: actionToolErrors,
    event_tool_errors: eventToolErrors,
    tool_errors: toolErrors,
  };
}

function benchmarkEvidencePassed(
  actions: BenchmarkAction[],
  expectations: BenchmarkEvidenceExpectations,
) {
  const required = [expectations.urlIncludes, expectations.titleIncludes, expectations.textIncludes]
    .some((value) => Boolean(value));
  if (!required) return true;

  let finalSnapshot: { url?: unknown; title?: unknown; text?: unknown } | undefined;
  let finalSnapshotIndex = -1;
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    if (action.name !== "browser_snapshot" || typeof action.output !== "string") continue;
    try {
      finalSnapshot = JSON.parse(action.output) as typeof finalSnapshot;
      finalSnapshotIndex = index;
    } catch {
      // A malformed snapshot cannot serve as benchmark evidence.
    }
  }
  if (!finalSnapshot || finalSnapshotIndex < 0) return false;

  const stateChangingTools = new Set([
    "browser_goto", "browser_click", "browser_double_click", "browser_press",
    "browser_type", "browser_go_back", "browser_go_forward", "browser_reload",
    "browser_select_page", "browser_close_page",
  ]);
  if (actions.slice(finalSnapshotIndex + 1).some((action) => stateChangingTools.has(action.name ?? ""))) {
    return false;
  }

  const url = String(finalSnapshot.url ?? "");
  const title = String(finalSnapshot.title ?? "");
  const text = String(finalSnapshot.text ?? "").replace(/\s+/g, " ").trim();
  const expectedText = expectations.textIncludes?.replace(/\s+/g, " ").trim();
  return (!expectations.urlIncludes || url.includes(expectations.urlIncludes))
    && (!expectations.titleIncludes || title.includes(expectations.titleIncludes))
    && (!expectedText || text.includes(expectedText));
}

if (import.meta.main) {
  const report = process.argv[2];
  if (!report) throw new Error("Report directory is required.");
  const run = JSON.parse(readFileSync(`${report}/results.json`, "utf8")) as BenchmarkRun;
  const events = readFileSync(`${report}/events.jsonl`, "utf8")
    .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as BenchmarkEvent);
  const metrics = summarizeMind2WebMetrics(run, events, {
    urlIncludes: process.env.MIND2WEB_EXPECT_URL_CONTAINS,
    titleIncludes: process.env.MIND2WEB_EXPECT_TITLE_CONTAINS,
    textIncludes: process.env.MIND2WEB_EXPECT_TEXT_CONTAINS,
  });
  for (const [name, value] of Object.entries(metrics)) {
    console.log(`METRIC ${name}=${value}`);
  }
  if (metrics.passed !== 1) process.exitCode = 1;
}
