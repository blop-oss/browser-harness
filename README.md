<p align="center">
  <img src="logo.svg" width="120" alt="Browser Harness logo" />
</p>

# Browser Harness

**A persistent browser CLI for AI agents.** Give Codex, Claude Code, OpenCode,
or your own agent a controlled Playwright browser without adopting another
agent framework.

[![npm](https://img.shields.io/npm/v/@blopai/browser-harness)](https://www.npmjs.com/package/@blopai/browser-harness)
[![license](https://img.shields.io/npm/l/@blopai/browser-harness)](LICENSE)

Install the agent skill:

```bash
npx skills add blop-oss/browser-harness --skill browser-harness
```

Add `-g` for a global install or `-a opencode`, `-a claude-code`, or `-a codex` to
target one agent.

<details>
<summary><strong>Install through your agent</strong></summary>

Paste this prompt into your agent (Codex, Claude Code, OpenCode, etc.):

````text
Install the Browser Harness skill and set up the blop-browser CLI:

1. Run: npx skills add blop-oss/browser-harness --skill browser-harness -g
2. Run: npm install --global @blopai/browser-harness
3. Run: blop-browser doctor --json
4. Read the doctor output. If configuration.mode is null, ask me how I want to
   use the browser and then run the matching config command:
   - Headless Chromium (agents/CI): blop-browser config --mode chromium-headless
   - Visible Chromium (local debugging): blop-browser config --mode chromium-headed
   - Existing Chrome over CDP: blop-browser config --mode chrome-cdp --cdp-endpoint http://127.0.0.1:9222
   - Camoufox headless (anti-detect): blop-browser config --mode camoufox-headless
   - Camoufox visible (anti-detect): blop-browser config --mode camoufox-headed
5. Confirm the setup with: blop-browser open https://example.com && blop-browser snapshot
````

</details>

```bash
npm install --global @blopai/browser-harness

blop-browser open https://example.com
blop-browser snapshot
blop-browser expect-text "Example Domain"
blop-browser click e6
blop-browser close
```

The first command starts a local daemon. Every later command in the same
session reuses its browser, cookies, page state, and semantic element
references.

Requires Node.js 20 or newer and Chrome, Chromium, or a Playwright browser. Run
`blop-browser doctor` to check your setup.

## Choose a browser mode

The first interactive browser command opens `blop-browser config` automatically
so you can choose how the harness starts new sessions. You can run the command
again later to change the default. It saves the choice in
`~/.config/blop-browser/config.json` on Linux and macOS, or the application data
directory on Windows.

The installer offers these modes:

- Playwright Chromium, headless for agents and CI.
- Playwright Chromium, visible for local debugging.
- Existing Chrome over CDP to reuse its profile, cookies, and tabs.
- Camoufox, headless for anti-detect automation.
- Camoufox, visible for anti-detect debugging.

For scripts and CI, select a mode without an interactive prompt:

```bash
blop-browser config --mode chromium-headless
blop-browser config --mode chromium-headed
blop-browser config --mode chrome-cdp \
  --cdp-endpoint http://127.0.0.1:9222
blop-browser config --mode camoufox-headless
blop-browser config --mode camoufox-headed
```

Non-interactive agents and CI use headless Chromium when no saved configuration
exists. Run `config --mode ...` during setup to choose another default without a
prompt.

An explicit `--browser`, `--cdp-endpoint`, `--headless`, or `--headed` option
overrides the saved default for a new session. Environment variables continue
to override the saved configuration as well.

## Why Browser Harness

- **Agent-neutral:** use shell commands, stable JSON, or the TypeScript API.
- **Persistent:** keep authenticated browser state across tool calls.
- **Chrome CDP:** attach to an existing Chrome profile and its open tabs.
- **Semantic:** target compact references such as `e1` instead of brittle CSS.
- **Controlled:** expose bounded browser tools, not arbitrary page scripts or
  unrestricted CDP access.
- **Anti-detect option:** switch a session to
  [Camoufox](https://github.com/daijro/camoufox) when Chromium fingerprints are
  a problem.

Your agent loop and model stay in the host. Browser Harness owns browser
transport, session state, and tool execution.

```text
agent -> blop-browser -> Playwright -> Chromium or Camoufox
```

## CLI

Use a named session to isolate concurrent agents or workflows:

```bash
blop-browser --session checkout open https://example.com
blop-browser --session checkout snapshot
blop-browser --session checkout click e6
blop-browser --session checkout screenshot checkout --full-page
blop-browser --session checkout close
```

Use `--json` for machine-readable responses:

```bash
blop-browser --session checkout snapshot --json
```

```json
{"ok":true,"result":{"content":"...","metadata":{}}}
```

The CLI also exposes every native tool through a self-describing interface:

```bash
blop-browser tools
blop-browser describe browser_click
blop-browser call browser_click --input '{"target":{"ref":"e1"}}'
```

Run `blop-browser --help` for the complete command list.

## Connect to Chrome over CDP

Attach to an existing Chrome instance to reuse its profile, cookies, and open
tabs. Start Chrome with remote debugging bound to localhost and a dedicated
profile directory:

```bash
google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/blop-chrome

blop-browser --session chrome --cdp-endpoint http://127.0.0.1:9222 snapshot
blop-browser --session chrome open https://example.com
blop-browser --session chrome close
```

The first command attaches to Chrome's default context and most recently opened
tab. Later commands reuse that connection without repeating `--cdp-endpoint`.
Closing the harness disconnects from Chrome but doesn't close the browser.

Keep the debugging port on localhost. A CDP endpoint grants full control over
that Chrome profile. You can also set `BLOP_BROWSER_CDP_ENDPOINT` instead of
passing the flag.

## Agent skill

The skill install command above uses
[Vercel's skills CLI](https://github.com/vercel-labs/skills). The installer
detects supported agents in the current project automatically.

## Camoufox

[Camoufox](https://github.com/daijro/camoufox) is an optional Firefox-based
browser with native fingerprint protection. Install its browser binary once,
then select it per session:

```bash
blop-browser install camoufox
blop-browser --session research --browser camoufox open https://example.com
```

Camoufox requires Node.js 20 or newer. Chromium remains the default and is the
better choice for deterministic testing of apps you control.

## TypeScript API

Install the package locally to embed the same tools in an agent host:

```bash
npm install @blopai/browser-harness
```

```ts
import { chromium } from "playwright";
import {
  createBrowserTools,
  type HarnessAction,
} from "@blopai/browser-harness";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const actions: HarnessAction[] = [];

const tools = await createBrowserTools({
  page,
  testId: "demo",
  screenshotDir: ".harness-screenshots",
  actions,
  screenshots: [],
  finishState: { status: null, reason: null },
});

const goto = tools.find((tool) => tool.name === "browser_goto")!;
await goto.execute({ url: "https://example.com" });
await browser.close();
```

The public API also includes `NativeToolBridge`, `startScreencast`, structured
target helpers, and Docker-backed Playwright sessions.

<details>
<summary>Configuration</summary>

| Variable | Default | Purpose |
| --- | --- | --- |
| `BLOP_BROWSER_SESSION` | `default` | Session name |
| `BLOP_BROWSER` | `chromium` | `chromium` or `camoufox` |
| `BLOP_BROWSER_HEADLESS` | `1` | Set to `0` for a visible browser |
| `BLOP_BROWSER_CDP_ENDPOINT` | Unset | Existing Chrome CDP URL |
| `BLOP_BROWSER_CONFIG_PATH` | Platform config directory | Saved installer choice |
| `BLOP_BROWSER_EXECUTABLE_PATH` | Auto-detect | Chrome or Chromium path |
| `BLOP_BROWSER_CAMOUFOX_EXECUTABLE_PATH` | Auto-detect | Camoufox path |
| `BLOP_BROWSER_IDLE_TIMEOUT_MS` | `1800000` | Daemon idle timeout |
| `BLOP_BROWSER_RUNTIME_DIR` | `~/.blop-browser` | Private session state |

</details>

## Development

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```

The [Mind2Web benchmark](benchmarks/mind2web/README.md) contains the live,
agent-neutral benchmark runner and host adapter example.

## License

[MIT](LICENSE)
