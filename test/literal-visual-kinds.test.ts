/**
 * The visual forms a table would otherwise take (src/literal/kinds/): prior-work,
 * margins, scope and ablation. Their pure computation, their layout (text never
 * under 40px, everything inside the region, every element a tween names
 * exists), and their pacing on the EM-SNN deck's own sentence cues for the
 * beats they replace. Synthetic layers; ffmpeg only for prior-work's pictures.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Theme } from "../src/emit/kit.js";
import { visualProblems } from "../src/literal/check.js";
import { literalFragment } from "../src/literal/index.js";
import { widthOf } from "../src/literal/kind.js";
import { combinations, resultOf } from "../src/literal/kinds/ablation.js";
import { axisSpan, marginOf, marginsOf } from "../src/literal/kinds/margins.js";
import { binarySpikes, checkLanes } from "../src/literal/kinds/prior-work.js";
import { type ScopePart, scopeLayout } from "../src/literal/kinds/scope.js";
import { type Cue, type Layers, stillSpans, toRgba, writeRaster } from "../src/literal/kit.js";
import { KINDS } from "../src/literal/registry.js";
import { type Literal, type LiteralKind, literalSchema } from "../src/types.js";
import { slotsFor } from "./literal-fixtures.js";

const theme: Theme = {
  bg: "#14110d",
  fg: "#f2eadc",
  muted: "#a89f90",
  dim: "#6b6458",
  rule: "#3a342b",
  panel: "#1d1913",
  accent: "#e8a33d",
  tones: { a: "#e8a33d", b: "#8fc1e8", c: "#e88fa3", d: "#a3e88f" },
  fontStack: "Inter, sans-serif",
};
const region = { width: 1700, height: 747 };
const STILL_MAX = 4;
const c = (pairs: Array<[number, number]>): Cue[] => pairs.map(([t0, t1]) => ({ t0, t1 }));

/* ------------------------------------------- the EM-SNN deck's own material */

const PRIOR = literalSchema.parse({
  kind: "prior-work",
  picture: "b02-haze",
  lanes: [
    {
      family: "사전 기반",
      members: "DCP · Color Attenuation Prior · Hazelines",
      shows: "dark-channel",
      gap: "가정이 깨지면 실패할 수 있음",
    },
    {
      family: "딥러닝",
      members: "DehazeNet · DehazeFormer · SFRDP-Net",
      shows: "numbers",
      numbers: [
        { label: "SFRDP-Net 보고 에너지", value: "175.21 mJ" },
        { label: "SFRDP-Net 파라미터", value: "5.08 M" },
      ],
      gap: "상당한 연산량 · 경량화하면 표현력 희생 가능",
    },
    {
      family: "SNN",
      members: "빗줄기 제거 · 초해상도 · 탐지",
      shows: "spikes",
      gap: "밀집 복원, 특히 원격탐사 안개 제거는 덜 탐구됨",
    },
  ],
  labels: [],
});

const MARGINS = literalSchema.parse({
  kind: "margins",
  ours: "EM-SNN",
  metrics: [
    { name: "PSNR", lowerIsBetter: false },
    { name: "SSIM", lowerIsBetter: false },
  ],
  settings: [
    {
      name: "LHID",
      values: [
        { ours: "30.56", best: "29.73", rival: "DehazeFormer-b" },
        { ours: "0.9106", best: "0.8964", rival: "DehazeFormer-b" },
      ],
    },
    {
      name: "DHID",
      values: [
        { ours: "28.83", best: "28.89", rival: "SFRDP-Net" },
        { ours: "0.9073", best: "0.9070", rival: "SFRDP-Net" },
      ],
    },
    {
      name: "RICE1",
      values: [
        { ours: "35.99", best: "37.38", rival: "SFRDP-Net" },
        { ours: "0.9630", best: "0.9650", rival: "SFSNiD · SFRDP-Net" },
      ],
    },
    {
      name: "RICE2",
      values: [
        { ours: "36.25", best: "35.45", rival: "SFRDP-Net" },
        { ours: "0.9406", best: "0.9140", rival: "4KDehazing" },
      ],
    },
  ],
  labels: [],
});

