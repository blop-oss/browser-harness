#!/usr/bin/env node
import { closeSync, openSync, realpathSync } from "node:fs";
import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  daemonIsHealthy,
  errorResponse,
  ensureRuntimeDirectory,
  okResponse,
  pathsForSession,
  readEndpoint,
  removeEndpoint,
  requestDaemon,
  startRpcServer,
  validateSessionName,
  type DaemonEndpoint,
  type RpcMethod,
  type RpcResponse,
  type RpcServer,
} from "./cli/ipc.js";
import {
  createHarnessCliRuntime,
  resolveBrowserExecutable,
  resolveCamoufoxExecutable,
  type BrowserName,
  type HarnessCliRuntime,
} from "./cli/runtime.js";

const HELP = `blop-browser — public CLI for @blopai/browser-harness

Usage:
  blop-browser [--session NAME] [--browser chromium|camoufox] open URL [--json]
  blop-browser [--session NAME] snapshot [--json]
  blop-browser [--session NAME] click REF_OR_TARGET [--json]
  blop-browser [--session NAME] type REF_OR_TARGET TEXT [--submit] [--json]
  blop-browser [--session NAME] expect-text TEXT [--json]
  blop-browser [--session NAME] screenshot [NAME] [--full-page] [--json]
  blop-browser [--session NAME] finish passed|failed REASON [--json]
  blop-browser [--session NAME] call TOOL --input JSON [--json]
  blop-browser [--session NAME] tools [--json]
  blop-browser [--session NAME] describe TOOL [--json]
  blop-browser [--session NAME] status [--json]
  blop-browser [--session NAME] close [--json]
  blop-browser skill show
  blop-browser skill install --target agents|claude|opencode|all [--scope project|user]
  blop-browser install camoufox [--json]
  blop-browser doctor [--json]

Global options:
  --session NAME                 Reuse an isolated persistent session
  --browser chromium|camoufox   Select the browser for a new session
  --json                         Print a machine-readable response envelope

The first tool call starts a persistent local daemon. Later invocations with the
same session name reuse its Playwright browser and semantic element references.
`;

type ParsedArgs = {
  session: string;
  browser: BrowserName;
  json: boolean;
  command: string;
  rest: string[];
};

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (parsed.command === "_daemon") {
    await runDaemon(parsed.session, parsed.browser);
    return;
  }
  if (!parsed.command || parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h") {
    process.stdout.write(HELP);
    return;
  }

  if (parsed.command === "skill") {
    await runSkillCommand(parsed.rest, parsed.json);
    return;
  }

  if (parsed.command === "install") {
    const browser = parsed.rest[0];
    if (browser !== "camoufox") throw new Error("Usage: blop-browser install camoufox");
    const executablePath = await installCamoufox();
    printResponse(okResponse("install", {
      browser,
      installed: true,
      executablePath,
    }), parsed.json);
    return;
  }

  if (parsed.command === "doctor") {
    const [chromiumPath, camoufoxPath] = await Promise.all([
      resolveBrowserExecutable(),
      resolveCamoufoxExecutable(),
    ]);
    const executablePath = parsed.browser === "camoufox" ? camoufoxPath : chromiumPath;
    const endpoint = await readEndpoint(parsed.session);
    const active = Boolean(endpoint && await daemonIsHealthy(endpoint));
    printResponse(okResponse("doctor", {
      browser: {
        name: parsed.browser,
        available: Boolean(executablePath),
        executablePath: executablePath ?? null,
        headless: process.env.BLOP_BROWSER_HEADLESS !== "0",
      },
      browsers: {
        chromium: { available: Boolean(chromiumPath), executablePath: chromiumPath ?? null },
        camoufox: { available: Boolean(camoufoxPath), executablePath: camoufoxPath ?? null },
      },
      daemon: {
        session: parsed.session,
        active,
        pid: active ? endpoint?.pid : null,
      },
      runtimeDirectory: pathsForSession(parsed.session).directory,
    }), parsed.json);
    return;
  }

  let response: RpcResponse;
  if (parsed.command === "status") {
    response = await requestWithoutStarting(parsed.session, "status");
  } else if (parsed.command === "close") {
    response = await requestWithoutStarting(parsed.session, "shutdown");
  } else if (parsed.command === "call") {
    const name = parsed.rest[0];
    if (!name) throw new Error("Usage: blop-browser call TOOL --input JSON");
    const rawInput = optionValue(parsed.rest.slice(1), "--input") ?? "{}";
    const input = parseObject(rawInput, "--input");
    const endpoint = await ensureDaemon(parsed.session, parsed.browser);
    response = await requestDaemon(endpoint, "call_tool", { name, input });
  } else if (parsed.command === "tools") {
    const endpoint = await ensureDaemon(parsed.session, parsed.browser);
    response = await requestDaemon(endpoint, "list_tools");
  } else if (parsed.command === "describe") {
    const name = parsed.rest[0];
    if (!name) throw new Error("Usage: blop-browser describe TOOL");
    const endpoint = await ensureDaemon(parsed.session, parsed.browser);
    response = await requestDaemon(endpoint, "describe_tool", { name });
  } else {
    const shortcut = shortcutCall(parsed.command, parsed.rest);
    if (!shortcut) throw new Error(`Unknown command "${parsed.command}". Run blop-browser --help.`);
    const endpoint = await ensureDaemon(parsed.session, parsed.browser);
    response = await requestDaemon(endpoint, "call_tool", shortcut);
  }
  printResponse(response, parsed.json);
  if (!response.ok) process.exitCode = 1;
}

