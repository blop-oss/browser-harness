import { describe, expect, test } from "bun:test";
import { locateReference } from "../../src/tools/references.js";
import { startFixtureServer } from "../fixtures/server.js";
import { setupToolPage, tool } from "./tool-fixture";

describe("structured browser targets", () => {
  test("targets elements by role/name, test id, label, and selector", async () => {
    const fixture = await setupToolPage(`
      <main>
        <button data-testid="save-button" onclick="this.textContent='Saved'">Save</button>
        <label>Email <input name="email" /></label>
        <p id="status-id" class="status">Ready</p>
      </main>
    `);

    try {
      await tool(fixture.tools, "browser_click").execute({ target: { role: "button", name: "Save", exact: true } });
      await tool(fixture.tools, "browser_expect_text").execute({ text: "Saved" });
      await tool(fixture.tools, "browser_type").execute({ target: { label: "Email", exact: true }, text: "ada@example.com" });
      await tool(fixture.tools, "browser_expect_value").execute({ target: { selector: "input[name='email']" }, value: "ada@example.com" });
      const attribute = await tool(fixture.tools, "browser_get_attribute").execute({ target: { testId: "save-button" }, attribute: "data-testid" });
      const text = await tool(fixture.tools, "browser_get_text").execute({ target: { selector: ".status" } });
      const textById = await tool(fixture.tools, "browser_get_text").execute({ target: { id: "status-id" } });

      expect(attribute.content).toBe("save-button");
      expect(text.content).toBe("Ready");
      expect(textById.content).toBe("Ready");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("accepts structured targets serialized by a tool transport", async () => {
    const fixture = await setupToolPage(`
      <button onclick="this.dataset.clicked='true'">Save</button>
    `);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({});
      const snapshot = JSON.parse(result.content) as { semanticSnapshot: string };
      const ref = snapshot.semanticSnapshot.match(/\[((?:f\d+)?e\d+)\] button "Save"/)?.[1];
      expect(ref).toBeDefined();

      await tool(fixture.tools, "browser_click").execute({
        target: JSON.stringify({ ref }),
      });
      expect(await fixture.page.getByRole("button", { name: "Save" }).getAttribute("data-clicked"))
        .toBe("true");

      await fixture.page.getByRole("button", { name: "Save" }).evaluate((element) => {
        delete element.dataset.clicked;
      });
      await tool(fixture.tools, "browser_click").execute({
        target: `{ ref: "${ref}" }`,
      });
      expect(await fixture.page.getByRole("button", { name: "Save" }).getAttribute("data-clicked"))
        .toBe("true");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("accepts text targets serialized with unquoted object keys", async () => {
    const fixture = await setupToolPage(`<button onclick="this.dataset.clicked='true'">Open menu</button>`);

    try {
      await tool(fixture.tools, "browser_click").execute({ target: `{ text: "Open menu" }` });
      expect(await fixture.page.getByRole("button").getAttribute("data-clicked")).toBe("true");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("accepts a bare reference wrapped by a tool transport", async () => {
    const fixture = await setupToolPage(`<button onclick="this.dataset.clicked='true'">Open menu</button>`);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({});
      const snapshot = JSON.parse(result.content) as { semanticSnapshot: string };
      const ref = snapshot.semanticSnapshot.match(/\[((?:f\d+)?e\d+|x\d+)\] button "Open menu"/)?.[1];
      expect(ref).toBeDefined();

      await tool(fixture.tools, "browser_click").execute({ target: `{${ref}}` });
      expect(await fixture.page.getByRole("button").getAttribute("data-clicked")).toBe("true");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("fallback refs distinguish controls with duplicate text by role", async () => {
    const fixture = await setupToolPage(`
      <button role="tab" style="text-transform:uppercase">Create account</button>
      <button type="submit" style="text-transform:uppercase" onclick="this.dataset.clicked='true'">Create account</button>
    `);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({});
      const snapshot = JSON.parse(result.content) as { semanticSnapshot: string };
      const submitRef = snapshot.semanticSnapshot.match(/\[(x\d+)\] button "CREATE ACCOUNT"/)?.[1];
      expect(submitRef).toMatch(/^x\d+$/);

      await tool(fixture.tools, "browser_click").execute({ target: { ref: submitRef } });
      expect(await fixture.page.getByRole("tab").getAttribute("data-clicked")).toBeNull();
      expect(await fixture.page.getByRole("button", { name: "Create account" }).getAttribute("data-clicked"))
        .toBe("true");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("rejects malformed serialized targets instead of parsing them as CSS", async () => {
    const fixture = await setupToolPage(`<button>Save</button>`);

    try {
      await expect(tool(fixture.tools, "browser_click").execute({
        target: '{"unknown":"Save"}',
      })).rejects.toThrow("Invalid serialized browser target");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("exposes modal controls instead of occluded background targets", async () => {
    const fixture = await setupToolPage(`
      <button style="position:fixed;left:100px;top:100px;width:200px;height:60px">Background action</button>
      <div role="dialog" aria-modal="true" aria-label="Consent" style="position:fixed;inset:0;background:white">
        <button style="position:absolute;left:20px;top:20px">Agree and close</button>
      </div>
    `);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({});
      const snapshot = JSON.parse(result.content) as { semanticSnapshot: string };
      expect(snapshot.semanticSnapshot).toContain('button "Agree and close"');
      expect(snapshot.semanticSnapshot).not.toContain("Background action");
      expect(snapshot.semanticSnapshot).not.toContain("[occluded]");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("keeps unobscured page controls visible beside a nonblocking aria-modal banner", async () => {
    const fixture = await setupToolPage(`
      <button style="position:fixed;left:100px;top:100px;width:200px;height:60px">Weekend</button>
      <div role="dialog" aria-modal="true" aria-label="Sign in" style="position:fixed;left:0;right:0;bottom:0;height:100px;background:white">
        <button>Dismiss banner</button>
      </div>
    `);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({});
      const snapshot = JSON.parse(result.content) as { semanticSnapshot: string };
      expect(snapshot.semanticSnapshot).toContain('button "Weekend"');
      expect(snapshot.semanticSnapshot).toContain('button "Dismiss banner"');
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("does not treat a target's shadow host as an occluder", async () => {
    const fixture = await setupToolPage(`
      <reddit-search-large></reddit-search-large>
      <script>
        const root = document.querySelector('reddit-search-large').attachShadow({ mode: 'open' });
        root.innerHTML = '<label>Search <input placeholder="Find anything" /></label>';
      </script>
    `);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({});
      const snapshot = JSON.parse(result.content) as { semanticSnapshot: string };
      const searchLine = snapshot.semanticSnapshot.split("\n")
        .find((line) => line.includes('textbox "Search"'));
      const searchRef = searchLine?.match(/^\[((?:f\d+)?e\d+|x\d+)\]/)?.[1];
      expect(searchLine).not.toContain("occluded");
      expect(searchRef).toBeDefined();

      await tool(fixture.tools, "browser_type").execute({
        target: { ref: searchRef },
        text: "browser harness",
      });
      expect(await fixture.page.locator("input").inputValue()).toBe("browser harness");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("does not suggest controls from an unrelated iframe for a same-page blocker", async () => {
    const fixture = await setupToolPage(`
      <input aria-label="Search" style="position:fixed;left:20px;top:20px;width:200px;height:40px" />
      <div aria-label="Search shell" style="position:fixed;left:20px;top:20px;width:200px;height:40px;z-index:2"></div>
      <iframe srcdoc="<button>Continue with Google</button>" style="position:fixed;right:20px;top:20px"></iframe>
    `);

    try {
      await tool(fixture.tools, "browser_snapshot").execute({});
      const blocked = await tool(fixture.tools, "browser_type").execute({
        target: { role: "textbox", name: "Search" },
        text: "blocked",
      });
      expect(blocked.metadata?.blocked).toBe(true);
      expect(blocked.content).toContain("occluded by Search shell");
      expect(blocked.content).not.toContain("Available frame controls");
      expect(blocked.content).not.toContain("Continue with Google");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("scopes snapshots and preserves actionable shadow-root references", async () => {
    const fixture = await setupToolPage(`
      <button>Outside action</button>
      <section aria-label="Search panel">
        <p>Only scoped guidance</p>
        <search-shell></search-shell>
        <button>Scoped action</button>
        <button>Second scoped action</button>
      </section>
      <script>
        const root = document.querySelector('search-shell').attachShadow({ mode: 'open' });
        root.innerHTML = '<label>Query <input placeholder="Find anything" /></label>';
      </script>
    `);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({
        target: { role: "region", name: "Search panel" },
        maxElements: 2,
      });
      const snapshot = JSON.parse(result.content) as {
        text: string;
        scopeSnapshot: string;
        semanticSnapshot: string;
        omittedInteractiveElements: number;
      };
      expect(snapshot.text).toContain("Only scoped guidance");
      expect(snapshot.text).not.toContain("Outside action");
      expect(snapshot.scopeSnapshot).toContain("Only scoped guidance");
      expect(snapshot.semanticSnapshot).not.toContain("Outside action");
      expect(snapshot.semanticSnapshot.split("\n")).toHaveLength(2);
      expect(snapshot.omittedInteractiveElements).toBe(1);

      const queryRef = snapshot.semanticSnapshot.match(/\[((?:f\d+)?e\d+|x\d+)\] textbox "Query"/)?.[1];
      expect(queryRef).toBeDefined();
      await tool(fixture.tools, "browser_type").execute({
        target: { ref: queryRef },
        text: "browser harness",
      });
      expect(await fixture.page.locator("input").inputValue()).toBe("browser harness");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("exposes and activates controls in a cross-origin child frame", async () => {
    const child = await startFixtureServer([{
      path: "/frame",
      body: `<button onclick="this.dataset.clicked='true'">Cross-origin action</button>`,
    }]);
    const childUrl = child.url.replace("127.0.0.1", "localhost");
    const fixture = await setupToolPage(`<iframe title="Remote controls" src="${childUrl}/frame"></iframe>`);

    try {
      await fixture.page.getByTitle("Remote controls").contentFrame().getByRole("button").waitFor();
      const result = await tool(fixture.tools, "browser_snapshot").execute({});
      const snapshot = JSON.parse(result.content) as { semanticSnapshot: string };
      const frameLine = snapshot.semanticSnapshot.split("\n")
        .find((line) => line.includes('button "Cross-origin action"'));
      const frameRef = frameLine?.match(/^\[((?:f\d+)?e\d+|x\d+)\]/)?.[1];
      expect(frameLine).toContain("frame=");
      expect(frameRef).toBeDefined();

      await tool(fixture.tools, "browser_click").execute({ target: { ref: frameRef } });
      expect(await fixture.page.getByTitle("Remote controls").contentFrame().getByRole("button").getAttribute("data-clicked"))
        .toBe("true");
    } finally {
      await fixture.cleanup();
      await child.close();
    }
  }, 15000);

  test("suppresses inert background controls even without a physical overlay", async () => {
    const fixture = await setupToolPage(`
      <main inert><button>Background action</button></main>
      <section role="dialog" aria-modal="true" aria-label="Consent">
        <button>Agree</button>
      </section>
    `);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({});
      const snapshot = JSON.parse(result.content) as { semanticSnapshot: string };
      expect(snapshot.semanticSnapshot).toContain('button "Agree"');
      expect(snapshot.semanticSnapshot).not.toContain("Background action");

      const blocked = await tool(fixture.tools, "browser_click").execute({
        target: { role: "button", name: "Background action" },
      });
      expect(blocked.metadata?.blocked).toBe(true);
      expect(blocked.content).toContain("Consent");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("blocks stale and structured mutations when a modal appears after observation", async () => {
    const fixture = await setupToolPage(`
      <label>Search <input name="search" onkeydown="if(event.key === 'Enter') this.dataset.activated='true'" /></label>
    `);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({});
      const snapshot = JSON.parse(result.content) as { semanticSnapshot: string };
      const searchRef = snapshot.semanticSnapshot.match(/\[((?:f\d+)?e\d+)\] textbox "Search"/)?.[1];
      expect(searchRef).toMatch(/^e\d+$/);

      await fixture.page.evaluate(() => {
        const overlay = document.createElement("div");
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-label", "Consent");
        overlay.style.cssText = "position:fixed;inset:0;background:white;z-index:1000";
        overlay.innerHTML = "<button>Agree and close</button>";
        document.body.append(overlay);
      });

      const blockedRef = await tool(fixture.tools, "browser_type").execute({
        target: { ref: searchRef },
        text: "blocked",
      });
      const blockedRole = await tool(fixture.tools, "browser_type").execute({
        target: { role: "textbox", name: "Search" },
        text: "blocked",
      });
      expect(blockedRef.content).toContain("occluded by Consent");
      expect(blockedRef.metadata?.blocked).toBe(true);
      expect(blockedRole.content).toContain("occluded by Consent");
      expect(blockedRole.metadata?.blocked).toBe(true);
      await fixture.page.locator("input[name='search']").focus();
      const blockedEnter = await tool(fixture.tools, "browser_press").execute({ key: "Enter" });
      expect(blockedEnter.metadata?.blocked).toBe(true);
      expect(await fixture.page.locator("input[name='search']").inputValue()).toBe("");
      expect(await fixture.page.locator("input[name='search']").getAttribute("data-activated")).toBeNull();
      expect(fixture.actions.slice(-3).every((action) => action.metadata?.error === undefined)).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("treats an already-closed observed modal as an explicit no-op", async () => {
    const fixture = await setupToolPage(`
      <div id="modal" role="dialog" aria-modal="true" aria-label="Consent"
        style="position:fixed;inset:0;background:white;z-index:1000">
        <button aria-label="Agree and close: close consent">Agree and close</button>
      </div>
    `);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({});
      const snapshot = JSON.parse(result.content) as { semanticSnapshot: string };
      const ref = snapshot.semanticSnapshot.match(/\[((?:f\d+)?e\d+|x\d+)\] button "Agree and close: close consent"/)?.[1];
      expect(ref).toBeDefined();
      await fixture.page.locator("#modal").evaluate((element) => element.remove());

      const click = await tool(fixture.tools, "browser_click").execute({ target: { ref } });
      expect(click.metadata?.skipped).toBe(true);
      expect(click.metadata?.modalAlreadyClosed).toBe(true);
      expect(click.content).toContain("no modal remains");
      expect(fixture.actions.at(-1)?.metadata?.error).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("blocks targetless activation behind a child-frame modal", async () => {
    const fixture = await setupToolPage(`
      <iframe title="Widget" srcdoc='
        <button id="background" onclick="this.dataset.activated=&quot;true&quot;">Background action</button>
        <div id="modal" role="dialog" aria-modal="true" aria-label="Frame consent"
          style="position:fixed;inset:0;background:white;z-index:1000">
          <button>Agree</button>
        </div>
      '></iframe>
    `);

    try {
      const child = fixture.page.frames().find((frame) => frame !== fixture.page.mainFrame());
      expect(child).toBeDefined();
      const background = child!.locator("#background");
      await background.focus();

      const result = await tool(fixture.tools, "browser_press").execute({ key: "Space" });
      expect(result.metadata?.blocked).toBe(true);
      expect(result.content).toContain("Frame consent");
      expect(await background.getAttribute("data-activated")).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("allows Playwright to scroll ordinary offscreen targets into view", async () => {
    const fixture = await setupToolPage(`
      <div style="height:1400px"></div>
      <button onclick="this.dataset.clicked='true'">Offscreen action</button>
    `);

    try {
      await tool(fixture.tools, "browser_click").execute({
        target: { role: "button", name: "Offscreen action" },
      });
      expect(await fixture.page.getByRole("button", { name: "Offscreen action" }).getAttribute("data-clicked"))
        .toBe("true");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("structured targets preserve strict matching errors", async () => {
    const fixture = await setupToolPage(`
      <main>
        <button>Duplicate</button>
        <button>Duplicate</button>
      </main>
    `);

    try {
      await expect(tool(fixture.tools, "browser_click").execute({ target: { role: "button", name: "Duplicate" } })).rejects.toThrow("strict mode violation");
      expect(fixture.actions.at(-1)?.metadata?.error).toContain("strict mode violation");
      await tool(fixture.tools, "browser_click").execute({ target: { role: "button", name: "Duplicate", first: true } });
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("keeps exact refs across snapshots and rejects detached elements", async () => {
    const fixture = await setupToolPage(`
      <main>
        <button data-position="first" onclick="this.dataset.clicked='true'">Save</button>
        <button data-position="second" onclick="this.dataset.clicked='true'">Save</button>
      </main>
    `);

    try {
      const first = await tool(fixture.tools, "browser_snapshot").execute({});
      const firstSnapshot = JSON.parse(first.content) as {
        semanticSnapshot: string;
      };
      const saves = [...firstSnapshot.semanticSnapshot.matchAll(/\[((?:f\d+)?e\d+)\] button "Save"/g)];
      const saveRef = saves[1]?.[1];
      expect(saves).toHaveLength(2);
      expect(saveRef).toMatch(/^e\d+$/);

      await tool(fixture.tools, "browser_click").execute({ target: { ref: saveRef } });
      expect(await fixture.page.locator("[data-position='first']").getAttribute("data-clicked")).toBeNull();
      expect(await fixture.page.locator("[data-position='second']").getAttribute("data-clicked")).toBe("true");

      const second = await tool(fixture.tools, "browser_snapshot").execute({});
      const secondSnapshot = JSON.parse(second.content) as { semanticSnapshot: string };
      const secondSaves = [...secondSnapshot.semanticSnapshot.matchAll(/\[((?:f\d+)?e\d+)\] button "Save"/g)];
      expect(secondSaves.map((match) => match[1])).toContain(saveRef);

      await fixture.page.locator("[data-position='second']").evaluate((element) => element.remove());
      await tool(fixture.tools, "browser_snapshot").execute({});
      await expect(tool(fixture.tools, "browser_click").execute({ target: { ref: saveRef } }))
        .rejects.toThrow("Unknown or stale element reference");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("rejects references observed before navigation", async () => {
    const fixture = await setupToolPage(`<a href="/next">Next</a>`);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({});
      const snapshot = JSON.parse(result.content) as { semanticSnapshot: string };
      const ref = snapshot.semanticSnapshot.match(/\[((?:f\d+)?e\d+)\] link "Next"/)?.[1];
      expect(ref).toBeDefined();

      await tool(fixture.tools, "browser_goto").execute({ url: `${fixture.serverUrl}/next` });
      await expect(tool(fixture.tools, "browser_click").execute({ target: { ref } }))
        .rejects.toThrow("Unknown or stale element reference");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("rejects references hidden by a same-page UI update", async () => {
    const fixture = await setupToolPage(`<button>Sign in</button>`);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({});
      const snapshot = JSON.parse(result.content) as { semanticSnapshot: string };
      const ref = snapshot.semanticSnapshot.match(/\[((?:f\d+)?e\d+|x\d+)\] button "Sign in"/)?.[1];
      expect(ref).toBeDefined();

      await fixture.page.locator("button").evaluate((element) => {
        element.style.display = "none";
      });
      await expect(tool(fixture.tools, "browser_click").execute({ target: { ref } }))
        .rejects.toThrow("Unknown or stale element reference");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("rejects fallback references after a same-URL reload", async () => {
    const fixture = await setupToolPage(`<div tabindex="0">Fallback action</div>`);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({});
      const snapshot = JSON.parse(result.content) as { semanticSnapshot: string };
      const ref = snapshot.semanticSnapshot.match(/\[(x\d+)\] interactive "Fallback action"/)?.[1];
      expect(ref).toMatch(/^x\d+$/);

      await tool(fixture.tools, "browser_reload").execute({});
      await expect(tool(fixture.tools, "browser_focus").execute({ target: { ref } }))
        .rejects.toThrow("Unknown or stale element reference");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("fallback references cannot retarget after same-document insertion", async () => {
    const fixture = await setupToolPage(`
      <div tabindex="0" data-testid="original-fallback">Fallback action</div>
    `);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({});
      const snapshot = JSON.parse(result.content) as { semanticSnapshot: string };
      const ref = snapshot.semanticSnapshot.match(/\[(x\d+)\] interactive "Fallback action"/)?.[1];
      expect(ref).toMatch(/^x\d+$/);

      await fixture.page.evaluate(() => {
        const inserted = document.createElement("div");
        inserted.tabIndex = 0;
        inserted.textContent = "Inserted action";
        document.body.prepend(inserted);
      });

      expect(await locateReference(fixture.page, ref!).count()).toBe(0);
      expect(await fixture.page.getByTestId("original-fallback").getAttribute("data-focused")).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("keeps a reference on the same element when controls are inserted", async () => {
    const fixture = await setupToolPage(`
      <main>
        <label>Search <input name="search" /></label>
      </main>
    `);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({ includeAria: true });
      const snapshot = JSON.parse(result.content) as {
        semanticSnapshot: string;
        actionTargets: Array<{ target: { ref: string }; role: string; name: string }>;
      };
      const searchRef = snapshot.semanticSnapshot.match(/\[((?:f\d+)?e\d+)\] textbox "Search"/)?.[1];
      expect(searchRef).toMatch(/^e\d+$/);
      expect(snapshot.actionTargets).toContainEqual(expect.objectContaining({
        target: { ref: searchRef },
        role: "textbox",
        name: "Search",
      }));

      await fixture.page.evaluate(() => {
        const injected = document.createElement("button");
        injected.textContent = "Inserted after snapshot";
        document.body.prepend(injected);
      });
      await tool(fixture.tools, "browser_type").execute({
        target: { ref: searchRef },
        text: "Allenford",
      });

      expect(await fixture.page.locator("input[name='search']").inputValue()).toBe("Allenford");
      expect(await fixture.page.getByRole("button", { name: "Inserted after snapshot" }).innerText())
        .toBe("Inserted after snapshot");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);

  test("keeps duplicate child-frame references scoped to their owning frame", async () => {
    const fixture = await setupToolPage(`
      <main>
        <iframe srcdoc="<form aria-label='first'><button type='button' id='first-target' onclick='this.dataset.clicked=1'>Continue</button></form>"></iframe>
        <iframe srcdoc="<form aria-label='second'><button type='button' id='second-target' onclick='this.dataset.clicked=1'>Continue</button></form>"></iframe>
      </main>
    `);

    try {
      const result = await tool(fixture.tools, "browser_snapshot").execute({});
      const snapshot = JSON.parse(result.content) as { semanticSnapshot: string };
      const secondLine = snapshot.semanticSnapshot.split("\n")
        .find((line) => line.includes('button "Continue"') && line.includes('region="form:second"'));
      const secondRef = secondLine?.match(/^\[((?:f\d+)?e\d+)\]/)?.[1];
      expect(secondRef).toMatch(/^f\d+e\d+$/);

      const frameCandidates = await Promise.all(fixture.page.frames().map(async (frame) => ({
        frame,
        hasSecondTarget: await frame.locator("#second-target").count() > 0,
      })));
      const secondFrame = frameCandidates.find((candidate) => candidate.hasSecondTarget)?.frame;
      expect(secondFrame).toBeDefined();
      await secondFrame?.evaluate(() => {
        const inserted = document.createElement("button");
        inserted.id = "inserted-after-snapshot";
        inserted.textContent = "Inserted after snapshot";
        document.body.prepend(inserted);
      });
      await tool(fixture.tools, "browser_click").execute({ target: { ref: secondRef } });

      expect(await secondFrame?.locator("#second-target").getAttribute("data-clicked")).toBe("1");
      expect(await secondFrame?.locator("#inserted-after-snapshot").getAttribute("data-clicked")).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  }, 15000);
});
