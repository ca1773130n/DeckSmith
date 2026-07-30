/** Why do two rhythms disagree at the same stop index? Dump the element state. */
import { spawn } from "node:child_process";

const SHELL = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const PORT = 9334;
const chrome = spawn(SHELL, [`--remote-debugging-port=${PORT}`, "--headless", "--disable-gpu", "--window-size=1920,1080", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl;
for (let i = 0; i < 60 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(200); }
}
const sock = new WebSocket(wsUrl);
await new Promise((r) => sock.addEventListener("open", r));
let id = 0; const pending = new Map();
sock.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise((r) => { const n = ++id; pending.set(n, r); sock.send(JSON.stringify({ id: n, method, params, sessionId })); });

const { result: t } = await send("Target.getTargets");
const { result: a } = await send("Target.attachToTarget", { targetId: t.targetInfos.find((x) => x.type === "page").targetId, flatten: true });
const S = a.sessionId;
await send("Page.enable", {}, S);
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, S);
const evaluate = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true }, S)).result.result.value;

const state = {};
for (const name of ["even", "brisk"]) {
  await send("Page.navigate", { url: `http://127.0.0.1:8123/out/${name}.html` }, S);
  for (let i = 0; i < 80; i++) { if (await evaluate("!!(window.__timelines&&window.__timelines.s1)")) break; await sleep(100); }
  state[name] = await evaluate(`(function(){
    var o = {};
    window.__holds.forEach(function (h, i) {
      window.__seek(h);
      o['hold' + i] = [...document.querySelectorAll('#s1 .lay, #s1 .cap, #s1-note')].map(function (e) {
        var s = getComputedStyle(e);
        return (e.id || '?') + ' op=' + s.opacity + ' tr=' + s.transform;
      });
    });
    return o;
  })()`);
}
for (const k of Object.keys(state.even)) {
  const A = state.even[k], B = state.brisk[k];
  A.forEach((line, i) => { if (line !== B[i]) console.log(`${k}: even[${line}]  vs  brisk[${B[i]}]`); });
}
sock.close(); chrome.kill();