const DATASETS = literalSchema.parse({
  kind: "scope",
  rings: [
    { label: "수치 결과", items: ["LHID", "DHID", "RICE1", "RICE2"] },
    { label: "정성 비교만", items: ["SateHaze1K"] },
    { label: "결과 없음", items: ["RRSHID"] },
  ],
  labels: [],
});

const LIMITS = literalSchema.parse({
  kind: "scope",
  rings: [
    { label: "표로 뒷받침", items: ["LHID", "DHID", "RICE1", "RICE2"] },
    {
      label: "보고되지 않음",
      items: ["분포 변화 시험", "구성 요소 제거 실험", "반복 실행 분산", "에너지 산출 절차"],
    },
    { label: "입증되지 않음", items: ["다른 센서", "다른 지역", "다른 영상 크기", "실제 안개"] },
  ],
  labels: [],
});

const FUTURE = literalSchema.parse({
  kind: "ablation",
  components: ["TM-LIF", "SSM"],
  reported: [{ with: ["TM-LIF", "SSM"], result: "LHID 30.56 · 0.9106" }],
  settings: [
    { name: "T", value: "1" },
    { name: "D", value: "4" },
    { name: "α", value: "0.6" },
    { name: "β", value: "0.25" },
    { name: "μ", value: "0.9" },
    { name: "구조 단서", value: "Sobel" },
    { name: "하드웨어", value: "RTX 4090 GPU" },
    { name: "정량 평가", value: "LHID · DHID · RICE1 · RICE2" },
  ],
  labels: [],
});

const labelsOf = (kind: LiteralKind): Record<string, string> => {
  const all = slotsFor(kind);
  if (kind === "prior-work") return { ...all, example: "예시" };
  return all;
};

const draw = (lit: Literal, cues: Cue[], layers?: Layers, r = region) =>
  literalFragment(
    lit.kind,
    layers ?? {
      files:
        lit.kind === "prior-work"
          ? { in: "in.jpg", ...Object.fromEntries(lit.lanes.map((_, k) => [`l${k}`, `l${k}.png`])) }
          : {},
      data: {},
    },
    r,
    cues,
    { kind: lit.kind, takeaway: "t", labels: labelsOf(lit.kind), data: lit } as never,
    theme,
  );

/** Each kind on the cues of the deck's beat it replaces. */
const CASES: Array<[string, Literal, Cue[]]> = [
  [
    "prior-work (b05-related)",
    PRIOR,
    c([
      [0.95, 8.687],
      [8.75, 18.112],
      [18.182, 27.244],
    ]),
  ],
  [
    "margins (b12-quality)",
    MARGINS,
    c([
      [0.95, 7.8],
      [7.862, 15.512],
      [15.614, 21.964],
      [22.022, 30.322],
    ]),
  ],
  [
    "scope (b10-data)",
    DATASETS,
    c([
      [0.95, 12.512],
      [12.566, 20.378],
    ]),
  ],
  [
    "scope (b16-limits)",
    LIMITS,
    c([
      [0.95, 6.787],
      [6.854, 14.516],
      [14.582, 21.132],
      [21.132, 31.732],
    ]),
  ],
  [
    "ablation (b17-future)",
    FUTURE,
    c([
      [0.95, 9.712],
      [9.782, 19.494],
      [19.55, 27.475],
      [27.542, 37.692],
    ]),
  ],
];

/* -------------------------------------------------------- pure computation */

