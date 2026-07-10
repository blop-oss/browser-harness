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

### Run 4: Separate empty-turn budget — llm_calls=21 (DISCARD)

- Timestamp: 2026-07-09 16:51
- What changed: Allowed six truly empty provider turns without exhausting the
  existing three-turn text-drift budget.
- Result: Failed after 21 model calls; the cycle detector stopped repeated
  snapshots at 14 actions rather than allowing an unbounded run.
- Insight: A larger empty-turn budget did not improve task completion and gave
  the model more opportunities to enter an action loop.
- Next: Repeat once to distinguish provider variance from a consistent result.

### Run 5: Repeat empty-turn budget — llm_calls=18 (DISCARD)

- Timestamp: 2026-07-09 16:52
- What changed: Repeated Run 4 unchanged.
- Result: Failed after 18 model calls and 25 actions. The cycle detector stopped
  six repetitions of type/click/snapshot on the same search state.
- Insight: Two consecutive failures provide no evidence for keeping the larger
  empty-turn budget. Revert it. The cycle detector is working as intended.
- Next: Improve observations after actions rather than extending model retries.

### Runs 6-8: Batch-final compact observation — median llm_calls=13 (DISCARD)

- Timestamp: 2026-07-09 16:55-16:58
- What changed: Successful interaction batches returned a compact final page
  observation intended to replace the next explicit snapshot.
- Result: All three runs passed. Model calls were 18, 13, and 12; output tokens
  were 752, 689, and 473; actions were 14, 15, and 13. The third run had one
  malformed critical-point call.
- Insight: The best run used one fewer snapshot, but the median output tokens
  increased from the baseline's 551 to 689 and behavior remained inconsistent.
  The added batch complexity is not justified by a stable gain.
- Next: Revert batch observations. Explore a smaller observation tool or scoped
  snapshots that the agent invokes explicitly.

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

## Segment 1: Apartments search and filters

Seattle optimization reached diminishing returns after eight experiments. The
new segment targets the first `apartments` task with the same model, browser,
strictness rules, and metrics.

### Run 9: Apartments baseline — environment blocked (CRASH)

- Timestamp: 2026-07-09 17:01
- Result: Failed after 3 model calls because Apartments.com returned a
  deterministic Akamai 403 Access Denied page.
- Insight: This is an environment/site blocker, not an agent-quality result.
- Next: Move to the first AccuWeather task, which exercises location search and
  radar navigation.

## Segment 2: AccuWeather Miami radar

Task: Find the weather radar map for Miami. The task exercises location search,
result selection, navigation, and deterministic visual/page evidence.

### Run 10: AccuWeather baseline — environment blocked (CRASH)

- Result: Failed after 4 model calls because the site consistently returned
  `ERR_HTTP2_PROTOCOL_ERROR`; two navigation tools failed.
- Insight: This environment cannot produce a useful AccuWeather agent signal.
- Next: Add exact task-ID filtering and select the second Weather.com task.

## Segment 3: Weather.com 10-day forecast

Task ID: `7480540d-0519-440b-b22e-fa7badf55822`. Find the 10-day forecast for
ZIP code 90028. This retains an accessible site while changing the required
location and forecast view.
