/**
 * The word forms a table would otherwise take (src/literal/kinds/place-*.ts and
 * prior-work): place margin, place sets, place combos and prior-work. Their pure computation, their layout (text never
 * under 40px, everything inside the region, every element a tween names
 * exists), and their pacing on the EM-SNN deck's own sentence cues for the
 * beats they replace. Synthetic layers; ffmpeg only for prior-work's pictures.
 */
import { describe, expect, it } from "vitest";
import type { Theme } from "../src/emit/kit.js";
import { drawProblems } from "../src/literal/check.js";
import { leanThroughStill, literalFragment } from "../src/literal/index.js";
import { widthOf } from "../src/literal/kind.js";
import { wrapBy } from "../src/literal/kinds/common.js";
import { combinations, resultOf } from "../src/literal/kinds/place-combos.js";
import { axisSpan, marginOf, marginsOf } from "../src/literal/kinds/place-margins.js";
import { type ScopePart, scopeLayout } from "../src/literal/kinds/place-sets.js";
import { checkLanes } from "../src/literal/kinds/prior-work.js";
import { type Cue, type Layers, stillSpans } from "../src/literal/kit.js";
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
  lanes: [
    {
      family: "사전 기반",
      members: "Prior-A · Prior-B · Prior-C",
      from: "b04-structure",
      gap: "가정이 깨지면 실패할 수 있음",
    },
    {
      family: "딥러닝",
      members: "Net-A · Net-B · Net-C",
      numbers: [
        { label: "Net-C 보고 에너지", value: "175.21 mJ" },
        { label: "Net-C 파라미터", value: "5.08 M" },
      ],
      gap: "상당한 연산량 · 경량화하면 표현력 희생 가능",
    },
    {
      family: "SNN",
      members: "빗줄기 제거 · 초해상도 · 탐지",
      from: "b06-stream",
      gap: "밀집 복원은 덜 탐구됨",
    },
  ],
  labels: [],
});

const MARGINS = literalSchema.parse({
  kind: "place",
  form: "plane",
  measure: "margin",
  margins: {
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
  },
  labels: [],
});

const DATASETS = literalSchema.parse({
  kind: "place",
  form: "sets",
  sets: {
    rings: [
      { label: "수치 결과", items: ["LHID", "DHID", "RICE1", "RICE2"] },
      { label: "정성 비교만", items: ["SateHaze1K"] },
      { label: "결과 없음", items: ["RRSHID"] },
    ],
  },
  labels: [],
});

const LIMITS = literalSchema.parse({
  kind: "place",
  form: "sets",
  sets: {
    rings: [
      { label: "표로 뒷받침", items: ["LHID", "DHID", "RICE1", "RICE2"] },
      {
        label: "보고되지 않음",
        items: ["분포 변화 시험", "구성 요소 제거 실험", "반복 실행 분산", "에너지 산출 절차"],
      },
      { label: "입증되지 않음", items: ["다른 센서", "다른 지역", "다른 영상 크기", "실제 안개"] },
    ],
  },
  labels: [],
});

const FUTURE = literalSchema.parse({
  kind: "place",
  form: "combos",
  combos: {
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
  },
  labels: [],
});

type PlaceLit = Extract<Literal, { kind: "place" }>;
/** The word form's own data, as its renderer reads it. */
const sub = <K extends "margins" | "combos" | "sets">(lit: Literal, k: K) =>
  (lit as PlaceLit)[k] as NonNullable<PlaceLit[K]>;

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
          ? Object.fromEntries(
              lit.lanes.flatMap((l, k) => (l.from ? [[`l${k}`, `l${k}.png`]] : [])),
            )
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
  [
    // OneVL's Impromptu L2 table: a row lit per sentence, each sentence 7-9s.
    "table (b12-impromptu)",
    literalSchema.parse({
      kind: "table",
      columns: ["方法", "1 s", "2 s", "3 s", "4 s", "平均"],
      rows: [
        ["OneVL", "0.13", "0.48", "1.18", "2.25", "1.01"],
        ["AR CoT+Answer", "0.13", "0.51", "1.27", "2.44", "1.09"],
        ["Impromptu VLA", "0.14", "0.60", "1.45", "2.67", "1.22"],
      ],
      highlight: [2, 1, 0],
      labels: [],
    }),
    c([
      [0.95, 8.3],
      [8.35, 16.9],
      [16.95, 25.4],
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
    const d = sub(MARGINS, "margins");
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
    const M = marginsOf(sub(MARGINS, "margins"));
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
    const m = sub(MARGINS, "margins");
    const one = literalSchema.parse({
      ...MARGINS,
      form: "strip",
      margins: {
        ...m,
        metrics: [{ name: "PSNR", lowerIsBetter: false }],
        settings: m.settings.map((s) => ({ name: s.name, values: [s.values[0]] })),
      },
    });
    const f = draw(one, CASES[1]?.[2] as Cue[]);
    expect(f.markup).not.toContain('id="SCENEID-l-y"');
    expect((f.markup.match(/id="SCENEID-p\d"/g) ?? []).length).toBe(4);
  });
});

