// Turn the linear ThinkSR composition into a navigable deck: give every scene a
// data-composition-id + data-label, and add the slideshow manifest island.
// Fragments are the GSAP beats where a presenter should hold — i.e. exactly the
// "steps" the DeckSmith design calls beats.
import { readFile, writeFile } from "node:fs/promises";

const P = "hf-thinksr/index.html";
let html = await readFile(P, "utf8");

const LABELS = {
  s1: "타이틀",
  s2: "문제 정의",
  s3: "Persistent dense carrier",
  s4: "Thought ↔ carrier",
  s5: "전체 구조",
  s6: "정량 비교",
  s7: "Thought sweep",
  s8: "수치 불일치",
};

for (const [id, label] of Object.entries(LABELS)) {
  const re = new RegExp(`(<div class="clip scene" id="${id}")`);
  if (!re.test(html)) throw new Error(`scene ${id} not found`);
  html = html.replace(re, `$1 data-composition-id="${id}" data-label="${label}"`);
}

// hold-points per slide, in absolute seconds, taken from the GSAP beats
const manifest = {
  slides: [
    { sceneId: "s1", notes: "제목만 읽고 넘어간다. 논문 이름과 약어를 한 번씩." },
    { sceneId: "s2", notes: "핵심 대립을 먼저 말한다 — 생각은 압축, 출력은 조밀.", fragments: [7.0, 7.7] },
    { sceneId: "s3", notes: "pooling을 안 한다는 점이 전부다.", fragments: [16.0, 17.9] },
    { sceneId: "s4", notes: "읽기(T)와 갱신(U)을 분리해서 설명. token 수 보존이 요점.", fragments: [22.8, 25.7] },
    { sceneId: "s5", notes: "tick 간 parameter 공유를 강조." },
    { sceneId: "s6", notes: "여기서 과장하지 말 것. CNN과 대등, 최신 모델에는 뒤진다.", fragments: [39.9, 41.1, 42.2] },
    { sceneId: "s7", notes: "diminishing return이 핵심. T>4는 검증 안 됨.", fragments: [48.6, 50.3] },
    { sceneId: "s8", notes: "논문을 읽을 사람에게 반드시 알려야 할 부분.", fragments: [57.6] },
  ],
  slideSequences: [],
};

const island =
  `    <script type="application/hyperframes-slideshow+json">\n` +
  JSON.stringify(manifest, null, 2).replace(/^/gm, "      ") +
  `\n    </script>\n`;

html = html.replace(/(\n\s*<div\n\s+id="root")/, `\n${island}$1`);
await writeFile(P, html);
console.log(`island added: ${manifest.slides.length} slides, ` +
  `${manifest.slides.reduce((n, s) => n + (s.fragments?.length ?? 0), 0)} fragments`);
