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

### Run 11: 10-day forecast baseline — llm_calls=15 (KEEP)

- Timestamp: 2026-07-09 17:04
- Result: Passed with 15 model calls, 718 output tokens, 11 actions, 3
  snapshots, 137,121 total input tokens, and 1 tool error.
- Insight: The model requested `maxAriaChars: 20000` for every snapshot and an
  inexact `10 Day` role/name target collided with `Next 10 Days`.
- Next: Hide the snapshot expansion knob from the model-facing schema and
  clarify `exact: true` for ambiguous accessible names.

### Run 12: Fixed snapshot schema and exact-target prompt — llm_calls=25 (DISCARD)

- Result: Passed, but used 25 model calls, 1,164 output tokens, and repeated the
  same ambiguous `10 Day` click eight times.
- Insight: Peak input fell from 16,988 to 14,661 tokens, so the fixed snapshot
  budget worked. The exact-target prompt did not. More importantly, failed
  tools are not recorded as actions, leaving the runner's cycle guard blind.
- Next: Revert the exact-target prompt, retain the fixed snapshot budget, and
  record failed actions so repeated failures become observable.

### Runs 13-15: Fixed schema and failed-action recording — median llm_calls=24 (DISCARD)

- Result: All passed. Calls were 25, 12, and 24; output tokens were 1,129, 453,
  and 1,740. Peak input stayed bounded between 14,587 and 15,338 tokens.
- Insight: Hiding snapshot expansion stabilized peak context but did not improve
  calls or output reliably. Recording failed actions is retained because it
  makes reports and cycle detection honest; the schema restriction is reverted.
- Next: Give strict-mode ambiguity failures concise recovery guidance instead
  of relying on a long Playwright error and full ARIA context.

### Runs 16-17: Ambiguity recovery guidance — llm_calls=21/27 (DISCARD)

- What changed: Added concise `exact: true`/unique-selector recovery text to
  strict-mode failures.
- Result: One slow pass and one cycle-guarded failure. The model still retried
  ambiguous links and later entered a repeated snapshot cycle.
- Insight: More prompt/error prose is not improving this model reliably and
  increases output/context. Revert the guidance.
- Next: Keep failed-action recording, update the benchmark ledger, and stop
  prompt-level tuning for this model/task pair.

## Segment 4: Weather.com health forecasts

Task ID: `8cfb8d75-8076-4f0a-a7e0-4f0c5a94aaae`. Find the cold and flu forecast
and today's air quality in Champaign, IL. This tests whether the agent can track
and prove two distinct outcomes without duplicate exploration.

### Run 18: Health forecast baseline — llm_calls=37 (CRASH)

- Result: Failed after 37 model calls and 40 actions when the cycle guard
  stopped repeated type/click/snapshot search attempts.
- Insight: Filling the location field succeeded, but clicking the site's Search
  button did not submit. The model never switched to Enter.
- Next: Add an explicit, generic `submit: true` option to `browser_type` so an
  agent can fill and press Enter in one controlled action.

### Runs 19-21: Type-and-submit — median llm_calls=20 (INCONCLUSIVE)

- Timestamp: 2026-07-12 00:18-00:21 UTC
- What changed: Evaluated the existing generic `submit: true` option on the
  health-forecast task. The current branch also contains later semantic
  reference and action-outcome changes, so the baseline comparison is not an
  isolated estimate of the option's effect.
- Result: All three runs passed and used type-and-submit. Calls were 14, 20,
  and 21; output tokens were 883, 683, and 891. Only Run 19 met the zero-error
  gate. Runs 20 and 21 reported 3 and 1 tool errors, respectively.
- Insight: The option broke the original search-submission loop and reduced the
  median from the failed 37-call baseline, but repeated correctness evidence is
  not clean enough for a performance claim. Inspection also found that the
  action trail contained four errors in Run 20 and three in Run 21 while the
  event-based metric reported only three and one. Benchmark accounting can hide
  failed actions.
