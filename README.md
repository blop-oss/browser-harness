# @blopai/browser-harness

Playwright browser harness for AI agents.

This package is the **browser side** of agent-driven automation: a fixed set of
controlled native tools, session lifecycle (local launch or Docker Playwright
server), and CDP screencast. It does **not** include an LLM agent loop — that
stays in the host (e.g. the [Blop](https://github.com/n2400813g/blop-app) CLI).

## Install

```bash
npm install @blopai/browser-harness playwright
# or
pnpm add @blopai/browser-harness playwright
# or
bun add @blopai/browser-harness playwright
```

## Quick start

```ts
import { chromium } from "playwright";
import {
  createBrowserTools,
  startScreencast,
  type HarnessAction,
} from "@blopai/browser-harness";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const actions: HarnessAction[] = [];
const finishState = { status: null, reason: null };

const tools = await createBrowserTools({
  page,
  testId: "demo",
  screenshotDir: ".harness-screenshots",
  actions,
  screenshots: [],
  finishState,
});

// Host agent loop: expose tools as OpenAI-style function calls, then:
const goto = tools.find((t) => t.name === "browser_goto")!;
await goto.execute({ url: "https://example.com" });

const finish = tools.find((t) => t.name === "finish_test")!;
await finish.execute({ status: "passed", reason: "Homepage loaded" });

await browser.close();
```

## What you get

| Surface | Purpose |
|--------|---------|
| `createBrowserTools` | ~47 Playwright-backed tools (`browser_goto`, `browser_click`, assertions, extract, batch, lifecycle, …) |
| `NativeToolBridge` | Generic tool shape any agent loop can dispatch |
| `startScreencast` | Chromium CDP live JPEG frames |
| `startPlaywrightContainer` | Shared Docker `playwright run-server` + `chromium.connect` |
| `installBunWsCompat` | Bun WebSocket transport patch for Playwright connect |

## Boundaries

**In this package**

- Browser tools and locators
- Session helpers (local connect / container)
- Screencast observation

**Out of scope (host responsibility)**

- LLM / agent loop and providers
- Test DSL, discovery, reporters, CI orchestration
- Product prompts and platform upload

## Agent adapters and benchmarks

`NativeToolBridge` is the portability boundary for agent hosts. An adapter maps
the tool definitions to its agent SDK and dispatches calls to `execute`. The
harness doesn't depend on a specific model provider or agent runtime.

The live [Mind2Web benchmark](benchmarks/mind2web/README.md) includes an
agent-neutral runner interface and a Blop adapter. The same interface can host
Claude Code, Codex, Ollama, or custom agent adapters.

## Docker session

```ts
import { startPlaywrightContainer } from "@blopai/browser-harness";

const session = await startPlaywrightContainer();
const context = await session.browser.newContext();
const page = await context.newPage();
// ... createBrowserTools({ page, ... })
await session.stop(); // disconnects; container stays warm for reuse
```

Env (optional):

- `BLOP_PLAYWRIGHT_IMAGE` — override Playwright image
- `BLOP_PLAYWRIGHT_CONTAINER` — container name (default `blop-playwright`)
- `BLOP_PLAYWRIGHT_NETWORK` — Docker network mode
- `BLOP_CONTAINER_DISABLE_CORS_BYPASS` — disable CORS-bypass launch args

## Development

```bash
bun install
bun run typecheck
bun run test
bun run build
```

## License

MIT