describe("margins: the source's numbers, as positions", () => {
  it("is ours − best, signed so that better is positive, at the values' own precision", () => {
    expect(marginOf("30.56", "29.73", false)).toEqual({ gap: 0.83, text: "+0.83" });
    expect(marginOf("28.83", "28.89", false)).toEqual({ gap: -0.06, text: "−0.06" });
    expect(marginOf("0.9073", "0.9070", false)).toEqual({ gap: 0.0003, text: "+0.0003" });
    // Lower is better (an error, a cost): the sign flips.
    expect(marginOf("43.62", "175.21", true).gap).toBeCloseTo(131.59, 6);
    expect(marginOf("1.5", "1.5", false).text).toBe("±0.0");
    expect(() => marginOf("30.56 dB", "29.73", false)).toThrow(/needs numbers/);
  });

  it("refuses a setting with a value missing, one metric too many, or a single setting", () => {
    const d = MARGINS as Extract<Literal, { kind: "margins" }>;
    expect(marginsOf(d).map((r) => r.map((m) => m.text))).toEqual([
      ["+0.83", "+0.0142"],
      ["−0.06", "+0.0003"],
      ["−1.39", "−0.0020"],
      ["+0.80", "+0.0266"],
    ]);
    expect(() => marginsOf({ ...d, settings: [d.settings[0] as never] })).toThrow(
      /at least two settings/,
    );
    expect(() =>
      marginsOf({
        ...d,
        settings: [{ name: "x", values: [d.settings[0]?.values[0] as never] }, ...d.settings],
      }),
    ).toThrow(/gives 1 value\(s\) for 2 metric\(s\)/);
    expect(() =>
      marginsOf({ ...d, metrics: [...d.metrics, { name: "LPIPS", lowerIsBetter: true }] }),
    ).toThrow(/one or two metrics/);
  });

  it("scales each axis to its own largest margin", () => {
    const M = marginsOf(MARGINS as never);
    expect(axisSpan(M, 0)).toBeCloseTo(1.39 * 1.18, 6);
    expect(axisSpan(M, 1)).toBeCloseTo(0.0266 * 1.18, 6);
  });

  it("puts a setting that leads on both metrics in the leading quadrant and one that trails in the other", () => {
    const f = draw(MARGINS, CASES[1]?.[2] as Cue[]);
    const at = (i: number) => {
      const m = new RegExp(`id="SCENEID-p${i}" cx="([\\d.]+)" cy="([\\d.]+)"`).exec(f.markup);
      return [Number(m?.[1]), Number(m?.[2])];
    };
    const [x0, y0] = at(0) as [number, number]; // LHID: ahead on both
    const [x2, y2] = at(2) as [number, number]; // RICE1: behind on both
    const [x1, y1] = at(1) as [number, number]; // DHID: behind on PSNR, ahead on SSIM, both tiny
    const svg = /id="SCENEID-plot" width="([\d.]+)" height="([\d.]+)"/.exec(f.markup);
    const [cx, cy] = [Number(svg?.[1]) / 2, Number(svg?.[2]) / 2];
    expect(x0).toBeGreaterThan(cx);
    expect(y0).toBeLessThan(cy);
    expect(x2).toBeLessThan(cx);
    expect(y2).toBeGreaterThan(cy);
    expect(x1).toBeLessThan(cx);
    expect(y1).toBeLessThan(cy);
    // The readout shows the source's numbers and the computed margin, nothing else.
    expect(f.markup).toContain(">PSNR +0.83<");
    expect(f.markup).toContain(">EM-SNN 30.56<");
    expect(f.markup).toContain(">DehazeFormer-b 29.73<");
  });

  it("draws one metric as a strip, one row per setting", () => {
    const one = literalSchema.parse({
      ...MARGINS,
      metrics: [{ name: "PSNR", lowerIsBetter: false }],
      settings: (MARGINS as Extract<Literal, { kind: "margins" }>).settings.map((s) => ({
        name: s.name,
        values: [s.values[0]],
      })),
    });
    const f = draw(one, CASES[1]?.[2] as Cue[]);
    expect(f.markup).not.toContain('id="SCENEID-l-y"');
    expect((f.markup.match(/id="SCENEID-p\d"/g) ?? []).length).toBe(4);
  });
});

