import { describe, expect, test } from "bun:test";
import { locateReference } from "../../src/tools/references.js";
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
