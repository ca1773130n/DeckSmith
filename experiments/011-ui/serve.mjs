/**
 * A stand-in for the real DeckSmith server, so the page can be opened, driven
 * and photographed before the server exists.
 *
 * It serves the REAL uiPage() output — no copy, no fixture HTML — and answers
 * the HTTP contract with scripted payloads chosen by ?s=<scenario>. The page's
 * own fetch/EventSource are untouched; everything here is a real request over
 * the wire, which is the only way to find out whether the page's polling,
 * fallback and error paths actually work.
 *
 *   node --import ./register.mjs serve.mjs [port]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { uiPage } from "../../src/server/ui.ts";

const PORT = Number(process.argv[2] || 8791);
const HERE = import.meta.dirname;

const line = (t) => `[${new Date().toISOString().slice(11, 19)}] ${t}`;
const LOG = [
  line("ingest: reading paper.md (18.4 KB)"),
  line("ingest: 6 figures localised, 3 equations, 2 tables"),
  line("ingest: wrote source.json"),
  line("plan: codex cli, schema-constrained, gpt-5.1-codex"),
  line("plan: 12 beats requested, minWeight 0"),
  line("plan: beat 1/12 title — 'Sparse Attention at 1M Tokens'"),
  line("plan: beat 5/12 equation-walk — attention kernel"),
  line("plan: beat 9/12 bar-compare — throughput vs baseline"),
];

const STEP = (name, state, ms, detail) => ({
  name,
  state,
  ...(ms ? { ms } : {}),
  ...(detail ? { detail } : {}),
});

/* The page derives elapsed time from the earliest startedAt the server reports,
   so these must be stamped per request or every screenshot shows a clock that
   has been running since the mock booted. */
function stamp(job) {
  const started = Date.now() - 62_000;
  return { ...job, steps: job.steps.map((s) => ({ ...s, startedAt: started })) };
}

const RESULT_DECK = {
  deckUrl: "/d/demo/deck.html",
  packUrl: "/demo.deck",
  slides: 12,
  duration: 214,
  warnings: [],
};
const RESULT_VIDEO = {
  ...RESULT_DECK,
  videoUrl: "/mock.mp4",
  srtUrl: "/demo.srt",
  warnings: [
    "short-9x16 runs 214s; Facebook Reels stops accepting at 90s.",
    "Beat 7 'annotated-figure' has no alt text — the audience text floor was met by 4px.",
  ],
};

/** One frozen job payload per scenario, so a screenshot is reproducible. */
const SCENES = {
  "run-plan": {
    id: "demo",
    state: "running",
    stage: "plan",
    steps: [
      STEP("ingest", "done", 2410, "6 figures, 3 equations, 2 tables"),
      STEP("plan", "running", 0, "beat 9 of 12 — bar-compare"),
      STEP("narrate", "pending"),
      STEP("build", "pending"),
      STEP("render", "pending"),
    ],
    log: LOG,
  },
  "run-render": {
    id: "demo",
    state: "running",
    stage: "render",
    steps: [
      STEP("ingest", "done", 2410, "6 figures, 3 equations, 2 tables"),
      STEP("plan", "done", 58_900, "12 beats"),
      STEP("narrate", "done", 24_600, "12 segments, 214.2s, en-US-AndrewMultilingualNeural"),
      STEP("build", "done", 7820, "deck-16x9, ink, 12 slides"),
      STEP("render", "running", 0, "frame 1840 of 6426 — 4 workers"),
    ],
    log: LOG.concat([
      line("narrate: 12 segments, 214.2s"),
      line("build: emitted 12 scenes, 41 islands, 0 findings"),
      line("verify: layout ok, motion ok, contrast ok"),
      line("render: 6426 frames at 30fps, 4 workers"),
      line("render: frame 1840/6426 (28%)"),
    ]),
  },
  "done-deck": { id: "demo", state: "done", stage: "build", steps: doneSteps(false), log: LOG, result: RESULT_DECK },
  "done-video": { id: "demo", state: "done", stage: "render", steps: doneSteps(true), log: LOG, result: RESULT_VIDEO },
  "err-plan": {
    id: "demo",
    state: "error",
    stage: "plan",
    steps: [
      STEP("ingest", "done", 2410, "6 figures, 3 equations, 2 tables"),
      STEP("plan", "error", 61_200, "codex exited 1"),
      STEP("narrate", "skipped"),
      STEP("build", "skipped"),
    ],
    log: LOG.concat([line("plan: codex exited with status 1")]),
    error: {
      message: "The planner could not produce a storyboard that matches the schema.",
      hint: "Codex returned a beat with archetype “flowchart”, which is not one of the twelve. Retrying usually fixes it; if it does not, shorten the document or lower the slide count.",
    },
  },
  "err-long": {
    id: "demo",
    state: "error",
    stage: "narrate",
    steps: [
      STEP("ingest", "done", 2100),
      STEP("plan", "done", 57_300),
      STEP("narrate", "error", 3100, "edge-tts: getaddrinfo ENOTFOUND"),
    ],
    log: LOG,
    error: {
      message: "Narration failed: could not reach the speech service.",
      hint: "narrate needs a network connection to Microsoft Edge TTS. Turn narration off to build a silent deck, or try again once you are online.",
    },
  },
};

