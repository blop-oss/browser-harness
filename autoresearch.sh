#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASKS="${MIND2WEB_TASKS_PATH:-/home/hanan/Documents/repo/blop-app/bench/data/tasks.json}"
BLOP_CLI="${BLOP_CLI_PATH:-/home/hanan/Documents/repo/blop-app/packages/blop/src/cli/index.ts}"
REPORT="$ROOT/benchmarks/mind2web/.mind2web/autoresearch-current"
LOG="/tmp/browser-harness-autoresearch.log"

test -f "$TASKS"
test -f "$BLOP_CLI"
bun run typecheck >/dev/null
rm -rf "$REPORT"

export MIND2WEB_TASKS_PATH="$TASKS"
export BENCH_WEBSITE="${BENCH_WEBSITE:-weather}"
export BENCH_LIMIT="${BENCH_LIMIT:-1}"
export BENCH_TASK_ID="${BENCH_TASK_ID:-}"
export BLOP_AGENT_PROVIDER="ollama"
export BLOP_AGENT_MODEL="gemma4:31b-cloud"
export BLOP_AGENT_BASE_URL="http://localhost:11434/v1"
export BLOP_AGENT_API_KEY="ollama"

set +e
bun run "$BLOP_CLI" test \
  "$ROOT/benchmarks/mind2web/adapters/blop.blop.ts" \
  --report-dir "$REPORT" --reporter all >"$LOG" 2>&1
EXIT_CODE=$?
set -e
cat "$LOG"

if [[ ! -f "$REPORT/results.json" || ! -f "$REPORT/events.jsonl" ]]; then
  echo "METRIC passed=0"
  exit "${EXIT_CODE:-1}"
fi

node - "$REPORT" <<'NODE'
const fs = require("node:fs");
const report = process.argv[2];
const run = JSON.parse(fs.readFileSync(`${report}/results.json`, "utf8"));
const result = run.results[0];
const events = fs.readFileSync(`${report}/events.jsonl`, "utf8")
  .trim().split("\n").filter(Boolean).map(JSON.parse);
const usage = events.filter((event) => event.event_type === "usage")
  .map((event) => event.metadata ?? {});
const metrics = {
  passed: result?.status === "passed" ? 1 : 0,
  llm_calls: usage.length,
  output_tokens: usage.reduce((sum, item) => sum + (item.output ?? 0), 0),
  actions: result?.actions?.length ?? 0,
  snapshots: result?.actions?.filter((action) => action.name === "browser_snapshot").length ?? 0,
  total_input_tokens: usage.reduce((sum, item) => sum + (item.input ?? 0), 0),
  peak_input_tokens: Math.max(0, ...usage.map((item) => item.input ?? 0)),
  duration_ms: result?.durationMs ?? 0,
  tool_errors: events.filter((event) =>
    event.event_type === "step_complete" && event.metadata?.is_error
  ).length,
};
for (const [name, value] of Object.entries(metrics)) {
  console.log(`METRIC ${name}=${value}`);
}
NODE

exit "$EXIT_CODE"