function shortcutCall(command: string, args: string[]): { name: string; input: Record<string, unknown> } | null {
  if (command === "open") {
    if (!args[0]) throw new Error("Usage: blop-browser open URL");
    return { name: "browser_goto", input: { url: args[0] } };
  }
  if (command === "snapshot") {
    return { name: "browser_snapshot", input: parseOptionalInput(args) };
  }
  if (command === "click") {
    if (!args[0]) throw new Error("Usage: blop-browser click REF_OR_TARGET");
    return { name: "browser_click", input: { target: parseTarget(args[0]) } };
  }
  if (command === "type") {
    if (!args[0] || args[1] === undefined) throw new Error("Usage: blop-browser type REF_OR_TARGET TEXT [--submit]");
    return {
      name: "browser_type",
      input: { target: parseTarget(args[0]), text: args[1], ...(args.includes("--submit") ? { submit: true } : {}) },
    };
  }
  if (command === "expect-text") {
    if (!args[0]) throw new Error("Usage: blop-browser expect-text TEXT");
    return { name: "browser_expect_text", input: { text: args[0] } };
  }
  if (command === "screenshot") {
    const name = args.find((argument) => !argument.startsWith("--"));
    return {
      name: "browser_screenshot",
      input: { ...(name ? { name } : {}), ...(args.includes("--full-page") ? { fullPage: true } : {}) },
    };
  }
  if (command === "finish") {
    const status = args[0];
    const reason = args.slice(1).join(" ");
    if (!status || !reason) throw new Error("Usage: blop-browser finish passed|failed REASON");
    return { name: "finish_test", input: { status, reason } };
  }
  return null;
}

function parseOptionalInput(args: string[]) {
  const raw = optionValue(args, "--input");
  return raw === undefined ? {} : parseObject(raw, "--input");
}

function parseTarget(raw: string): string | Record<string, unknown> {
  if (raw.startsWith("{")) return parseObject(raw, "target");
  if (/^(?:f\d+)?e\d+$|^x\d+$/.test(raw)) return { ref: raw };
  return raw;
}

async function runSkillCommand(args: string[], json: boolean) {
  const action = args[0] ?? "show";
  const source = fileURLToPath(new URL("../skills/browser-harness/SKILL.md", import.meta.url));
  if (action === "show") {
    const skill = await readFile(source, "utf8");
    if (json) printResponse(okResponse("skill", { content: skill }), true);
    else process.stdout.write(skill);
    return;
  }
  if (action !== "install") throw new Error("Usage: blop-browser skill show|install");

  const target = optionValue(args, "--target") ?? "all";
  const scope = optionValue(args, "--scope") ?? "project";
  if (!["agents", "claude", "opencode", "all"].includes(target)) {
    throw new Error("--target must be agents, claude, opencode, or all.");
  }
  if (!["project", "user"].includes(scope)) throw new Error("--scope must be project or user.");
  const force = args.includes("--force");
  const projectDirectory = resolve(optionValue(args, "--project-dir") ?? process.cwd());
  const roots = skillRoots(target, scope, projectDirectory);
  const installed: string[] = [];
  for (const root of roots) {
    const destination = join(root, "browser-harness", "SKILL.md");
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination, force ? 0 : constants.COPYFILE_EXCL);
    installed.push(destination);
  }
  printResponse(okResponse("skill", { installed }), json);
}