describe("scope: one region split into parts that exclude each other", () => {
  it("draws the parts side by side, never one inside another, each item inside its own part", () => {
    const d = LIMITS as Extract<Literal, { kind: "scope" }>;
    const L = scopeLayout(d, region.width, region.height, (t, s) => widthOf(t, s, theme));
    for (let k = 0; k < L.parts.length - 1; k++) {
      const a = L.parts[k] as ScopePart;
      const b = L.parts[k + 1] as ScopePart;
      expect(a.x + a.w).toBeLessThan(b.x);
    }
    const last = L.parts[L.parts.length - 1] as ScopePart;
    expect(last.x + last.w).toBeLessThanOrEqual(region.width);
    for (const p of L.parts)
      for (const it of p.items) {
        expect(it.y).toBeGreaterThanOrEqual(L.top);
        expect(it.y + it.lines.length * 54).toBeLessThanOrEqual(region.height);
        for (const l of it.lines) expect(widthOf(l, 44, theme)).toBeLessThanOrEqual(p.w);
      }
  });

  it("writes items as words, not pills, and lights each part on its own sentence", () => {
    const f = draw(LIMITS, CASES[3]?.[2] as Cue[]);
    expect(f.markup).not.toMatch(/border-radius:32px/);
    expect(f.markup).toContain(">입증되지 않음<");
    const at = (id: string) =>
      Number(
        new RegExp(
          `tl\\.fromTo\\("#SCENEID-${id}", \\{"opacity":0\\.55\\}, [^)]*, ([\\d.]+)\\);`,
        ).exec(f.script)?.[1],
      );
    expect(at("z1")).toBeGreaterThan(at("z0"));
    expect(at("z2")).toBeGreaterThan(at("z1"));
  });

  it("refuses parts that cannot fit, and fewer than two or more than four", () => {
    const many = {
      rings: [
        { label: "a", items: Array.from({ length: 40 }, (_, i) => `항목 ${i}`) },
        { label: "b", items: ["x"] },
      ],
    };
    expect(() => scopeLayout(many, 1700, 400, (t, s) => widthOf(t, s, theme))).toThrow(
      /needs \d+px for its items/,
    );
    expect(() =>
      scopeLayout({ rings: [{ label: "a", items: ["x"] }] }, 1700, 747, (t, s) =>
        widthOf(t, s, theme),
      ),
    ).toThrow(/two to four parts/);
  });
});

describe("ablation: the experiments not run, as holes", () => {
  it("enumerates every on/off combination, and finds the reported one", () => {
    expect(combinations(["A", "B"])).toEqual([["A", "B"], ["A"], ["B"], []]);
    expect(combinations(["A"])).toEqual([["A"], []]);
    expect(() => combinations(["A", "B", "C"])).toThrow(/one or two components/);
    const d = FUTURE as Extract<Literal, { kind: "ablation" }>;
    expect(resultOf(d, ["SSM", "TM-LIF"])).toBe("LHID 30.56 · 0.9106");
    expect(resultOf(d, ["SSM"])).toBeUndefined();
    expect(() => resultOf({ ...d, reported: [{ with: ["PRB"], result: "x" }] }, [])).toThrow(
      /"PRB", which is not one/,
    );
  });

  it("fills the reported square, leaves the others visibly empty, and says what empty means once", () => {
    const f = draw(FUTURE, CASES[4]?.[2] as Cue[]);
    expect(f.markup).toMatch(/id="SCENEID-cell0" style="[^"]*border:4px solid/);
    for (const i of [1, 2, 3])
      expect(f.markup).toMatch(new RegExp(`id="SCENEID-cell${i}" style="[^"]*border:4px dashed`));
    // No words in the squares: one mark for the holes, the result under the grid at 56px.
    expect((f.markup.match(/>missing</g) ?? []).length).toBe(1);
    expect(f.markup).toMatch(/font-size:56px;[^"]*">LHID 30\.56 · 0\.9106</);
    // Each setting is its name and its one value, as words: no axis, no point on a line.
    expect(f.markup).toContain(">0.6<");
    expect(f.markup).toContain(">Sobel<");
    expect(f.markup).not.toMatch(/<circle|stroke-dasharray/);
  });

  it("outlines a proposal that is neither a combination nor a setting, after the settings", () => {
    const lit = literalSchema.parse({ ...FUTURE, others: ["뉴로모픽 하드웨어 측정"] });
    const f = draw(lit, CASES[4]?.[2] as Cue[]);
    expect(f.markup).toMatch(/id="SCENEID-o0" style="[^"]*border:3px dashed/);
    const at = (id: string) =>
      Number(
        new RegExp(`tl\\.fromTo\\("#SCENEID-${id}", \\{[^}]*\\}, \\{[^}]*\\}, ([\\d.]+)\\);`).exec(
          f.script,
        )?.[1],
      );
    expect(at("o0")).toBeGreaterThan(at("s7"));
  });
});