- Next: Make `tool_errors` conservatively include recorded action failures, add
  a deterministic metric regression test, then choose a fresh live segment.

### Run 22: Conservative tool-error accounting (KEEP)

- What changed: Extracted report metric calculation into a tested module. The
  `tool_errors` gate now uses the greater of action-trail failures and runner
  error events, and reports both source counts separately.
- Result: The focused benchmark tests passed 4/4, typecheck passed, and replaying
  the Run 21 report returned 3 action errors, 1 event error, and a conservative
  `tool_errors=3` instead of the previous value of 1.
- Insight: A zero value now requires both evidence streams to be clean. The
  maximum avoids double-counting the same failure while preserving the hard
  gate even when one stream omits it.
- Next: Select a fresh accessible task before changing another tool contract.

## Segment 5: The Weather Network weekend forecast

Task ID: `8d7ac150-0b71-4980-8c9b-290a0f61db1d`. Show the weekend forecast in
Allenford. This read-only task moves to a new site while retaining comparable
location-search and forecast-navigation behavior. It avoids the known
Apartments and AccuWeather environment blockers.

### Run 23: Weather Network baseline run 1 — llm_calls=23 (DISCARD)

- Result: Passed with 23 calls, 812 output tokens, 17 actions, 8 snapshots, and
  1 tool error.
- Insight: Type-and-submit worked, but the model first selected an occluded
  `All 7 days` link rather than the visible `Weekend` link. It recovered after
  a new snapshot, but the run fails the zero-error gate.
- Next: Repeat the unchanged baseline to measure variance before selecting a
  tool-contract experiment.

### Run 24: Weather Network baseline run 2 — llm_calls=29 (DISCARD)

- Result: Passed with 29 calls, 730 output tokens, 29 actions, 13 snapshots,
  and 1 action-trail error that had no matching error event.
- Insight: After reaching Allenford, the model repeated the same menu click and
  snapshot six times. Snapshot-scoped ref IDs changed on every observation, so
  the host cycle detector did not recognize structurally identical behavior.
- Next: Complete the third baseline repetition, then test ref normalization in
  the deterministic cycle guard before another live run.

### Run 25: Weather Network baseline run 3 — llm_calls=13 (DISCARD)

- Result: Reported a pass with 13 calls, 531 output tokens, 13 actions, 4
  snapshots, and zero tool errors.
- Insight: Manual evidence inspection rejected the verdict. The agent remained
  on the current-weather URL, opened a menu containing `Weekend`, and used a
  screenshot plus a text-presence assertion without navigating to or reading
  the weekend forecast. A host-reported pass is not sufficient correctness
  evidence.
- Next: Keep correctness as a manual hard gate and fix the reference-aware
  cycle detector exposed by Run 24.

### Run 26: Normalize reference generations in cycle signatures (KEEP)

- What changed: In Blop's host-side cycle signature, normalize `s12:e7` to
  `s#:e7`. This ignores the snapshot generation while preserving the element
  sequence, so clicks on distinct exposed elements remain distinguishable.
- Result: Added a deterministic real-browser regression that repeatedly takes
  a new snapshot and clicks the same current reference. The focused runner file
  passed 5/5, and the Blop package typecheck passed.
- Insight: Snapshot-scoped references had invalidated the earlier structural
  cycle guard because every observation changed the click input. The guard now
  detects the same element across regenerated snapshots without weakening stale
  reference enforcement in the harness.
- Next: Run three isolated repetitions on the same pinned task. A useful live
  result must reach the weekend forecast, contain forecast evidence, and have
  zero action and event errors.

### Run 27: Reference-normalized guard run 1 — llm_calls=12 (DISCARD)

- Result: Reached the weekend URL and recorded Saturday and Sunday forecast
  evidence in 12 calls and 395 output tokens.
- Insight: One initial menu click timed out before the model recovered with a
  new snapshot. Correctness passed manual review, but the tool-error hard gate
  rejected the run.