function doneSteps(video) {
  const s = [
    STEP("ingest", "done", 2410, "6 figures, 3 equations, 2 tables"),
    STEP("plan", "done", 58_900, "12 beats"),
    STEP("narrate", "done", 24_600, "12 segments, 214.2s"),
    STEP("build", "done", 7820, "deck-16x9, ink"),
  ];
  if (video) s.push(STEP("render", "done", 118_400, "6426 frames, 30fps"));
  return s;
}

const FORMATS_JSON = JSON.stringify([
  { id: "deck-16x9", width: 1920, height: 1080, navigable: true },
  { id: "video-16x9", width: 1920, height: 1080, navigable: false },
  { id: "short-9x16", width: 1080, height: 1920, navigable: false },
  { id: "post-1x1", width: 1080, height: 1080, navigable: false },
]);

/* A stand-in deck: the ink palette and a title-archetype silhouette, enough to
   judge how the iframe is framed. */
const DECK_HTML = `<!doctype html><meta charset=utf-8><title>deck</title>
<style>
html,body{margin:0;height:100%;background:#0b0d10;color:#e8eaed;
  font-family:"Inter",system-ui,sans-serif;overflow:hidden}
.s{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:8% 9%}
h1{font-size:6.4vw;line-height:1.05;letter-spacing:-.03em;font-weight:600;margin:0}
p{font-size:2.4vw;color:#9aa7b5;margin:2.2vw 0 0;max-width:70%}
hr{border:0;height:2px;background:#3d8bfd;width:14%;margin:3.4vw 0 0}
small{position:absolute;left:9%;bottom:7%;color:#74808e;font-size:1.5vw;letter-spacing:.1em;text-transform:uppercase}
b{position:absolute;right:9%;bottom:7%;color:#7cc4ff;font-size:1.5vw;font-weight:500}
</style>
<div class=s><h1>Sparse Attention<br>at One Million Tokens</h1>
<p>What the kernel actually skips, and what that costs at the tail.</p><hr>
<small>DeckSmith &middot; slide 1 of 12</small><b>&#9654; press space</b></div>`;

/** Injected into <head> only to preset controls or start a run automatically. */
function driver(scene) {
  return `<script>window.__SCENE=${JSON.stringify(scene || "")};</script>`;
}

let current = "run-plan";

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const send = (code, type, body, extra = {}) => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store", ...extra });
    res.end(body);
  };
  /* The page's own API calls carry no ?s=, so the scene is latched by the last
     page load. One browser at a time; that is all this needs to be. */
  if (url.searchParams.has("s")) current = url.searchParams.get("s");
  const scene = current;

  if (p === "/" || p === "/index.html") {
    const html = uiPage().replace("</head>", `${driver(scene)}</head>`);
    return send(200, "text/html; charset=utf-8", html);
  }
  if (p === "/api/formats") return send(200, "application/json", FORMATS_JSON);
  if (p === "/api/jobs" && req.method === "POST") {
    /* Read the body and print the field names and values. Playwright cannot
       read a multipart body that contains a File, so the only place the wire
       format can actually be checked is here, at the receiver. */
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("latin1");
    const got = {};
    /* Split on the boundary and parse each part separately. A single regex over
       the whole body backtracked across parts and reported the FILE's bytes as
       the value of `format` — one pattern that spans records is not a parser. */
    const boundary = /boundary=(.+)$/.exec(req.headers["content-type"] || "")?.[1];
    if (boundary) {
      for (const part of raw.split(`--${boundary}`)) {
        const split = part.indexOf("\r\n\r\n");
        if (split < 0) continue;
        const head = part.slice(0, split);
        const name = /name="([^"]*)"/.exec(head)?.[1];
        if (!name) continue;
        const filename = /filename="([^"]*)"/.exec(head)?.[1];
        const value = part.slice(split + 4).replace(/\r\n$/, "");
        got[name] = filename ? `<file ${filename} ${value.length}B>` : value;
      }
    }
    console.log("POST /api/jobs fields:", JSON.stringify(got));
    if (scene === "err-upload") {
      return send(500, "application/json", JSON.stringify({
        error: { message: "The document is 42 MB; the limit is 25 MB." },
      }));
    }
    return send(202, "application/json", JSON.stringify({ id: "demo" }));
  }
  if (p.startsWith("/api/jobs/")) {
    if (p.endsWith("/events")) return send(404, "text/plain", "no sse here"); // exercise the fallback
    const job = SCENES[scene] || SCENES["run-plan"];
    return send(200, "application/json", JSON.stringify(stamp(job)));
  }
  if (p === "/d/demo/deck.html") return send(200, "text/html; charset=utf-8", DECK_HTML);
  if (p === "/mock.mp4") {
    const buf = await readFile(`${HERE}/mock.mp4`);
    return send(200, "video/mp4", buf, { "content-length": String(buf.length) });
  }
  if (p === "/demo.srt") return send(200, "application/x-subrip", "1\n00:00:00,000 --> 00:00:04,120\nSparse attention at one million tokens.\n");
  if (p === "/demo.deck") return send(200, "application/octet-stream", "PK (not a real pack)");
  send(404, "text/plain", "not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock decksmith on http://127.0.0.1:${PORT}/  scenes: ${Object.keys(SCENES).join(", ")}, err-upload`);
});