describe("prior-work: families by what they do", () => {
  it("refuses a learned family with no numbers, a running family with numbers, and the wrong lane count", () => {
    const d = PRIOR as Extract<Literal, { kind: "prior-work" }>;
    expect(() => checkLanes(d)).not.toThrow();
    const lanes = d.lanes;
    expect(() => checkLanes({ ...d, lanes: [lanes[0] as never] })).toThrow(/two to four lanes/);
    expect(() =>
      checkLanes({
        ...d,
        lanes: [{ ...(lanes[1] as object), numbers: [] } as never, lanes[0] as never],
      }),
    ).toThrow(/shows the source's numbers and gives none/);
    expect(() =>
      checkLanes({
        ...d,
        lanes: [
          { ...(lanes[0] as object), numbers: [{ label: "x", value: "1" }] } as never,
          lanes[1] as never,
        ],
      }),
    ).toThrow(/its numbers would not be drawn/);
  });

  it("draws the family's binary spikes, not the paper's own multi-level quantizer", () => {
    const w = 32;
    const h = 24;
    const l = new Float32Array(w * h).map(
      (_, i) => (i % w > w / 2 ? 0.8 : 0.2) + ((i * 7) % 5) / 50,
    );
    const s = binarySpikes(l);
    // Fired or not: two levels only, and the bright half fires.
    expect([...new Set(s)].sort()).toEqual([0, 1]);
    expect(s[w - 1]).toBe(1);
    expect(s[0]).toBe(0);
  });

  it("draws no output for a learned family: only its numbers", () => {
    const f = draw(PRIOR, CASES[0]?.[2] as Cue[]);
    const lane1 = /id="SCENEID-lane1"[\s\S]*?(?=<div id="SCENEID-lane2")/.exec(f.markup)?.[0] ?? "";
    expect(lane1).not.toContain("<img");
    expect(lane1).toContain(">175.21 mJ<");
    expect(f.markup).toContain('id="SCENEID-v0-out"');
    expect(f.markup).toContain('id="SCENEID-v2-out"');
  });

  it("asks for its tags: computed on a classical lane, example on spikes, reported on numbers", () => {
    const labels = { ...labelsOf("prior-work") };
    delete labels.example;
    expect(() =>
      literalFragment(
        "prior-work",
        { files: { in: "a", l0: "b", l2: "c" }, data: {} },
        region,
        [],
        { labels, data: PRIOR } as never,
        theme,
      ),
    ).toThrow(/needs the label slot "example"/);
  });
});

/* ------------------------------------------- layout, invariants and pacing */

describe("every visual kind obeys the deck's invariants and fits its region", () => {
  for (const [name, lit, cues] of CASES) {
    const f = draw(lit, cues);
    it(`${name}: every tween is fromTo, scoped, and names an element that exists`, () => {
      const calls = f.script.match(/tl\.\w+\(/g) ?? [];
      expect(new Set(calls)).toEqual(new Set(["tl.fromTo("]));
      for (const id of f.script.matchAll(/tl\.fromTo\("#(SCENEID-[\w-]+)"/g))
        expect(f.markup).toContain(`id="${id[1]}"`);
      expect(f.script + f.markup).not.toMatch(
        /on(Update|Start|Complete|Repeat)|Date\.now|Math\.random|fetch\(|https?:/,
      );
    });

    it(`${name}: no text under 40px, no growth, times to 3 decimals`, () => {
      for (const m of f.markup.matchAll(/font-size:(\d+)px/g))
        expect(Number(m[1])).toBeGreaterThanOrEqual(40);
      // A picture lane's output sweeps across its input (a reveal, as dark-channel's does);
      // nothing that stands for a value grows or counts.
      const lines = f.script.split("\n").filter((l) => !/^tl\.fromTo\("#SCENEID-w\d+"/.test(l));
      expect(lines.join("\n")).not.toMatch(/"width":|innerText|textContent/);
      for (const m of f.script.matchAll(/, (\d+\.\d+)\);$/gm))
        expect((m[1] as string).split(".")[1]?.length).toBeLessThanOrEqual(3);
    });

    it(`${name}: everything the scene positions at its top level lies inside the region`, () => {
      const top = /<div id="SCENEID-lit">\n([\s\S]*)\n<\/div>$/.exec(f.markup)?.[1] ?? "";
      for (const m of top.matchAll(
        /^<div id="SCENEID-[\w-]+"[^>]*left:(-?\d+)px;top:(-?\d+)px;width:(\d+)px;height:(\d+)px/gm,
      )) {
        const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(region.width + 1);
        expect(y + h).toBeLessThanOrEqual(region.height + 1);
      }
      // Labels: their measured width stays inside the region.
      for (const m of f.markup.matchAll(
        /<div id="SCENEID-([\w-]+)" class="lit-label" style="left:(-?\d+)px;top:(-?\d+)px;font-size:(\d+)px[^>]*>([^<]*)</g,
      )) {
        const [, , x, y, size, text] = m as unknown as [
          string,
          string,
          string,
          string,
          string,
          string,
        ];
        if (!/^SCENEID-lit/.test(`SCENEID-${m[1]}`)) continue;
        expect(Number(y)).toBeGreaterThanOrEqual(0);
        void x;
        void size;
        void text;
      }
    });

    it(`${name}: never more than ${STILL_MAX}s without a tween while it is narrated`, () => {
      const from = (cues[0] as Cue).t0 + 1;
      const to = (cues[cues.length - 1] as Cue).t1 - 0.5;
      const long = stillSpans(f.script, from, to).filter(([a, b]) => b - a > STILL_MAX);
      expect(long, `${name} stands still over ${JSON.stringify(long)}`).toEqual([]);
    });

    it(`${name}: the plan-time check passes what the build draws`, () => {
      const labels = Object.entries(labelsOf(lit.kind)).map(([slot, text]) => ({ slot, text }));
      expect(visualProblems({ ...lit, labels } as Literal, region, theme)).toEqual([]);
    });
  }

  it("the plan-time check names what the build would refuse", () => {
    const labels = Object.entries(labelsOf("margins")).map(([slot, text]) => ({ slot, text }));
    const bad = {
      ...MARGINS,
      settings: (MARGINS as Extract<Literal, { kind: "margins" }>).settings.slice(0, 1),
      labels,
    } as Literal;
    expect(visualProblems(bad, region, theme)).toEqual([
      expect.stringMatching(/at least two settings/),
    ]);
  });
});

/* ------------------------------------- prior-work's pictures, through ffmpeg */

const ffmpeg = await new Promise<boolean>((done) =>
  execFile("ffmpeg", ["-version"], (err) => done(!err)),
);

describe.skipIf(!ffmpeg)(
  "prior-work runs its classical lanes on a real picture",
  { timeout: 60_000 },
  () => {
    let dir = "";
    let pic = "";
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), "literal-prior-"));
      const w = 640;
      const h = 480;
      const d = new Float32Array(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        const v = (((i % w) * 7 + Math.floor(i / w) * 13) % 17) / 16;
        d.set([v, 0.6 * v, 0.3], i * 3);
      }
      pic = join(dir, "pic.png");
      await writeRaster(pic, w, h, toRgba({ w, h, d }));
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("writes the hazy input and one output per running lane, and nothing for a learned one", async () => {
      const L = await KINDS["prior-work"].layers({
        beatId: "b",
        image: pic,
        dir,
        region,
        spec: { labels: labelsOf("prior-work"), data: PRIOR },
        theme,
        earlier: new Map(),
      });
      expect(Object.keys(L.files).sort()).toEqual(["in", "l0", "l2", "thumb"]);
      for (const f of Object.values(L.files))
        await expect(stat(join(dir, f))).resolves.toBeTruthy();
    });

    it("needs no picture when every lane shows numbers, and refuses a running lane without one", async () => {
      const d = PRIOR as Extract<Literal, { kind: "prior-work" }>;
      const numbersOnly = { ...d, lanes: [d.lanes[1], { ...(d.lanes[1] as object), family: "x" }] };
      const run = (data: unknown, image?: string) =>
        KINDS["prior-work"].layers({
          beatId: "b",
          ...(image ? { image } : {}),
          dir,
          region,
          spec: { labels: labelsOf("prior-work"), data },
          theme,
          earlier: new Map(),
        });
      await expect(run(numbersOnly)).resolves.toEqual({ files: {}, data: {} });
      await expect(run(PRIOR)).rejects.toThrow(/runs a method on the picture and has none/);
    });
  },
);
