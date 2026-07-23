---
name: browser-harness
description: Controls a persistent Playwright browser through the blop-browser CLI for UI verification, interaction, extraction, and screenshots. Use when a task requires a real browser, rendered page state, authenticated interaction, or deterministic web-app evidence.
license: MIT
compatibility: Requires the blop-browser executable and a local Chrome, Chromium, Playwright, or optional Camoufox browser. Camoufox requires Node.js 20 or newer.
metadata:
  package: "@blopai/browser-harness"
---

# Browser harness

Use `blop-browser` through the shell. The CLI starts a local daemon on the
first tool call and keeps the same browser, tabs, action trail, and semantic
references across later invocations.

## Start here

Use the concise commands for the common path:

```bash
blop-browser open https://example.com
blop-browser snapshot
blop-browser click e1
blop-browser expect-text "Example Domain"
```

Inspect every available tool and retrieve its exact JSON input schema when
the concise commands do not cover the task:

```bash
blop-browser tools
blop-browser describe browser_click
```

Call tools with a JSON object:

```bash
blop-browser call browser_goto --input '{"url":"https://example.com"}'
blop-browser call browser_snapshot --input '{}'
blop-browser call browser_click --input '{"target":{"ref":"e1"}}'
```

Use `--json` when another program needs a stable machine-readable envelope.
Use `--session NAME` on every command when work must be isolated from the
default session.

## Browser choice

Use Chromium by default. Camoufox is an optional third-party anti-detect
Firefox distribution for sites that reject automated Chromium traffic. A
Google page that blocks the default browser or presents repeated bot checks is
one reason to offer it; don't assume Camoufox is required for every Google
task.

Before installing or switching to Camoufox, tell the user that it downloads a
third-party browser and uses a different browser fingerprint. Ask the user if
they want to use it. Don't install or select it without their approval.

After the user approves, check availability and install it when needed:

```bash
blop-browser doctor --json
blop-browser install camoufox
```

Use a separate named session so an active Chromium session keeps its state:

```bash
blop-browser --session google --browser camoufox open https://www.google.com
blop-browser --session google --browser camoufox snapshot
```

Pass `--browser camoufox` on every command that can start the named session.
If the session already uses Chromium, close it deliberately or choose a new
session name. To return to the default browser, omit `--browser` or pass
`--browser chromium`.

## Browser workflow

1. Define the requested outcome and evidence before interacting.
2. Navigate with `browser_goto`.
3. Inspect the current page with `browser_snapshot`.
4. Prefer an opaque current `{ "ref": "e1" }` target. Copy refs exactly.
5. Handle visible dialogs or blockers before acting on occluded controls.
6. Use `browser_extract` for bounded data and `browser_expect_*` for proof.
7. Capture screenshots only when visual evidence adds value.
8. Call `finish_test` only after the requested result is proven.

Do not invent refs, bypass strict ambiguity, execute arbitrary page scripts,
or hide a failed tool call. Take a new snapshot after navigation or substantial
page changes.

## Session lifecycle

Check or stop a session explicitly:

```bash
blop-browser status
blop-browser close
```

The daemon also exits after its idle timeout. Run `blop-browser doctor` when
browser discovery or daemon startup fails. The doctor output reports Chromium
and Camoufox availability separately.