function skillRoots(target: string, scope: string, projectDirectory: string) {
  const agents = scope === "user"
    ? join(homedir(), ".agents", "skills")
    : join(projectDirectory, ".agents", "skills");
  const claude = scope === "user"
    ? join(homedir(), ".claude", "skills")
    : join(projectDirectory, ".claude", "skills");
  const opencode = scope === "user"
    ? join(homedir(), ".config", "opencode", "skills")
    : join(projectDirectory, ".opencode", "skills");
  if (target === "claude") return [claude];
  if (target === "agents") return [agents];
  if (target === "opencode") return [opencode];
  // OpenCode also discovers .agents, so "all" avoids installing duplicates.
  return [agents, claude];
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  const session = optionValue(args, "--session") ?? process.env.BLOP_BROWSER_SESSION ?? "default";
  removeOption(args, "--session");
  const browser = parseBrowserName(optionValue(args, "--browser") ?? process.env.BLOP_BROWSER ?? "chromium");
  removeOption(args, "--browser");
  const json = removeFlag(args, "--json");
  validateSessionName(session);
  return { session, browser, json, command: args.shift() ?? "", rest: args };
}

function parseBrowserName(value: string): BrowserName {
  if (value === "chromium" || value === "camoufox") return value;
  throw new Error("--browser must be chromium or camoufox.");
}

function optionValue(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined) throw new Error(`${name} requires a value.`);
  return value;
}

function removeOption(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index >= 0) args.splice(index, 2);
}

function removeFlag(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function parseObject(raw: string, source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${source} must be valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${source} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

async function ensureDaemon(session: string, browser: BrowserName): Promise<DaemonEndpoint> {
  const existing = await readEndpoint(session);
  if (existing && await daemonIsHealthy(existing)) {
    const status = await requestDaemon(existing, "status");
    const activeBrowser = status.ok
      ? String((status.result as Record<string, unknown> | undefined)?.browser ?? "chromium")
      : "chromium";
    if (activeBrowser === browser) return existing;
    throw new Error(
      `Session "${session}" already uses ${activeBrowser}. Close it first or use a different --session before switching to ${browser}.`,
    );
  }
  if (existing) await removeEndpoint(session);

  const paths = pathsForSession(session);
  await ensureRuntimeDirectory(paths.directory);
  let startupDescriptor: number;
  try {
    startupDescriptor = openSync(paths.startup, "wx", 0o600);
    closeSync(startupDescriptor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return await waitForDaemon(session, paths.log);
  }

  try {
    const descriptor = openSync(paths.log, "a", 0o600);
    const { executable, entry } = await daemonEntrypoint(browser);
    const child = spawn(executable, [entry, "--session", session, "--browser", browser, "_daemon"], {
      detached: true,
      env: process.env,
      stdio: ["ignore", descriptor, descriptor],
    });
    child.unref();
    closeSync(descriptor);
    return await waitForDaemon(session, paths.log, child);
  } finally {
    await rm(paths.startup, { force: true });
  }
}

async function daemonEntrypoint(browser: BrowserName) {
  const currentEntry = fileURLToPath(import.meta.url);
  if (browser !== "camoufox" || !process.versions.bun) {
    return { executable: process.execPath, entry: currentEntry };
  }
  const executable = process.env.BLOP_BROWSER_NODE_PATH ?? "node";
  const entry = currentEntry.endsWith(".ts")
    ? resolve(dirname(currentEntry), "../dist/cli.js")
    : currentEntry;
  try {
    await access(entry);
  } catch {
    throw new Error(
      "Camoufox needs the Node.js CLI build when blop-browser is invoked through Bun. Run `bun run build`, then retry.",
    );
  }
  return { executable, entry };
}

async function waitForDaemon(
  session: string,
  logPath: string,
  child?: ReturnType<typeof spawn>,
): Promise<DaemonEndpoint> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const endpoint = await readEndpoint(session);
    if (endpoint && await daemonIsHealthy(endpoint)) return endpoint;
    if (child?.exitCode !== null && child?.exitCode !== undefined) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const log = await readFile(logPath, "utf8").catch(() => "");
  throw new Error(`Browser daemon did not start.${log.trim() ? `\n${log.trim().slice(-2000)}` : ""}`);
}

async function requestWithoutStarting(session: string, method: RpcMethod): Promise<RpcResponse> {
  const endpoint = await readEndpoint(session);
  if (!endpoint || !await daemonIsHealthy(endpoint)) {
    if (endpoint) await removeEndpoint(session);
    return okResponse("offline", method === "status"
      ? { session, active: false }
      : { session, closed: false, active: false });
  }
  return await requestDaemon(endpoint, method);
}

async function runDaemon(session: string, browser: BrowserName) {
  const paths = pathsForSession(session);
  const runtime = await createHarnessCliRuntime(session, paths.artifacts, browser);
  let rpc: RpcServer | undefined;
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await runtime.close();
    await rpc?.close();
  };
  rpc = await startRpcServer(session, async (request) => handleDaemonRequest(request.id, request.method, request.params, runtime, close));

  const idleTimeout = numericEnvironment("BLOP_BROWSER_IDLE_TIMEOUT_MS", 30 * 60_000, 1_000);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void close(), idleTimeout);
    idleTimer.unref();
  };
  rpc.server.on("connection", armIdleTimer);
  armIdleTimer();
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  await new Promise<void>((resolve) => rpc!.server.once("close", resolve));
  if (idleTimer) clearTimeout(idleTimer);
}

