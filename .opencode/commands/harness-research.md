---
description: Run a staged, long-horizon research program for the browser harness
agent: harness-research-orchestrator
---

Research this browser-harness question for an extended period:

$ARGUMENTS

You are the GPT-5.6 Sol high orchestrator. Conduct the research yourself and
use GPT-5.6 Luna workers only for bounded mechanical tests.

1. Read `AGENTS.md`, `autoresearch.md`, `autoresearch.jsonl`, and
   `experiments/worklog.md` to recover constraints and prior work.
2. Investigate primary external sources, repository behavior, tests, and Git
   history yourself.
3. Define competing hypotheses, metrics, confounders, controls, decision rules,
   and stopping criteria before editing code.
4. Make one narrow change at a time.
5. Split deterministic verification into independent test shards. Launch up to
   three `harness-luna-test-runner` instances in parallel, each with one exact
   command. Run conflicting shards sequentially.
6. Inspect the raw output from every Luna worker and decide what it means. Luna
   workers execute tests; they do not conduct research or approve changes.
7. Run live benchmarks sequentially yourself after deterministic checks pass.
8. Require at least three comparable repetitions for performance claims.
9. Preserve every result and the exact resume point in the existing durable
   autoresearch files. Keep large generated reports and screenshots out of Git.

Do not poll background Luna workers. Continue useful orchestration work until
their completion notifications arrive. Treat context compaction as expected:
durable files, not conversational memory, are the source of truth.
