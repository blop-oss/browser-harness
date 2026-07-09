import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setupToolPage, tool } from "./tool-fixture";
import { createTempDir } from "../fixtures/files.js";

describe("form browser tools", () => {
  test("checks, unchecks, and selects options", async () => {
    const fixture = await setupToolPage(`
      <main>
        <label><input type="checkbox" name="terms" /> Accept terms</label>
        <label>Plan
          <select name="plan">
            <option value="free">Free</option>
            <option value="pro">Pro</option>
          </select>
        </label>
      </main>
    `);

    try {
      await tool(fixture.tools, "browser_check").execute({ target: "Accept terms" });
      expect(await fixture.page.locator("input[name='terms']").isChecked()).toBe(true);

      await tool(fixture.tools, "browser_uncheck").execute({ target: "Accept terms" });
      expect(await fixture.page.locator("input[name='terms']").isChecked()).toBe(false);

      await tool(fixture.tools, "browser_select_option").execute({ target: "Plan", values: "pro" });
      expect(await fixture.page.locator("select[name='plan']").inputValue()).toBe("pro");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("reports when a submit click is silently blocked by required-field validation", async () => {
    const fixture = await setupToolPage(`
      <main>
        <form action="/next" method="post">
          <input type="text" name="name" required placeholder="Name" />
          <input type="email" name="email" required placeholder="Email" />
          <button type="submit">Create account</button>
        </form>
      </main>
    `);

    try {
      // Fill only email, leave the required Name empty, then submit.
      await tool(fixture.tools, "browser_type").execute({ target: "Email", text: "a@b.com" });
      const result = await tool(fixture.tools, "browser_click").execute({ target: "Create account" });

      expect(result.content).toContain("did not submit");
      expect(result.content).toContain("Name");
      expect(result.metadata?.submissionBlocked).toBe(true);
      // The blocked submit must not have navigated away.
      expect(fixture.page.url()).toBe(`${fixture.serverUrl}/`);
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("reports a blocked submit when Enter is pressed in an invalid form", async () => {
    const fixture = await setupToolPage(`
      <main>
        <form action="/next" method="post">
          <input type="text" name="name" required placeholder="Name" />
          <input type="email" name="email" required placeholder="Email" />
          <button type="submit">Sign in</button>
        </form>
      </main>
    `);

    try {
      await tool(fixture.tools, "browser_type").execute({ target: "Name", text: "Blop Tester" });
      // Email still empty; pressing Enter in the name field should be blocked.
      const result = await tool(fixture.tools, "browser_press").execute({ target: "Name", key: "Enter" });

      expect(result.content).toContain("did not submit");
      expect(result.content).toContain("Email");
      expect(result.metadata?.submissionBlocked).toBe(true);
      expect(fixture.page.url()).toBe(`${fixture.serverUrl}/`);
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("does not flag a valid form submit as blocked", async () => {
    const fixture = await setupToolPage(`
      <main>
        <form action="/next" method="post">
          <input type="text" name="name" required placeholder="Name" />
          <button type="submit">Create account</button>
        </form>
      </main>
    `);

    try {
      await tool(fixture.tools, "browser_type").execute({ target: "Name", text: "Blop Tester" });
      const result = await tool(fixture.tools, "browser_click").execute({ target: "Create account" });

      expect(result.content).not.toContain("did not submit");
      expect(result.metadata?.submissionBlocked).toBeUndefined();
      await fixture.page.waitForURL(`${fixture.serverUrl}/next`, { timeout: 5000 });
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("uploads local files into file inputs", async () => {
    const temp = await createTempDir();
    const filePath = join(temp.dir, "hello.txt");
    await writeFile(filePath, "hello upload");
    const fixture = await setupToolPage(`
      <main>
        <label>Upload <input type="file" name="file" /></label>
      </main>
    `);

    try {
      await tool(fixture.tools, "browser_upload_file").execute({ target: "Upload", paths: filePath });
      expect(await fixture.page.locator("input[type='file']").evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe("hello.txt");
    } finally {
      await fixture.cleanup();
      await temp.cleanup();
    }
  }, 15000);
});
