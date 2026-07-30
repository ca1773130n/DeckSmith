/**
 * Screenshot every stop of every style, by SEEKING a paused timeline — the same
 * thing `render` does when it captures a frame. Uses the headless Chromium
 * Playwright already put on this machine, driven over CDP directly, because the
 * shared MCP browser is being navigated by two other workflows.
 *
 * Also asserts the things a screenshot cannot show: that seeking backward to a
 * time lands on the same state as arriving at it forward (the property the
 * chained camera `fromTo`s could plausibly break), and that nothing is drawn
 * below the 40px type floor.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "out");
const shots = join(out, "shots");
mkdirSync(shots, { recursive: true });

const SHELL = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const PORT = 9333;
const ORIGIN = `http://127.0.0.1:${process.env.PORT || 8123}`;

const chrome = spawn(
  SHELL,
  [
    `--remote-debugging-port=${PORT}`,
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1920,1080",
    "--force-device-scale-factor=1",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ws() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return (await r.json()).webSocketDebuggerUrl;
    } catch {
      await sleep(200);
    }
  }
  throw new Error("no devtools");
}

const url = await ws();
const { WebSocket } = await import("node:worker_threads").then(() => globalThis);
const sock = new WebSocket(url);
await new Promise((r) => sock.addEventListener("open", r));

let id = 0;
const pending = new Map();
sock.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
function send(method, params = {}, sessionId) {
  const n = ++id;
  return new Promise((r) => {
    pending.set(n, r);
    sock.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
}

const { result: targets } = await send("Target.getTargets");
const page = targets.targetInfos.find((t) => t.type === "page");
const { result: att } = await send("Target.attachToTarget", {
  targetId: page.targetId,
  flatten: true,
});
const S = att.sessionId;
await send("Page.enable", {}, S);
await send("Runtime.enable", {}, S);
await send("Emulation.setDeviceMetricsOverride", {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  mobile: false,
}, S);

async function evaluate(expression) {
  const { result } = await send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    S,
  );
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function goto(u) {
  await send("Page.navigate", { url: u }, S);
  for (let i = 0; i < 80; i++) {
    const ok = await evaluate("!!(window.__timelines && window.__timelines.s1)").catch(() => false);
    if (ok) return;
    await sleep(100);
  }
  throw new Error(`never became ready: ${u}`);
}

async function shot(file) {
  const { result } = await send("Page.captureScreenshot", { format: "png" }, S);
  writeFileSync(file, Buffer.from(result.data, "base64"));
}

const report = [];
for (const name of ["even", "emphatic", "brisk"]) {
  await goto(`${ORIGIN}/out/${name}.html`);
  const holds = await evaluate("window.__holds");

  for (let i = 0; i < holds.length; i++) {
    await evaluate(`window.__seek(${holds[i]})`);
    // 60ms was not enough: two captures of the same seeked frame disagreed on
    // 0.01% of pixels inside the translucent slab overlaps, which is the
    // compositor still catching up rather than anything the timeline did.
    await sleep(220);
    await shot(join(shots, `${name}-hold${i}.png`));
  }

  // A frame mid-move, where the two styles differ most: half way into the step
  // that carries the beat's weight.
  const mid = await evaluate(
    "(function(){var p=window.__plan[3];return (p.start+p.end)/2;})()",
  );
  await evaluate(`window.__seek(${mid})`);
  await sleep(60);
  await shot(join(shots, `${name}-mid.png`));

  // Seek order must not matter. Arrive at each hold forward, record; then walk
  // backward and record again; the two must agree, or navigation would show a
  // different slide depending on which way you came.
  const agree = await evaluate(`(function () {
    function snap() {
      var els = [...document.querySelectorAll('#s1 .lay, #s1 .cap, #s1-note, #s1-cam')];
      return els.map(e => e.id + ':' + getComputedStyle(e).opacity + '|' + getComputedStyle(e).transform).join(';');
    }
    var h = window.__holds, fwd = [], back = [];
    for (var i = 0; i < h.length; i++) { window.__seek(h[i]); fwd.push(snap()); }
    for (var j = h.length - 1; j >= 0; j--) { window.__seek(h[j]); back[j] = snap(); }
    return fwd.every((s, i) => s === back[i]);
  })()`);

  // A stop must be a settled frame. Anything strictly between 0 and 1 at a hold
  // is an element caught half-arrived — the defect `staccato` shipped before the
  // scheduler was made to respect the previous stop.
  const unsettled = await evaluate(`(function () {
    var bad = [];
    window.__holds.forEach(function (h, i) {
      window.__seek(h);
      [...document.querySelectorAll('#s1 .lay, #s1 .cap, #s1-note, #s1-e, #s1-h')].forEach(function (e) {
        var o = parseFloat(getComputedStyle(e).opacity);
        if (o > 0.001 && o < 0.999) bad.push('hold' + i + ' ' + (e.id || e.getAttribute('class')) + '=' + o.toFixed(3));
      });
    });
    return bad;
  })()`);

  const floor = await evaluate(
    "Math.min(...[...document.querySelectorAll('#s1 text, #s1 .headline, #s1 .stnote, #s1 .eyebrow')].map(e => parseFloat(getComputedStyle(e).fontSize)))",
  );
  const camScale = await evaluate(`(function(){
    var m = [], cam = document.querySelector('#s1-cam');
    for (var t = 0; t <= 8; t += 0.5) { window.__seek(t); m.push(getComputedStyle(cam).transform); }
    return [...new Set(m)].length;
  })()`);
  const drift = await evaluate(
    "(window.__seek(99), Math.round((document.querySelector('#s1-stack').getBoundingClientRect().top - document.querySelector('#s1-cam').getBoundingClientRect().top) * 100) / 100)",
  );
  report.push(
    `${name.padEnd(9)} stops=${holds.length} seek-order-independent=${agree} everyStopSettled=${
      unsettled.length === 0
    }${unsettled.length ? ` (${unsettled.join(", ")})` : ""} minFont=${floor}px distinctCamFrames=${camScale} svgTopInView=${drift}px`,
  );
}

console.log(report.join("\n"));
writeFileSync(join(out, "measured.txt"), `${report.join("\n")}\n`);
sock.close();
chrome.kill();
execFileSync("/bin/sh", ["-c", "true"]);
