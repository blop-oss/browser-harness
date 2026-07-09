# Mind2Web efficiency worklog

This log records autonomous experiments for the Seattle hourly-weather task.
The primary metric is model-call count, with correctness and zero tool errors
as hard gates.

## Completed work before loop initialization

- Stale snapshot history compaction reduced context accumulation.
- Default ARIA snapshots were capped at 12,000 characters.
- Reasoning effort became configurable but remains non-default.
- Stronger orchestration prompting was tested and reverted after regression.

## Experiment runs

Baseline begins with the first execution of `./autoresearch.sh`.

### Run 1: Capped-snapshot baseline — llm_calls=15 (KEEP)

- Timestamp: 2026-07-09 16:31
- What changed: Established the loop baseline on the current capped-snapshot
  implementation.
- Result: Passed, 15 model calls, 551 output tokens, 15 actions, 5 snapshots,
  140,809 total input tokens, 62,035 ms, and 1 tool error.
- Insight: The only tool error was `record_critical_point` missing its required
  `id`; this is an agent protocol error and remains visible.
- Next: Clarify the critical-point argument contract without repairing omitted
  arguments.

### Run 2: Clarify critical-point fields — llm_calls=179 (CRASH)

- Timestamp: 2026-07-09 16:42
- What changed: Made required `record_critical_point` fields more explicit in
  the tool description and prompt snippet.
- Result: Failed after 601,624 ms, 179 model calls, 8,697 output tokens, 257
  actions, 85 snapshots, and 4,438,367 input tokens.
- Insight: The model entered an 83-cycle search/type/click/snapshot loop. The
  current stall guard includes changing snapshot output in its signature, so
  dynamic page content hides a structurally identical action cycle.
- Next: Revert the prompt experiment and detect repeated action-name/input
  cycles independently of changing output text.

### Run 3: Repeated-cycle detector — llm_calls=15 (DISCARD)

- Timestamp: 2026-07-09 16:47
- What changed: Added structural action-cycle detection in Blop with normalized
  volatile snapshot values and a deterministic regression test.
- Result: Benchmark failed after 15 model calls because the model left a
  critical point pending; 1,282 output tokens, 20 actions, and 1 tool error.
- Insight: This stochastic benchmark run doesn't establish an efficiency win.
  The separate replay test proves the detector stops the exact 3-action cycle
  from Run 2 before 30 actions, so the safety fix is retained outside the
  primary performance ranking.
- Next: Improve empty-turn handling, which is the largest remaining source of
  model-call variance on successful runs.

## Key insights

- Unbounded current and historical snapshots dominated input tokens.
- Empty model turns, not browser execution, now dominate run-to-run variance.
- The strict task currently needs approximately 13-14 actions and five
  snapshots with the existing observation contract.
- Dynamic snapshot output can defeat the current no-progress stall guard even
  when the model repeats the same three action inputs indefinitely.

## Next ideas

- Compact post-action observations.
- Batch-final observations.
- Empty-turn handling that avoids runner-level resumes.