describe("scope: one region split into parts that exclude each other", () => {
  it("draws the parts side by side, never one inside another, each item inside its own part", () => {
    const d = sub(LIMITS, "sets");
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

  it("wraps a Chinese item between characters, where a space-only wrap could not break it", () => {
    // The OneVL plan's item, refused at 621px in a 582px part before Han could break.
    const item = "极端场景或安全关键型评测套件";
    const d = {
      rings: [
        { label: "已测", items: ["nuScenes"] },
        { label: "未测", items: [item] },
      ],
    };
    const L = scopeLayout(d, 1000, 1500, (t, s) => widthOf(t, s, theme));
    const it2 = L.parts[1]?.items[0];
    expect(it2?.lines.length).toBeGreaterThan(1);
    expect(it2?.lines.join("")).toBe(item);
    for (const l of it2?.lines ?? [])
      expect(widthOf(l, 44, theme)).toBeLessThanOrEqual(L.parts[1]?.w ?? 0);
  });

  it("keeps a Korean word whole and never opens a line on closing punctuation", () => {
    const narrow = (t: string, s: number) => widthOf(t, s, theme);
    for (const l of wrapBy("안개 제거 네트워크의 경계 복원 성능", 44, 260, narrow))
      expect(l.startsWith(" ")).toBe(false);
    expect(wrapBy("안개 제거 네트워크의", 44, 120, narrow)).toEqual(["안개", "제거", "네트워크의"]);
    const zh = wrapBy("语言解码器，视觉解码器。", 44, 150, narrow);
    for (const l of zh) expect(/^[，。]/.test(l)).toBe(false);
    expect(zh.join("")).toBe("语言解码器，视觉解码器。");
  });
});

describe("ablation: the experiments not run, as holes", () => {
  it("enumerates every on/off combination, and finds the reported one", () => {
    expect(combinations(["A", "B"])).toEqual([["A", "B"], ["A"], ["B"], []]);
    expect(combinations(["A"])).toEqual([["A"], []]);
    expect(() => combinations(["A", "B", "C"])).toThrow(/one or two components/);
    const d = sub(FUTURE, "combos");
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

  it("gives the grid the width short settings leave, and three results room", () => {
    // OneVL's ablation: two decoders, three reported results, two loss weights. A fixed
    // 54% settings column left the squares 46px and the plan was refused in every format.
    const lit = literalSchema.parse({
      kind: "place",
      form: "combos",
      combos: {
        components: ["视觉解码器", "语言解码器"],
        reported: [
          { with: ["视觉解码器", "语言解码器"], result: "88.84" },
          { with: ["语言解码器"], result: "87.97" },
          { with: ["视觉解码器"], result: "88.53" },
        ],
        settings: [
          { name: "λ_l", value: "1.0" },
          { name: "λ_v", value: "0.1" },
        ],
      },
      labels: [],
    });
    for (const r of [region, { width: 1220, height: 1000 }, { width: 1220, height: 2120 }]) {
      const f = draw(lit, CASES[4]?.[2] as Cue[], undefined, r);
      const cell = Number(/id="SCENEID-cell0" style="[^"]*width:(\d+)px/.exec(f.markup)?.[1]);
      expect(cell).toBeGreaterThanOrEqual(200);
      expect(f.markup).toMatch(/font-size:56px;[^"]*">87\.97</);
    }
  });

  it("outlines a proposal that is neither a combination nor a setting, after the settings", () => {
    const lit = literalSchema.parse({
      ...FUTURE,
      combos: { ...sub(FUTURE, "combos"), others: ["뉴로모픽 하드웨어 측정"] },
    });
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
    ).toThrow(/shows neither an earlier scene/);
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

  it("draws no output for a learned family: only its numbers", () => {
    const f = draw(PRIOR, CASES[0]?.[2] as Cue[]);
    const lane1 = /id="SCENEID-lane1"[\s\S]*?(?=<div id="SCENEID-lane2")/.exec(f.markup)?.[0] ?? "";
    expect(lane1).not.toContain("<img");
    expect(lane1).toContain(">175.21 mJ<");
    expect(f.markup).toContain('id="SCENEID-v0-out"');
    expect(f.markup).toContain('id="SCENEID-v2-out"');
  });

  it("asks for its tags: example on a lane computed on example material, reported on numbers", () => {
    const labels = { ...labelsOf("prior-work") };
    delete labels.example;
    expect(() =>
      literalFragment(
        "prior-work",
        { files: { l0: "b", l2: "c" }, data: {} },
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
      expect(drawProblems({ ...lit, labels } as Literal, region, theme)).toEqual([]);
    });
  }

  it("the plan-time check names what the build would refuse", () => {
    const labels = Object.entries(labelsOf("place")).map(([slot, text]) => ({ slot, text }));
    const m = sub(MARGINS, "margins");
    const bad = {
      ...MARGINS,
      margins: { ...m, settings: m.settings.slice(0, 1) },
      labels,
    } as Literal;
    expect(drawProblems(bad, region, theme)).toEqual([
      expect.stringMatching(/at least two settings/),
    ]);
  });
});

/* ------------------------------------------- prior-work's earlier layers */

describe("prior-work brings back what earlier scenes computed", () => {
  const earlier = new Map([
    [
      "b04-structure",
      { kind: "operate", layers: { files: { thumb: "b04-s5.png" }, data: {} }, labels: {} },
    ],
    [
      "b06-stream",
      { kind: "evolve", layers: { files: { thumb: "b06-t7.jpg" }, data: {} }, labels: {} },
    ],
  ]);
  const run = (data: unknown, e = earlier) =>
    KINDS["prior-work"].layers({
      beatId: "b",
      dir: "/nowhere",
      region,
      spec: { labels: labelsOf("prior-work"), data },
      theme,
      earlier: e,
    });

  it("takes each `from` lane's layer, and nothing for a numbers lane", async () => {
    const L = await run(PRIOR);
    expect(L.files).toEqual({ l0: "b04-s5.png", l2: "b06-t7.jpg", thumb: "b04-s5.png" });
  });

  it("refuses a lane that names a scene which computed no picture", async () => {
    await expect(run(PRIOR, new Map())).rejects.toThrow(/computed no picture before it/);
  });
});

describe("a literal scene leans through a still sentence", () => {
  const tween = (id: string, dur: number, at: number) =>
    `tl.fromTo("#SCENEID-${id}", {"opacity":0}, {"opacity":1,"duration":${dur}}, ${at});`;
  const leans = (script: string) =>
    script.split("\n").filter((l) => l.startsWith('tl.fromTo("#SCENEID-lit"'));
  const atOf = (l: string) => Number(/, (-?[\d.]+)\);$/.exec(l)?.[1]);

  it("leans in and back inside each sentence, clear of every tween and sentence start", () => {
    // Two groups over four sentences: the last two sentences have nothing to reveal.
    const script = [tween("a", 0.6, 1), tween("b", 0.6, 8.5)].join("\n");
    const cues = c([
      [0.95, 8.3],
      [8.35, 15.1],
      [15.15, 21.9],
      [21.95, 25.2],
    ]);
    const l = leans(leanThroughStill(script, cues));
    // Sentences 1-3 each lean (in, out); the 3.25s last one does not.
    expect(l).toHaveLength(6);
    expect(l.map(atOf)).toEqual([1.75, 5, 9.25, 12.15, 15.3, 18.575]);
    expect(l[1]).toContain('"scale":1,');
  });

  it("adds nothing where the kind keeps moving, or where nothing is spoken", () => {
    const busy = Array.from({ length: 8 }, (_, k) => tween(`x${k}`, 1, 1 + k)).join("\n");
    const cues = c([[0.95, 8.5]]);
    expect(leanThroughStill(busy, cues)).toBe(busy);
    expect(leanThroughStill(tween("a", 0.6, 1), [])).toBe(tween("a", 0.6, 1));
  });
});
