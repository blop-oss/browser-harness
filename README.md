# @blopai/browser-harness

Playwright browser harness for AI agents.

This package is the **browser side** of agent-driven automation: a fixed set of
controlled native tools, session lifecycle (local launch or Docker Playwright
server), and CDP screencast. It does **not** include an LLM agent loop — that
stays in the host (e.g. the [Blop](https://github.com/n2400813g/blop-app) CLI).

## Install

Install the library when embedding the harness in a TypeScript application:

```bash
npm install @blopai/browser-harness playwright
# or
pnpm add @blopai/browser-harness playwright
# or
bun add @blopai/browser-harness playwright
```

Install the public CLI when an agent or application needs a process boundary:

```bash
npm install --global @blopai/browser-harness
blop-browser doctor
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
| `blop-browser` | Persistent, agent-neutral CLI with JSON input and output |
| `createBrowserTools` | Fixed Playwright-backed tools (`browser_goto`, `browser_click`, assertions, extract, batch, lifecycle, …) |
| `NativeToolBridge` | Generic tool shape any agent loop can dispatch |
| `startScreencast` | Chromium CDP live JPEG frames |
| `startPlaywrightContainer` | Shared Docker `playwright run-server` + `chromium.connect` |
| `installBunWsCompat` | Bun WebSocket transport patch for Playwright connect |

## Public CLI

`blop-browser` lets Codex, Claude Code, OpenCode, shell scripts, and other
applications use the same harness without an MCP client. The first browser
command starts a local daemon. Commands using the same session name reuse its
browser context, page state, action trail, and semantic element references.

Use concise commands for common interactions:

```bash
blop-browser --session checkout open https://example.com
blop-browser --session checkout snapshot
blop-browser --session checkout click e1
blop-browser --session checkout type e2 "hello@example.com"
blop-browser --session checkout expect-text "Order confirmed"
blop-browser --session checkout close
```

The generic command exposes the full native tool set. Tool discovery makes
the interface self-describing:

```bash
blop-browser tools
blop-browser describe browser_click
blop-browser call browser_snapshot --input '{}'
blop-browser call browser_click --input '{"target":{"ref":"e1"}}'
```

Pass `--json` to receive a stable envelope suitable for another process:

```json
{"ok":true,"result":{"content":"...","metadata":{}}}
```

Errors use the same shape and a non-zero exit code:

```json
{"ok":false,"error":{"code":"tool_error","message":"..."}}
```

Session names isolate concurrent consumers. A private endpoint file and random
token protect each loopback daemon. The daemon exits after 30 idle minutes by
default, or immediately after `blop-browser close`.

Configuration:

- `BLOP_BROWSER_SESSION` sets the default session name.
- `BLOP_BROWSER` selects `chromium` (the default) or `camoufox`.
- `BLOP_BROWSER_HEADLESS=0` launches a visible browser.
- `BLOP_BROWSER_EXECUTABLE_PATH` selects Chrome or Chromium explicitly.
- `BLOP_BROWSER_CAMOUFOX_EXECUTABLE_PATH` selects a Camoufox executable
  explicitly.
- `BLOP_BROWSER_IDLE_TIMEOUT_MS` changes the daemon idle timeout.
- `BLOP_BROWSER_RUNTIME_DIR` changes the private state directory.

### Camoufox

Camoufox is an optional anti-detect Firefox distribution for sites that reject
automated Chromium traffic. It isn't downloaded during package installation.
It requires Node.js 20 or newer, including when `blop-browser` itself runs under
Bun. Install it explicitly, then select it for a named session:

```bash
blop-browser install camoufox
blop-browser --session google --browser camoufox open https://www.google.com
blop-browser --session google --browser camoufox snapshot
```

Run `blop-browser doctor --json` to inspect Chromium and Camoufox availability.
A session keeps the browser it started with. Close that session before changing
its browser, or use another session name to preserve the original state.

### Agent skill

The package includes one portable skill that teaches coding agents the CLI
workflow and strict semantic-reference rules. The `SKILL.md` file follows the
open [Agent Skills](https://agentskills.io) format used by
[Codex](https://developers.openai.com/codex/skills),
[Claude Code](https://code.claude.com/docs/en/skills),
[OpenCode](https://opencode.ai/docs/skills), Cursor, and 70+ other agents.

#### Install with the blop-browser CLI

The bundled installer copies the skill into a single target directory. Use it
when you already have `@blopai/browser-harness` installed:

```bash
# Codex reads .agents; OpenCode also supports this shared location
blop-browser skill install --target agents

# Claude Code reads .claude/skills
blop-browser skill install --target claude

# OpenCode's native location is .opencode/skills
blop-browser skill install --target opencode

# Install the shared .agents copy and the Claude Code copy
blop-browser skill install --target all
```

Use `--scope user` for a user-level installation, or `skill show` to print the
skill without copying it.

#### Install with `npx skills` (cross-agent)

The open [skills CLI](https://github.com/vercel-labs/skills) discovers and
installs skills across every supported agent from a single command. It
resolves this repo directly from GitHub (default branch) or a local checkout,
so it works without installing the package first.

From a local checkout of this repo (works on any branch):

```bash
# List skills shipped by this repo
npx skills add ./ --list

# Install into a specific agent's project skills directory
npx skills add ./ --skill browser-harness -a opencode
npx skills add ./ --skill browser-harness -a claude-code
npx skills add ./ --skill browser-harness -a cursor

# Install into every detected agent in the current project
npx skills add ./ --skill browser-harness

# Global install (~/.config/opencode/skills/, ~/.claude/skills/, …)
npx skills add ./ --skill browser-harness -g

# Non-interactive (CI/CD friendly)
npx skills add ./ --skill browser-harness -a opencode -y
```

Once the skill lands on the default branch, install directly from GitHub
without a local checkout:

```bash
npx skills add blop-oss/browser-harness --skill browser-harness -a opencode
```

The CLI symlinks each agent's skills directory to a canonical copy by default,
so `npx skills update browser-harness` refreshes every agent at once. Pass
`--copy` for independent copies when symlinks aren't supported.

Install paths by agent and scope:

| Agent | `--agent` | Project | Global (`-g`) |
|-------|-----------|---------|---------------|
| OpenCode | `opencode` | `.agents/skills/` | `~/.config/opencode/skills/` |
| Claude Code | `claude-code` | `.claude/skills/` | `~/.claude/skills/` |
| Codex | `codex` | `.agents/skills/` | `~/.codex/skills/` |
| Cursor | `cursor` | `.agents/skills/` | `~/.cursor/skills/` |
| GitHub Copilot | `github-copilot` | `.agents/skills/` | `~/.copilot/skills/` |

See `npx skills add --help` for the full list of 70+ supported agents.

This public executable is not the private Blop CLI. It owns browser transport,
session state, and native tool dispatch only. Agent loops, model providers,
test discovery, reporting, and platform uploads remain host responsibilities.

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
