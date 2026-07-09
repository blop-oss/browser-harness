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

## Key insights

- Unbounded current and historical snapshots dominated input tokens.
- Empty model turns, not browser execution, now dominate run-to-run variance.
- The strict task currently needs approximately 13-14 actions and five
  snapshots with the existing observation contract.

## Next ideas

- Compact post-action observations.
- Batch-final observations.
- Empty-turn handling that avoids runner-level resumes.
