# Mind2Web benchmark progression

This ledger tracks browser-agent performance changes against repeatable
Mind2Web tasks. Use it to detect regressions in task completion, tool use,
latency, and model-context efficiency.

## Evaluation contract

Record a run only when it meets these conditions:

- The task comes from the normalized Mind2Web dataset.
- The agent interacts with the live website through browser-harness tools.
- The run uses no task-specific selectors, shortcuts, or silent action repair.
- Malformed tool calls and failed actions remain visible in the metrics.
- The model, provider, task ID, code commit, and run configuration are recorded.
- A passing result includes deterministic page evidence, not only model prose.

Live websites change over time. A failure caused by a changed website, login,
captcha, outage, or geolocation must be labeled separately from an agent or
harness regression.

## Tracked metrics

Each run records these metrics:

| Metric | Meaning |
| --- | --- |
| Status | Final `finish_test` verdict. |
| Duration | Wall-clock test duration in milliseconds. |
| Actions | Browser actions recorded by the harness. |
| Tool errors | Failed tool executions. |
| Text-only nudges | Agent turns that didn't call a tool. |
| LLM calls | Model requests made during the task. |
| Peak input tokens | Largest prompt sent in one model request. |
| Total input tokens | Sum of prompt tokens across all model requests. |
| Output tokens | Sum of model output tokens. |

## Regression policy

Treat a comparison as a likely regression when the model, task, and environment
are unchanged and any of these conditions occurs:

- A previously passing task fails for an agent or harness reason.
- Tool errors increase from zero to two or more.
- Duration increases by more than 30% across three runs.
- Total input tokens increase by more than 30% across three runs.
- LLM calls increase by more than 25% across three runs.
- The agent passes without deterministic evidence of the requested outcome.

Run each comparison three times before classifying performance-only changes.
Status and correctness regressions require immediate investigation and don't
need three reproductions when the failure is deterministic.

## Reference task

The first reference task is the Seattle hourly-weather task:

| Field | Value |
| --- | --- |
| Task ID | `3cad7a9a-41bd-4c0a-9fd2-0cc34eb8e836` |
| Split | `test_domain` |
| Website | `weather` |
| Instruction | Find the hourly weather forecast for Seattle, WA, for the next 24 hours. |
| Model | `gemma4:31b-cloud` |
| Provider | Ollama Cloud through local Ollama |

## Progress log

The following runs established the initial benchmark baseline. The strict
comparison kept malformed actions visible and used no automatic selector or
tool-argument repair.

| Date | Version | Status | Duration | Actions | Tool errors | Nudges | LLM calls | Peak input | Total input | Output | Notes |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| July 9, 2026 | Before history compaction | Pass | 193,970 ms | 14 | 5 | 2 | 23 | 64,438 | 853,858 | 963 | Repeated full snapshots accumulated in history; several ARIA lines were used as malformed selectors. |
| July 9, 2026 | `4aad09c` + `b4dc8e4` | Pass | 56,814 ms | 14 | 0 | 2 | 13 | 20,486 | 167,106 | Stale snapshots compacted; structured-target instructions clarified; strict malformed-action behavior retained. |

Initial change:

- Duration: `-70.7%`
- LLM calls: `-43.5%`
- Peak input tokens: `-68.2%`
- Total input tokens: `-80.4%`
- Tool errors: `5` to `0`

These figures come from one run per version. They demonstrate the direction of
the change but aren't a stable performance distribution yet.

## Run command

Use the same task and model when checking for regressions:

```bash
cd benchmarks/mind2web

export MIND2WEB_TASKS_PATH=/path/to/tasks.json
export BENCH_WEBSITE=weather
export BENCH_LIMIT=1
export BLOP_AGENT_PROVIDER=ollama
export BLOP_AGENT_MODEL=gemma4:31b-cloud
export BLOP_AGENT_BASE_URL=http://localhost:11434/v1
export BLOP_AGENT_API_KEY=ollama

bun run bench:blop
```

## New entry template

Add one row to the progress log and include these details below it:

```markdown
### YYYY-MM-DD: Short change name

- Harness commit: `<sha>`
- Agent commit or version: `<sha-or-version>`
- Task ID: `<mind2web-task-id>`
- Provider and model: `<provider> / <model>`
- Browser and mode: `<browser> / <headless-or-headed>`
- Status and reason: `<status> / <reason>`
- Evidence: `<assertions, URL, screenshot, or extracted values>`
- Environment caveats: `<none-or-details>`
- Result directory: `<local-or-CI-artifact-path>`
```

Don't commit credentials, downloaded datasets, screenshots, or complete report
directories. Upload reports as CI artifacts when long-term evidence is needed.
