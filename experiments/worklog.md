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

## Key insights

- Unbounded current and historical snapshots dominated input tokens.
- Empty model turns, not browser execution, now dominate run-to-run variance.
- The strict task currently needs approximately 13-14 actions and five
  snapshots with the existing observation contract.

## Next ideas

- Compact post-action observations.
- Batch-final observations.
- Empty-turn handling that avoids runner-level resumes.
