import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createTempDir } from "../fixtures/files.js";
import { createBrowserTools, type FinishState } from "../../src/create-tools.js";
import type { HarnessAction } from "../../src/types.js";

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe("agent browser tools", () => {
  test("snapshot returns observable page state for the agent", async () => {
    const temp = await createTempDir();
    cleanup = temp.cleanup;
    const actions: HarnessAction[] = [];
    const screenshots: string[] = [];
    const finishState: FinishState = { status: null, reason: null };
    const page = createFakePage();
    const tools = await createBrowserTools({
      page: page as never,
      testId: "test_1",
      screenshotDir: temp.dir,
      actions,
      screenshots,
      finishState,
    });

    const snapshot = tools.find((tool) => tool.name === "browser_snapshot");
    const result = await snapshot?.execute({});

    expect(result?.content).toContain("Example App");
    expect(result?.content).toContain("Start checkout");
    expect(actions[0].name).toBe("browser_snapshot");
  });

  test("finish_test records agent status and reason", async () => {
    const temp = await createTempDir();
    cleanup = temp.cleanup;
    const actions: HarnessAction[] = [];
    const finishState: FinishState = { status: null, reason: null };
    const tools = await createBrowserTools({
      page: createFakePage() as never,
      testId: "test_1",
      screenshotDir: temp.dir,
      actions,
      screenshots: [],
      finishState,
    });

    const finish = tools.find((tool) => tool.name === "finish_test");
    await finish?.execute({ status: "passed", reason: "The checkout flow completed." });

    expect(finishState.status).toBe("passed");
    expect(finishState.reason).toBe("The checkout flow completed.");
    expect(actions.at(-1)?.name).toBe("finish_test");
  });

  test("screenshot captures evidence path for reports", async () => {
    const temp = await createTempDir();
    cleanup = temp.cleanup;
    const screenshots: string[] = [];
    const tools = await createBrowserTools({
      page: createFakePage() as never,
      testId: "test_1",
      screenshotDir: temp.dir,
      actions: [],
      screenshots,
      finishState: { status: null, reason: null },
    });

    const screenshot = tools.find((tool) => tool.name === "browser_screenshot");
    const result = await screenshot?.execute({ name: "success state" });

    expect(result?.content).toContain("success-state.png");
    expect(screenshots).toHaveLength(1);
    expect(existsSync(screenshots[0])).toBe(true);
  });
});

function createFakePage() {
  return {
    url: () => "http://localhost:3000/checkout",
    title: async () => "Example App",
    locator: () => ({
      innerText: async () => "Example App Start checkout Cart is empty",
    }),
    screenshot: async ({ path }: { path: string }) => {
      await Bun.write(path, "fake-png");
    },
  };
}