- Next: Continue the pinned repetitions. The cycle fix is a safety correction;
  no performance conclusion follows from this single run.

### Runs 28-30: Parallel Chromium control — median llm_calls=20 (DISCARD)

- What changed: Added isolated three-worker benchmark execution and ran the
  unchanged task with Chromium.
- Result: Host pass 3/3, manual correctness 2/3, strict-valid 0/3. Every run
  had an ordinal-reference error; Run 29 stopped on the broad 7-day view.
- Insight: The dominant defect was backend-independent. Public refs stored a
  live `locator.nth(index)`, so controls inserted after observation silently
  changed which element an old ref targeted.

### Runs 31-33: Camoufox baseline — median llm_calls=23 (DISCARD)

- What changed: Added the optional Camoufox backend and repeated the pinned
  task with `camoufox-js@0.11.1` and the stable local 150.0.2-alpha.26 binary.
- Result: Host pass 3/3, manual correctness 2/3, strict-valid 0/3. Median was
  23 calls, 25 actions, 10 snapshots, and 107.6 seconds. Run 33 falsely passed
  on the 14-day page. The traces contained 7 explicit errors and 12 silent
  wrong-reference actions.
- Insight: Camoufox is viable, but changing browsers does not repair a harness
  identity bug. Its more dynamic timing made ordinal drift easier to trigger.

### Runs 34-36: Exact Playwright ARIA identity — median llm_calls=19 (DISCARD)

- What changed: Backed public snapshot refs with Playwright AI ARIA refs and
  count-gated role/name occurrence matching; added main- and sibling-frame
  insertion regressions.
- Result: Manual correctness improved to 3/3 and two runs were clean. Median
  fell to 19 calls, 14 actions, 5 snapshots, and 81.5 seconds. Run 36 still had
  a consent interception, an ambiguous text click, and a hidden-first text
  assertion failure.
- Insight: Exact element identity removed every silent misroute. The remaining
  failures were ordinary target-contract and dynamic-overlay cases.

### Runs 37-39: Target-contract refinement — median llm_calls=15 (DISCARD)

- What changed: Fixed page-level visible-text assertions, added exact DOM-id
  targets, and strengthened blocker/finish guidance.
- Result: All outcomes were correct, but every run violated the error gate.
  One mixed an old element ordinal into a new snapshot prefix, one copied an
  escaped snapshot line into a nested role value, and one ignored an occluded
  marker.
- Insight: A compositional `sN:eN` public ID invites models to splice a current
  generation onto a remembered ordinal. Prompt prose is weaker than changing
  the representation.

### Runs 40-42: Modal-scoped exposure — median llm_calls=12 (DISCARD)

- What changed: Suppressed controls behind a blocking modal while retaining
  dialog actions, and conservatively recovered the uniquely parseable escaped
  role/name transport shape.
- Result: Runs 40-41 were clean and correct; Run 42 repeatedly observed the
  same page, then exhausted its no-tool-call/resume budget without finishing.
- Insight: Modal scoping eliminated action errors, but one provider-level stall
  prevents a stable performance conclusion.

### Runs 43-45: Persistent raw refs and live modal guard — median llm_calls=16 (DISCARD)

- What changed: Exposed Playwright's opaque persistent `eN`/`fNeN` refs
  directly, rebuilt a current-observation allowlist, added structured action
  targets, and guarded mutations against modals appearing after observation.
- Result: All three were genuinely correct and no silent wrong actions
  remained. Only Run 43 was error-free; consent appeared between observation
  and action in Runs 44-45, and one slow navigation timed out after its URL had
  already changed.
- Insight: Raw refs solve the splice/memory problem. The last failures were a
  measurable initial-load race, not element identity.

### Runs 46-48: Final Camoufox batch — median llm_calls=14 (KEEP)

