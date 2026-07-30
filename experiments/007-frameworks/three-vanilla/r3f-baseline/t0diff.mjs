import pptr from "/Users/neo/Developer/Projects/DeckSmith/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import sharp from "/Users/neo/Developer/Projects/DeckSmith/node_modules/sharp/lib/index.js";
const b = await pptr.launch({ executablePath: "/Users/neo/.cache/puppeteer/chrome/mac_arm-145.0.7632.46/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", headless: true });
async function go(seq) {
  const p = await b.newPage();
  await p.setViewport({ width: 1920, height: 1080 });
  await p.goto("file://" + process.cwd() + "/out/index.html", { waitUntil: "networkidle0" });
  const r = await p.evaluate((seq) => {
    for (const t of seq) window.__timelines.s1.seek(t, true);
    return { url: document.querySelector("#s1 canvas").toDataURL(), s: { a: window.__3d.s1.s.assemble, o: window.__3d.s1.s.orbit, g: window.__3d.s1.s.tag } };
  }, seq);
  await p.close();
  return r;
}
const fresh = await go([0]);
const rewound = await go([6.4, 4.8, 3.2, 1.6, 0]);
console.log("fresh state  ", JSON.stringify(fresh.s));
console.log("rewound state", JSON.stringify(rewound.s));
const [x, y] = await Promise.all([fresh, rewound].map((r) => sharp(Buffer.from(r.url.split(",")[1], "base64")).raw().toBuffer({ resolveWithObject: true })));
let n = 0, max = 0;
for (let i = 0; i < x.data.length; i++) { const d = Math.abs(x.data[i] - y.data[i]); if (d) { n++; max = Math.max(max, d); } }
await sharp(Buffer.from(fresh.url.split(",")[1],"base64")).resize(760).toFile("out/t0-fresh.png");
await sharp(Buffer.from(rewound.url.split(",")[1],"base64")).resize(760).toFile("out/t0-rewound.png");
console.log(JSON.stringify({ channelsDiffering: n, ofTotal: x.data.length, maxDelta: max, pctChannels: +(100 * n / x.data.length).toFixed(3) }));
await b.close();
