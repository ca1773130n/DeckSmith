/**
 * Drive the page through every state and photograph each one. Loaded by the
 * Playwright MCP code runner, which hands it a live `page`.
 *
 * Nothing here fakes a state by poking the DOM: each shot is reached by doing
 * what a person does — drop a file, tick a switch, press the button — against
 * the mock server. A state that can only be reached by cheating has not been
 * tested.
 *
 * Each scene gets its OWN page, closed with runBeforeUnload:false. That is not
 * tidiness: the page guards against navigating away from a live build, and the
 * driver cannot dismiss that dialog, so the only way through is never to
 * trigger it. Edit VIEWPORT / SCHEME / TAG between runs.
 */
async (page) => {
  const BASE = "http://127.0.0.1:8791";
  const DIR = "/Users/neo/Developer/Projects/DeckSmith/experiments/011-ui";
  const OUT = DIR + "/shots";

  const VIEWPORT = { width: 390, height: 900 };
  const SCHEME = "dark";
  const TAG = "m-dark";

  const ctx = page.context();
  const noise = [];
  const done = [];

  async function fresh(url) {
    const p = await ctx.newPage();
    p.on("pageerror", (e) => noise.push("pageerror: " + e));
    p.on("console", (m) => { if (m.type() === "error") noise.push("console: " + m.text()); });
    await p.emulateMedia({ colorScheme: SCHEME });
    await p.setViewportSize(VIEWPORT);
    await p.goto(url);
    await p.waitForTimeout(350);
    return p;
  }
  const shot = (p, n) => p.screenshot({ path: OUT + "/" + TAG + "-" + n + ".png", fullPage: true });
  const bye = (p) => p.close({ runBeforeUnload: false });

  // ---- 01 empty, 02 drag-over, 03 markdown chosen: one page, three moments
  {
    const p = await fresh(BASE + "/");
    await shot(p, "01-empty"); done.push("01");

    await p.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["# hi"], "sparse-attention.md", { type: "text/markdown" }));
      window.__dt = dt;
      window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
      document.getElementById("drop").dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true }));
    });
    await p.waitForTimeout(300);
    await shot(p, "02-dragover"); done.push("02");

    await p.evaluate(() => {
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: window.__dt, bubbles: true }));
    });
    await p.waitForTimeout(300);
    await shot(p, "03-file-md"); done.push("03");
    await bye(p);
  }

  // ---- 04 a zip (the central-directory peek runs for real), 05 options open
  {
    const p = await fresh(BASE + "/");
    await p.setInputFiles("#fileinput", DIR + "/fixture.zip");
    await p.waitForTimeout(600);
    await shot(p, "04-file-zip"); done.push("04");

    // The radios and checkboxes are visually hidden by design — the LABEL is
    // the control, so that is what a person (and this script) clicks.
    await p.click("details.more summary");
    await p.click("label.tile:has(input[value=custom])");
    await p.fill("#cw", "1440");
    await p.fill("#ch", "1800");
    await p.click("label.chip:has(input[value=paper])");
    await p.click("label.sws:has(#video)");
    await p.locator("#slides").fill("22");
    await p.locator("#slides").dispatchEvent("input");
    await p.waitForTimeout(300);
    await shot(p, "05-options-open"); done.push("05");
    await bye(p);
  }

  // ---- 06 keyboard focus ring on the drop zone
  {
    const p = await fresh(BASE + "/");
    await p.keyboard.press("Tab");
    await p.waitForTimeout(250);
    await shot(p, "06-focus"); done.push("06");
    await bye(p);
  }

  // ---- 07..12 progress and terminal states
  const scenes = [
    ["07-run-plan", "run-plan", false],
    ["08-run-render", "run-render", true],
    ["09-done-deck", "done-deck", false],
    ["10-done-video", "done-video", true],
    ["11-err-plan", "err-plan", false],
    ["12-err-upload", "err-upload", false],
  ];
  for (const [n, scene, video] of scenes) {
    const p = await fresh(BASE + "/?s=" + scene);
    await p.setInputFiles("#fileinput", DIR + "/fixture.md");
    if (video) await p.click("label.sws:has(#video)");
    await p.waitForTimeout(200);
    await p.click("#go");
    await p.waitForTimeout(video ? 2400 : 1500);
    await shot(p, n); done.push(n.slice(0, 2));

    // 13: the video tab of the finished job, before this page goes away
    if (scene === "done-video") {
      await p.click("#tab-video");
      await p.waitForTimeout(1400);
      await shot(p, "13-video-tab"); done.push("13");
    }
    await bye(p);
  }

  return TAG + " -> " + done.join(",") + (noise.length ? "  NOISE: " + noise.join(" | ") : "  clean console");
}