- What changed: After `DOMContentLoaded`, `browser_goto` now gives the final
  load event a bounded five-second settle window. Expected late modal
  interception is a safe `blocked` result, and a click that already changed
  URL is recognized even if destination loading exceeds the click timeout.
- Result: Genuine correctness 3/3, error-free 3/3. Median: 14 calls, 446 output
  tokens, 13 actions, 5 snapshots, 131,639 total input tokens, 16,183 peak
  input tokens, and 43.6 seconds. Every run ended on `/allenford/weekend` with
  the `Weekend Forecast - The Weather Network` title and Allenford evidence.
- Insight: Versus the original Camoufox baseline, median calls fell 39%,
  actions 48%, snapshots 50%, total input tokens 48%, and duration 59%.

### Runs 49-51: Final Chromium control — median llm_calls=14 (DISCARD)

- Result: Manual correctness 3/3, strict-valid 0/3. Two runs flattened an
  opaque ref beside the tool's other arguments instead of nesting it under
  `target`; the third had a runner-only error event.
- Insight: The requested Camoufox backend is the retained default because its
  final repeated batch met both hard gates while the identical Chromium
  control did not. The control also confirms the gain is not a task-specific
  selector or URL shortcut.

### Run 52: Post-batch deterministic hardening (KEEP)

- What changed: Extended cycle normalization to rotating monotonic `xN`
  fallback refs, blocked targetless Enter/Space activation when a late modal
  covers the focused control, restricted slow-navigation click recovery to
  link targets, and made Camoufox an explicitly installed optional peer. The
  temporary malformed-action recovery tried in Runs 40-42 is not retained.
- Result: The harness passed 51 tests with 3 optional container skips. Blop
  passed 103 tests with 1 optional container skip, including real-browser
  regressions for rotating opaque refs and late-modal keyboard activation. The
  documentation production build also passed. This was deterministic
  verification only, so no live performance metric is claimed.
- Insight: The final live batch remains representative because these changes
  close adjacent safety, loop-detection, and packaging issues without adding
  task-specific behavior or changing its successful interaction path.

### Runs 53-55: Exact dependency-pin validation — median llm_calls=16 (DISCARD)

- Result: All three runs reached the dedicated weekend page and two were
  error-free. Run 55 synthesized a body-text phrase that was not exact, then
  reused the clicked pre-navigation ref for a focused screenshot. Both actions
  correctly failed, so the repeated zero-error gate rejected the batch.
- Insight: The route was easy and stable, but evidence tools needed the same
  explicit freshness contract as mutating tools. A URL change must make every
  old ref stale, including refs used only for screenshots.

### Runs 56-58: Fresh evidence and action headings — median llm_calls=13 (DISCARD)

- What changed: References now bind to the observed URL, screenshots explicitly
  require a fresh current-page target (or no target), and post-action outcomes
  return a bounded visible-heading summary when page identity changes.
- Result: Again, all outcomes were correct and two runs were clean. Run 58
  twice asserted synthesized text spanning separate block elements. The error
  gate correctly rejected the batch.
- Insight: Rendered `innerText` uses line breaks between semantic blocks while
  compact snapshots use spaces. Normalizing whitespace preserves assertion
  meaning; instructing the agent to copy observed phrases prevents invented
  connective words.

### Runs 59-61: Final exact-code Camoufox batch — median llm_calls=14 (KEEP)

- What changed: Page and targeted text assertions now normalize rendered
  whitespace, visible main-page level-one headings are prioritized in compact
  action outcomes, and the host-neutral Mind2Web prompt requires copied URL,
  title, or visible-text evidence plus fresh refs after navigation.
- Result: Genuine correctness 3/3 and zero-error traces 3/3. Every final
  observation had URL `/en/city/ca/ontario/allenford/weekend`, title `Weekend
  Forecast - The Weather Network`, and visible `Weekend Forecast` plus
  `Allenford, ON` evidence. Median: 14 calls, 417 output tokens, 12 actions, 5
  snapshots, 135,525 total input tokens, 16,304 peak input tokens, and 67.8
  seconds.
