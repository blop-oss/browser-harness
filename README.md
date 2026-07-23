# @blopai/browser-harness

Playwright browser harness for AI agents. Controlled native tools, persistent
sessions, semantic element references, CDP screencast, and built-in anti-detect
via [Camoufox](https://github.com/daijro/camoufox).

This package is the **browser side** of agent-driven automation. It gives a
coding agent a fixed set of safe, observable browser tools — the agent loop,
prompts, and model providers stay in the host (e.g. the
[Blop](https://github.com/n2400813g/blop-app) CLI).

```
  agent decides → blop-browser tool → Playwright → real browser
                                   ↘ Camoufox (anti-detect, when --browser camoufox)
```

## Why

Every browser automation tool for AI agents either locks you into one model
provider or leaks Playwright's `navigator.webdriver` flag, `window.__playwright__`
bindings, and CDP fingerprints. Anti-bot systems detect those signals and block
the session.

`@blopai/browser-harness` solves both problems:

- **Provider-neutral.** The harness exposes a `NativeToolBridge` tool shape any
  agent loop can dispatch. It never imports a model SDK.
- **Anti-detect built in.** One flag (`--browser camoufox`) switches from
  Chromium to [Camoufox](https://github.com/daijro/camoufox) — a Firefox fork
  that intercepts fingerprinting at the C++ level, so Playwright's page agent
  runs in an isolated scope the website cannot see.

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

### Library (TypeScript)

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

### CLI

`blop-browser` lets Codex, Claude Code, OpenCode, shell scripts, and other
applications use the same harness without an MCP client. The first browser
command starts a local daemon. Commands using the same session name reuse its
browser context, page state, action trail, and semantic element references.

```bash
blop-browser --session checkout open https://example.com
blop-browser --session checkout snapshot
blop-browser --session checkout click e1
blop-browser --session checkout type e2 "hello@example.com"
blop-browser --session checkout expect-text "Order confirmed"
blop-browser --session checkout close
```

The generic command exposes the full native tool set. Tool discovery makes the
interface self-describing:

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

## Camoufox: anti-detect browser

Camoufox is an open-source Firefox fork engineered for web scraping and AI
agents. It intercepts fingerprinting calls at the browser's C++ implementation
level — navigator, screen, GPU/WebGL, Canvas, fonts, audio, WebRTC, timezone —
so spoofed properties appear native and cannot be detected through JavaScript
inspection. Playwright's page agent runs in an isolated scope the website
cannot see, eliminating `navigator.webdriver`, `window.__playwright__`, and
CDP-based detection vectors.

When you select `--browser camoufox`, the harness launches Camoufox instead of
Chromium for that session. The full tool set (`browser_click`,
`browser_snapshot`, assertions, extract, batch, …) works identically — the
agent does not know which browser is running.

### Install Camoufox

Camoufox is not downloaded during package installation. Install it explicitly:

```bash
blop-browser install camoufox
```

This downloads the Camoufox browser binary (~100 MB) and fingerprint evasions
to `~/.cache/camoufox/`. Run `blop-browser doctor --json` to verify:

```json
{
  "ok": true,
  "result": {
    "browsers": {
      "chromium": { "available": true, "executablePath": "..." },
      "camoufox": { "available": true, "executablePath": "..." }
    }
  }
}
```

### Use Camoufox for a session

```bash
# Start a Camoufox session and open a bot-protected site
blop-browser --session google --browser camoufox open https://www.google.com
blop-browser --session google --browser camoufox snapshot

# Run headless (default) or with a visible window
BLOP_BROWSER_HEADLESS=0 blop-browser --session debug --browser camoufox open https://example.com
```

Or set the default browser for all sessions:

```bash
export BLOP_BROWSER=camoufox
blop-browser --session checkout open https://protected-site.com
```

### When to use Camoufox vs Chromium

| Scenario | Browser |
|----------|---------|
| Testing your own app | Chromium (faster, native CDP screencast) |
| Public sites with bot detection (Cloudflare, Akamai, reCAPTCHA) | Camoufox |
| Web scraping at scale | Camoufox (fresh fingerprint per session) |
| Cross-origin flows (OAuth redirects, third-party iframes) | Either — Chromium uses `--disable-web-security` in Docker mode |
| CI/CD pipelines, deterministic test suites | Chromium |

### Camoufox requirements

- **Node.js 20+** must be available, even when `blop-browser` runs under Bun.
  Camoufox's `camoufox-js` package spawns a Node subprocess for browser launch.
- **One-time download** (~100 MB) via `blop-browser install camoufox`.
- **Per-session fingerprint**: every Camoufox session gets a distinct
  fingerprint (GPU, audio, fonts, screen, ~400 fields) drawn from
  [BrowserForge](https://github.com/daijro/browserforge) fingerprints that mimic
  the real-world distribution of devices.

### Camoufox configuration

| Environment variable | Purpose |
|---------------------|---------|
| `BLOP_BROWSER=camoufox` | Default browser for all sessions |
| `BLOP_BROWSER_CAMOUFOX_EXECUTABLE_PATH` | Use a specific Camoufox binary |
| `BLOP_BROWSER_CAMOUFOX_CLI_PATH` | Override the `camoufox fetch` CLI path |
| `BLOP_BROWSER_HEADLESS=0` | Launch a visible browser window |

A session keeps the browser it started with. Close that session before
changing its browser, or use another session name to preserve the original
state.

## What you get

| Surface | Purpose |
|--------|---------|
| `blop-browser` CLI | Persistent, agent-neutral CLI with JSON I/O |
| `createBrowserTools` | Fixed Playwright-backed tools (`browser_goto`, `browser_click`, assertions, extract, batch, lifecycle, …) |
| `NativeToolBridge` | Generic tool shape any agent loop can dispatch |
| `startScreencast` | Chromium CDP live JPEG frames |
| `startPlaywrightContainer` | Shared Docker `playwright run-server` + `chromium.connect` |
| Camoufox integration | Anti-detect Firefox via `--browser camoufox` |
| Semantic references | Stable element refs (`e1`, `f2e3`) across snapshots, scoped to the page state that produced them |
| Agent skill | Portable `SKILL.md` for 70+ coding agents |

## Configuration

| Environment variable | Default | Purpose |
|---------------------|---------|---------|
| `BLOP_BROWSER_SESSION` | `default` | Default session name |
| `BLOP_BROWSER` | `chromium` | Browser selection (`chromium` or `camoufox`) |
| `BLOP_BROWSER_HEADLESS` | `1` | Set to `0` for a visible browser |
| `BLOP_BROWSER_EXECUTABLE_PATH` | auto-detect | Chrome/Chromium binary path |
| `BLOP_BROWSER_CAMOUFOX_EXECUTABLE_PATH` | auto-detect | Camoufox binary path |
| `BLOP_BROWSER_IDLE_TIMEOUT_MS` | `1800000` | Daemon idle timeout (30 min) |
| `BLOP_BROWSER_RUNTIME_DIR` | `~/.blop-browser` | Private state directory |
| `BLOP_PLAYWRIGHT_IMAGE` | auto | Docker Playwright image override |
| `BLOP_PLAYWRIGHT_CONTAINER` | `blop-playwright` | Docker container name |
| `BLOP_PLAYWRIGHT_NETWORK` | unset | Docker network mode |
| `BLOP_CONTAINER_DISABLE_CORS_BYPASS` | unset | Disable CORS-bypass launch args |

## Agent skill

The package includes one portable skill that teaches coding agents the CLI
workflow and strict semantic-reference rules. The `SKILL.md` file follows the
open [Agent Skills](https://agentskills.io) format used by
[Codex](https://developers.openai.com/codex/skills),
[Claude Code](https://code.claude.com/docs/en/skills),
[OpenCode](https://opencode.ai/docs/skills), Cursor, and 70+ other agents.

### Install with the blop-browser CLI

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

### Install with `npx skills` (cross-agent)

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

## Boundaries

**In this package**

- Browser tools and locators
- Session helpers (local launch / Docker Playwright server)
- Screencast observation
- Camoufox anti-detect integration

**Out of scope (host responsibility)**

- LLM / agent loop and providers
- Test DSL, discovery, reporters, CI orchestration
- Product prompts and platform upload

This public executable is not the private Blop CLI. It owns browser transport,
session state, and native tool dispatch only. Agent loops, model providers,
test discovery, reporting, and platform uploads remain host responsibilities.

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

The container launches Chromium with `--disable-web-security` so the agent can
exercise cross-origin flows (OAuth redirects, third-party iframes, cross-origin
fetch/XHR) without the sandbox's own origin tripping CORS. Set
`BLOP_CONTAINER_DISABLE_CORS_BYPASS` to disable this.

## Development

```bash
bun install
bun run typecheck
bun run test
bun run build
```

## License

MIT