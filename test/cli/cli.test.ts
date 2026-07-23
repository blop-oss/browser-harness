import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixtureServer, type FixtureServer } from "../fixtures/server.js";

type CliResult = {
  ok: boolean;
  result?: any;
  error?: { message: string };
};

let server: FixtureServer | undefined;
let runtimeDir: string | undefined;
let session: string | undefined;

afterEach(async () => {
  if (runtimeDir && session) {
    await runCli(["--session", session, "close", "--json"], runtimeDir).catch(() => undefined);
  }
  await server?.close();
  if (runtimeDir) await rm(runtimeDir, { recursive: true, force: true });
  server = undefined;
  runtimeDir = undefined;
  session = undefined;
});

describe("blop-browser CLI", () => {
  test("keeps one browser session across separate CLI invocations", async () => {
    server = await startFixtureServer([
      { path: "/", body: "<main><h1>Persistent browser</h1><button>Continue</button></main>" },
    ]);
    runtimeDir = await mkdtemp(join(tmpdir(), "blop-browser-cli-"));
    session = `test-${process.pid}`;

    const navigation = await runCli([
      "--session",
      session,
      "call",
      "browser_goto",
      "--input",
      JSON.stringify({ url: server.url }),
      "--json",
    ], runtimeDir);
    expect(navigation.ok).toBe(true);
    expect("id" in navigation).toBe(false);
    expect(navigation.result?.content).toContain("Navigated to");

    const snapshot = await runCli([
      "--session",
      session,
      "call",
      "browser_snapshot",
      "--input",
      "{}",
      "--json",
    ], runtimeDir);
    expect(snapshot.ok).toBe(true);
    expect(snapshot.result?.content).toContain("Persistent browser");
    expect(snapshot.result?.content).toContain(server.url);
  }, 30_000);

  test("discovers tool names and schemas without an MCP client", async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "blop-browser-cli-"));
    session = `tools-${process.pid}`;

    const tools = await runCli(["--session", session, "tools", "--json"], runtimeDir);
    expect(tools.ok).toBe(true);
    expect(tools.result).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "browser_goto" }),
      expect.objectContaining({ name: "browser_snapshot" }),
    ]));

    const description = await runCli([
      "--session",
      session,
      "describe",
      "browser_click",
      "--json",
    ], runtimeDir);
    expect(description.ok).toBe(true);
    expect(description.result).toEqual(expect.objectContaining({
      name: "browser_click",
      parameters: expect.objectContaining({ type: "object" }),
    }));
  }, 30_000);

  test("serializes concurrent startup for the same named session", async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "blop-browser-race-"));
    session = `race-${process.pid}`;

    const [tools, description] = await Promise.all([
      runCli(["--session", session, "tools", "--json"], runtimeDir),
      runCli(["--session", session, "describe", "browser_click", "--json"], runtimeDir),
    ]);

    expect(tools.ok).toBe(true);
    expect(description.ok).toBe(true);
    const status = await runCli(["--session", session, "status", "--json"], runtimeDir);
    expect(status.result).toEqual(expect.objectContaining({ active: true, session, browser: "chromium" }));
  }, 30_000);

  test("installs its portable skill without starting a browser daemon", async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "blop-browser-skill-"));
    const projectDirectory = join(runtimeDir, "consumer");

    const installed = await runCli([
      "skill",
      "install",
      "--target",
      "agents",
      "--project-dir",
      projectDirectory,
      "--json",
    ], runtimeDir);
    expect(installed.ok).toBe(true);
    const skillPath = join(projectDirectory, ".agents", "skills", "browser-harness", "SKILL.md");
    const skill = await readFile(skillPath, "utf8");
    expect(skill).toContain("name: browser-harness");
    expect(skill).toContain("blop-browser");
    expect(skill).toContain("install camoufox");
    expect(skill).toContain("Ask the user");

    const opencodeProject = join(runtimeDir, "opencode-consumer");
    const opencode = await runCli([
      "skill",
      "install",
      "--target",
      "opencode",
      "--project-dir",
      opencodeProject,
      "--json",
    ], runtimeDir);
    expect(opencode.ok).toBe(true);
    expect(await readFile(join(
      opencodeProject,
      ".opencode",
      "skills",
      "browser-harness",
      "SKILL.md",
    ), "utf8")).toContain("name: browser-harness");
  });

  test("diagnoses browser availability without starting a session", async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "blop-browser-doctor-"));
    const diagnosis = await runCli(["doctor", "--json"], runtimeDir, {
      BLOP_BROWSER_CAMOUFOX_EXECUTABLE_PATH: join(runtimeDir, "missing-camoufox"),
    });
    expect(diagnosis.ok).toBe(true);
    expect(diagnosis.result).toEqual(expect.objectContaining({
      browser: expect.objectContaining({ name: "chromium", available: true }),
      browsers: expect.objectContaining({
        chromium: expect.objectContaining({ available: true }),
        camoufox: expect.objectContaining({ available: false }),
      }),
      daemon: expect.objectContaining({ active: false }),
    }));
  });

  test("installs Camoufox explicitly and exposes it through doctor", async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "blop-browser-camoufox-"));
    const fakeCli = join(runtimeDir, "camoufox-fetch.mjs");
    const executablePath = join(runtimeDir, "camoufox-bin");
    await writeFile(fakeCli, [
      'import { writeFile } from "node:fs/promises";',
      'await writeFile(process.env.BLOP_BROWSER_CAMOUFOX_EXECUTABLE_PATH, "fake camoufox");',
    ].join("\n"));
    const env = {
      BLOP_BROWSER_CAMOUFOX_CLI_PATH: fakeCli,
      BLOP_BROWSER_CAMOUFOX_EXECUTABLE_PATH: executablePath,
    };

    const installed = await runCli(["install", "camoufox", "--json"], runtimeDir, env);
    expect(installed).toEqual(expect.objectContaining({
      ok: true,
      result: expect.objectContaining({
        browser: "camoufox",
        installed: true,
        executablePath,
      }),
    }));

    const diagnosis = await runCli(["--browser", "camoufox", "doctor", "--json"], runtimeDir, env);
    expect(diagnosis.result).toEqual(expect.objectContaining({
      browser: expect.objectContaining({ name: "camoufox", available: true, executablePath }),
      browsers: expect.objectContaining({
        camoufox: expect.objectContaining({ available: true, executablePath }),
      }),
    }));
  });

  test("runs when a package manager invokes the executable through a symlink", async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "blop-browser-link-"));
    const executable = join(runtimeDir, "blop-browser");
    await symlink(new URL("../../src/cli.ts", import.meta.url).pathname, executable);

    const process = Bun.spawn(["bun", executable, "doctor", "--json"], {
      cwd: new URL("../..", import.meta.url).pathname,
      env: { ...globalThis.process.env, BLOP_BROWSER_RUNTIME_DIR: runtimeDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ ok: true }));
  }, 30_000);

  test("offers concise browser commands while retaining strict snapshot refs", async () => {
    server = await startFixtureServer([
      {
        path: "/",
        body: `<main><h1 id="state">Before</h1><button onclick="document.querySelector('#state').textContent='After'">Continue</button></main>`,
      },
    ]);
    runtimeDir = await mkdtemp(join(tmpdir(), "blop-browser-shortcuts-"));
    session = `shortcuts-${process.pid}`;

    expect((await runCli(["--session", session, "open", server.url, "--json"], runtimeDir)).ok).toBe(true);
    const before = await runCli(["--session", session, "snapshot", "--json"], runtimeDir);
    const observed = JSON.parse(before.result!.content) as { semanticSnapshot: string };
    const ref = observed.semanticSnapshot.match(/\[((?:f\d+)?e\d+|x\d+)\] button "Continue"/)?.[1];
    expect(ref).toBeTruthy();

    expect((await runCli(["--session", session, "click", ref!, "--json"], runtimeDir)).ok).toBe(true);
    const after = await runCli(["--session", session, "snapshot", "--json"], runtimeDir);
    expect(after.result?.content).toContain("After");
  }, 30_000);
});

async function runCli(
  args: string[],
  stateDir: string,
  environment: Record<string, string> = {},
): Promise<CliResult> {
  const process = Bun.spawn(["bun", "src/cli.ts", ...args], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: {
      ...globalThis.process.env,
      BLOP_BROWSER_RUNTIME_DIR: stateDir,
      BLOP_BROWSER_HEADLESS: "1",
      BLOP_BROWSER_IDLE_TIMEOUT_MS: "60000",
      ...environment,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`CLI exited ${exitCode}: ${stderr || stdout}`);
  }
  return JSON.parse(stdout) as CliResult;
}