- Insight: Versus the original Camoufox baseline, the final exact-code median
  used 39% fewer calls, 59% fewer output tokens, 52% fewer actions, 50% fewer
  snapshots, 46% fewer total input tokens, and 37% less elapsed time while
  moving from 0/3 to 3/3 strict-valid traces.

### Run 62: Final deterministic verification (KEEP)

- Result: The harness build and full suite passed 55 tests with 3 optional
  container skips. Blop passed 104 tests with 1 optional container skip. The
  documentation production build passed and generated all 33 static routes.
- Insight: The retained live result and deterministic regressions now exercise
  the exact final source, including fresh navigation refs, iframe modal key
  guards, strict click timeout evidence, whitespace-normalized assertions, and
  ref-only loop-signature normalization.

### Runs 63-65: Automated strict verdict (DISCARD)

- What changed: The metric now separates agent-reported status from required
  final URL/title/text evidence and recorded errors. `passed=1` requires all
  three, the metrics command exits non-zero otherwise, and the batch verifies
  every worker's strict metric before returning success.
- Result: Runs 63 and 65 were strict-valid. Run 64 reached the correct page but
  invented an absent `textbox/search` target and omitted the required critical
  point id. The new gate rejected the batch instead of accepting CLI status.
- Insight: Host instructions still preferred reconstructed role/name targets
  over the harness's exact refs. Required fields also need to be explicit in
  both schema descriptions and the high-priority host prompt.

### Runs 66-68: Ref-first host contract (DISCARD)

- What changed: Blop now tells the model to copy current opaque refs, forbids
  invented role/name targets and pre-navigation refs, and explicitly requires
  checkpoint id/description/status. Evidence screenshots omit stale targets.
- Result: No malformed target or checkpoint action recurred. Run 66 had one
  consent control disappear before click. Runs 67-68 correctly reached the
  weekend route but lacked the required post-navigation snapshot, so automated
  evidence failed; Run 68 also had the transient consent error.
- Insight: The strict evaluator exposed two remaining lifecycle edges: an
  already-closed observed modal is an idempotent no-op, and final-page evidence
  needs a clearly mandated observation after the last state-changing action.

### Runs 69-71: Final automated-strict Camoufox batch (KEEP)

- What changed: Fallback refs now intersect their original index with a stable
  DOM identity and bind to a main-navigation epoch, so they cannot silently
  retarget after insertions or same-URL reloads. A vanished observed modal
  dismiss control returns an explicit `modalAlreadyClosed` no-op only when no
  visible modal remains. Fill-and-submit rechecks blockers, inert modal
  backgrounds are always suppressed, and the benchmark requires a final
  post-mutation snapshot.
- Result: The batch process exited zero. Agent status 3/3, final evidence 3/3,
  and zero-error traces 3/3. Every final snapshot showed the exact Allenford
  `/weekend` URL, `Weekend Forecast - The Weather Network` title, and visible
  Allenford weekend temperatures/dayparts. Median: 20 calls, 796 output tokens,
  18 actions, 7 snapshots, 191,651 total input tokens, 18,820 peak input tokens,
  and 72.7 seconds.
- Insight: Against the original Camoufox baseline, the exact final source used
  13% fewer calls, 22% fewer output tokens, 28% fewer actions, 30% fewer
  snapshots, 24% fewer total input tokens, and 32% less time. Peak single-call
  input rose 22%, the remaining optimization target. Genuine correctness moved
  from 2/3 to 3/3 and automated strict validity from 0/3 to 3/3.

### Run 72: Final deterministic verification (KEEP)

- Result: The harness passed 61 tests with 3 optional container skips. Blop
  passed 104 tests with 1 optional container skip. The documentation build
  generated all 33 static routes successfully.
- Insight: Deterministic coverage now includes every final audit edge plus the
  strict metric itself, and the live batch exercises the exact retained source.
