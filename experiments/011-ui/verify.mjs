/**
 * The behaviours a screenshot cannot show: degradation and motion policy.
 *
 * Every optional part of the contract is failed deliberately here, because a
 * page that only works against a complete server is a page that cannot be
 * developed against a half-built one.
 */
async (page) => {
  const BASE = "http://127.0.0.1:8791";
  const DIR = "/Users/neo/Developer/Projects/DeckSmith/experiments/011-ui";
  const ctx = page.context();
  const r = {};

  // 1. /api/formats missing entirely -> the inlined FORMATS table still paints.
  {
    const p = await ctx.newPage();
    await p.route("**/api/formats", (route) => route.abort());
    await p.goto(BASE + "/");
    await p.waitForTimeout(700);
    r.formatsDown = {
      tiles: await p.locator("label.tile").count(),
      note: await p.locator("#fmtnote").textContent(),
      goDisabled: await p.locator("#go").isDisabled(),
    };
    await p.close({ runBeforeUnload: false });
  }

  // 2. SSE 404 (the mock always 404s it) -> polling still drives the job home.
  {
    const p = await ctx.newPage();
    const calls = [];
    p.on("request", (q) => {
      if (q.url().includes("/api/jobs")) calls.push(q.url().replace(BASE, ""));
    });
    await p.goto(BASE + "/?s=done-deck");
    await p.setInputFiles("#fileinput", DIR + "/fixture.md");
    await p.click("#go");
    await p.waitForTimeout(1800);
    r.sseFallback = {
      reachedDone: await p.locator("#v-done").isVisible(),
      sseAttempted: calls.some((c) => c.endsWith("/events")),
      polls: calls.filter((c) => !c.endsWith("/events") && c !== "/api/jobs").length,
      iframeSrc: await p.locator("#d-canvas iframe").getAttribute("src"),
    };
    await p.close({ runBeforeUnload: false });
  }

  // 3. Reduced motion -> the one looping animation stops; transitions collapse.
  {
    const p = await ctx.newPage();
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.goto(BASE + "/?s=run-plan");
    await p.setInputFiles("#fileinput", DIR + "/fixture.md");
    await p.click("#go");
    await p.waitForTimeout(1600);
    r.reducedMotion = await p.evaluate(() => {
      const bead = document.querySelector("li[data-s=running] .bead");
      const after = bead ? getComputedStyle(bead, "::after") : null;
      return {
        beadAnimation: after ? after.animationName + " " + after.animationDuration : "no running step",
        dropTransition: getComputedStyle(document.querySelector(".steps li")).transitionDuration,
      };
    });
    await p.close({ runBeforeUnload: false });
  }

  // 4. A malformed job payload must not white-screen the page.
  {
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.route("**/api/jobs/*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"state":"running"}' }));
    await p.goto(BASE + "/");
    await p.setInputFiles("#fileinput", DIR + "/fixture.md");
    await p.click("#go");
    await p.waitForTimeout(1500);
    r.junkPayload = {
      stillOnRunView: await p.locator("#v-run").isVisible(),
      steps: await p.locator("#r-steps li").count(),
      stage: await p.locator("#r-stage").textContent(),
      pageErrors: errs,
    };
    await p.close({ runBeforeUnload: false });
  }

  // 5. Rejecting a file the pipeline cannot read.
  {
    const p = await ctx.newPage();
    await p.goto(BASE + "/");
    await p.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["x"], "slides.pptx", { type: "application/octet-stream" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true }));
    });
    await p.waitForTimeout(400);
    r.wrongFileType = {
      accepted: await p.locator("#chosen").isVisible(),
      toast: await p.locator("#toast").textContent(),
      goStillDisabled: await p.locator("#go").isDisabled(),
    };
    await p.close({ runBeforeUnload: false });
  }

  /* 6. What actually goes on the wire. The options moved from a hand-written
     FormData to one read off the form, so the fields are read back out of the
     real multipart body rather than trusted. */
  const fields = async (prep) => {
    const p = await ctx.newPage();
    let body = "";
    p.on("request", (q) => {
      if (q.method() === "POST" && q.url().endsWith("/api/jobs")) body = q.postData() || "";
    });
    await p.goto(BASE + "/?s=done-deck");
    await p.setInputFiles("#fileinput", DIR + "/fixture.md");
    if (prep) await prep(p);
    await p.click("#go");
    await p.waitForTimeout(900);
    await p.close({ runBeforeUnload: false });
    const out = {};
    for (const m of body.matchAll(/name="([^"]+)"(?:; filename="([^"]+)")?\r?\n(?:[^\r\n]*\r?\n)*\r?\n([\s\S]*?)\r?\n--/g)) {
      out[m[1]] = m[2] ? "<file " + m[2] + ">" : m[3];
    }
    if (!Object.keys(out).length) out.__rawBodyLength = body.length;
    return out;
  };
  // Only ONE submit button may exist in the form, or Enter fires the wrong one.
  {
    const p = await ctx.newPage();
    await p.goto(BASE + "/");
    await p.setInputFiles("#fileinput", DIR + "/fixture.md");
    r.submitButtons = await p.evaluate(() =>
      [...document.getElementById("compose").elements].filter((e) => e.type === "submit").map((e) => e.id));
    // And the remove button must still remove.
    await p.click("#f-clear");
    await p.waitForTimeout(250);
    r.clearWorks = await p.locator("#pick").isVisible();
    await p.close({ runBeforeUnload: false });
  }
  r.postDefault = await fields();
  r.postCustom = await fields(async (p) => {
    await p.click("details.more summary");
    await p.click("label.tile:has(input[value=custom])");
    await p.fill("#cw", "1440");
    await p.fill("#ch", "1800");
    await p.click("label.chip:has(input[value=mono])");
    await p.click("label.sws:has(#video)");
    await p.click("label.sws:has(#narrate)");
    await p.locator("#slides").fill("22");
    await p.locator("#speed").fill("1.5");
    await p.fill("#voice", "en-GB-RyanNeural");
    await p.selectOption("#lang", "ko");
    await p.click(".seg#tone label:has(input[value=punchy])");
    await p.click(".seg#density label:has(input[value=dense])");
  });

  // 7. Enter in a text field submits, because it is a real form now.
  {
    const p = await ctx.newPage();
    await p.goto(BASE + "/?s=run-plan");
    await p.setInputFiles("#fileinput", DIR + "/fixture.md");
    await p.click("details.more summary");
    await p.click("#voice");
    await p.keyboard.press("Enter");
    await p.waitForTimeout(900);
    r.enterSubmits = await p.locator("#v-run").isVisible();
    await p.close({ runBeforeUnload: false });
  }

  return JSON.stringify(r, null, 1);
}