async function installCamoufox() {
  const cliPath = process.env.BLOP_BROWSER_CAMOUFOX_CLI_PATH
    ?? fileURLToPath(new URL("./__main__.js", import.meta.resolve("camoufox-js")));
  const nodeExecutable = process.env.BLOP_BROWSER_NODE_PATH ?? (process.versions.bun ? "node" : process.execPath);
  const child = spawn(nodeExecutable, [cliPath, "fetch"], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const forward = (chunk: Buffer) => {
    output = `${output}${chunk}`.slice(-8_000);
    process.stderr.write(chunk);
  };
  child.stdout?.on("data", forward);
  child.stderr?.on("data", forward);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`Camoufox installation failed with exit code ${exitCode}.${output.trim() ? `\n${output.trim()}` : ""}`);
  }
  const executablePath = await resolveCamoufoxExecutable();
  if (!executablePath) throw new Error("Camoufox installation finished, but its browser executable was not found.");
  return executablePath;
}

async function handleDaemonRequest(
  id: string,
  method: RpcMethod,
  params: Record<string, unknown> | undefined,
  runtime: HarnessCliRuntime,
  close: () => Promise<void>,
): Promise<RpcResponse> {
  if (method === "ping") return okResponse(id, { pid: process.pid });
  if (method === "status") return okResponse(id, { active: true, ...await runtime.status() });
  if (method === "list_tools") return okResponse(id, runtime.listTools());
  if (method === "describe_tool") {
    try {
      return okResponse(id, runtime.describeTool(String(params?.name ?? "")));
    } catch (error) {
      return errorResponse(id, "unknown_tool", messageOf(error));
    }
  }
  if (method === "call_tool") {
    try {
      const name = String(params?.name ?? "");
      const input = params?.input;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return errorResponse(id, "invalid_input", "Tool input must be a JSON object.");
      }
      return okResponse(id, await runtime.call(name, input as Record<string, unknown>));
    } catch (error) {
      return errorResponse(id, "tool_error", messageOf(error));
    }
  }
  if (method === "shutdown") {
    const status: Record<string, unknown> = await runtime.status().catch(() => ({}));
    await runtime.close();
    setTimeout(() => void close(), 10).unref();
    return okResponse(id, {
      session: typeof status.session === "string" ? status.session : undefined,
      closed: true,
    });
  }
  return errorResponse(id, "unknown_method", `Unknown daemon method "${method}".`);
}

function numericEnvironment(name: string, fallback: number, minimum: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : fallback;
}

function printResponse(response: RpcResponse, json: boolean) {
  if (json) {
    const { id: _internalRequestId, ...publicResponse } = response;
    process.stdout.write(`${JSON.stringify(publicResponse)}\n`);
    return;
  }
  if (!response.ok) {
    process.stderr.write(`${response.error?.message ?? "Unknown CLI error"}\n`);
    return;
  }
  const result = response.result as { content?: unknown } | undefined;
  if (typeof result?.content === "string") process.stdout.write(`${result.content}\n`);
  else process.stdout.write(`${JSON.stringify(response.result, null, 2)}\n`);
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const entryArgument = process.argv[1];
if (entryArgument && isEntrypoint(entryArgument)) {
  main().catch((error) => {
    const json = process.argv.includes("--json");
    const message = messageOf(error);
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: { code: "cli_error", message } })}\n`);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

function isEntrypoint(entry: string) {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}
