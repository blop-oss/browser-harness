# Agent instructions (@blopai/browser-harness)

Open-source **Playwright browser harness** for AI agents. Keep this package
focused on controlled browser tools and session transport. Do **not** add an
LLM agent loop, test DSL, reporters, or platform upload here — those belong in
host frameworks (e.g. Blop CLI).

## Layout

```txt
src/
  index.ts              # public exports
  types.ts              # harness-local action/log/artifact types
  create-tools.ts       # createBrowserTools factory
  screencast.ts         # CDP live JPEG screencast
  tools/                # native tool implementations
  session/
    playwright-container.ts
    bun-ws-compat.ts
test/
  browser/              # tool behavior tests (real Playwright)
  session/              # Docker container tests
  fixtures/             # local HTTP fixture server helpers
```

## Design rules

- Tools are the safety boundary: explicit native tools only, no arbitrary
  browser-script or shell escape hatches without review.
- Types are framework-agnostic (`HarnessAction`, not Blop-prefixed).
- Hosts compose: agent loop + prompts + lifecycle policy live outside.
- Prefer fixture servers over external web dependencies in tests.
- Bun for package scripts/tests; Node ≥20 for consumers.

## Verification

```bash
bun install
bun run typecheck
bun run test
bun run build
```

