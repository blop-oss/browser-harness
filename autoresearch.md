# Autoresearch: Mind2Web agent efficiency

## Objective

Reduce model calls and output tokens for live Mind2Web tasks while preserving
correctness, strict tool semantics, and agent independence. Start with task
`3cad7a9a-41bd-4c0a-9fd2-0cc34eb8e836` (Seattle hourly weather), then move to
the next task after improvements reach diminishing returns.

## Metrics

- **Primary**: `llm_calls` (count, lower is better).
- **Secondary**: `output_tokens`, `actions`, `snapshots`, `total_input_tokens`,
  `peak_input_tokens`, `duration_ms`, `tool_errors`, and `passed`.

An experiment can be kept only when `passed=1` and `tool_errors=0`. Performance
changes require repeated runs because Ollama Cloud sometimes returns empty
turns.

## How to run

Run `./autoresearch.sh`. It prints one `METRIC name=value` line per metric.

Required local services and data:

- Ollama is signed in and serving `gemma4:31b-cloud` on port `11434`.
- `MIND2WEB_TASKS_PATH` points to normalized Mind2Web `tasks.json`.
- `BLOP_CLI_PATH` points to the local Blop CLI source file.

The script provides defaults matching the current sibling-repository layout.

## Files in scope

- `src/tools/page.ts`: browser snapshot payload and observation controls.
- `src/tools/batch.ts`: deterministic multi-action execution contract.
- `src/tools/*.ts`: generic tool ergonomics when evidence shows a bottleneck.
- `test/browser/*.test.ts`: deterministic regression coverage.
- `benchmarks/mind2web/**`: benchmark adapters, metrics, and documentation.
- Blop's `packages/blop/src/runtime/agent-loop.ts`: model-history behavior.
- Blop's `packages/blop/src/runtime/runner.ts`: generic browser-agent policy.

## Off limits

- Task-specific selectors, URLs, or website code paths in production tools.
- Automatic repair of malformed agent actions.
- Hiding tool failures or changing benchmark verdicts.
- Committing datasets, credentials, screenshots, or full run reports.
- Optimizing against model prose without deterministic browser evidence.

## Constraints

- Browser-harness and Blop focused tests and typechecks must pass.
- Every kept change must apply to agents and websites generally.
- Compare the same task, model, provider, and headless browser settings.
- Record rejected experiments as well as wins.
- Run three repetitions before declaring a performance-only improvement stable.

## What's been tried

- **Kept:** Compact stale snapshots in Blop model history. Strict run improved
  from 23 to 13 model calls and 963 to 587 output tokens.
- **Kept:** Cap default ARIA snapshot content at 12,000 characters. Peak input
  dropped from about 20.5K to 14.4K tokens. Two runs exposed significant empty
  turn variance (11 and 20 model calls).
- **Kept as optional:** `--reasoning-effort`. `low` and `none` both passed, but
  neither beat the best default run reliably.
- **Rejected:** Stronger batching/critical-point prompt rules. One run regressed
  to 22 model calls and 16 actions, so the prompt changes were reverted.

## Next ideas

- Return a small post-action observation from interaction tools so an agent can
  avoid a separate full snapshot after every click.
- Add a final compact observation to successful `browser_run_steps` results.
- Distinguish empty provider turns from meaningful text-only turns and retry
  them without forcing a full runner resume.
- Evaluate snapshot sections or scoped snapshots instead of one flat ARIA tree.
