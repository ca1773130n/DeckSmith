/**
 * Section coverage and the literal-scene checks (src/plan/coverage.ts), and the
 * repair round that enforces them (src/plan/codex.ts).
 *
 * The fixture is the shape of the analysis that exposed the gap: a hypepaper
 * Q-template with Q4's experiments split into subsections and the limits (Q8)
 * after the summary (Q6) in the source — so the deck's order is NOT the
 * source's order.
 */
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { codexPlanner, schemaFor } from "../src/plan/codex.js";
import {
  coverageFindings,
  formulaProblems,
  literalFindings,
  paramProblem,
  partOfHeading,
  sourceParts,
} from "../src/plan/coverage.js";
import { sourceBlocks } from "../src/plan/prompt.js";
import {
  LITERAL_KIND_DOCS,
  LITERAL_KIND_NAMES,
  LITERAL_OPS,
  prefsSchema,
  sourceSchema,
  storyboardSchema,
} from "../src/types.js";
import { slotsFor } from "./literal-fixtures.js";

/** A kind's every slot, as a plan's `labels` array. */
const labelsFor = (kind: Parameters<typeof slotsFor>[0], over: Record<string, string> = {}) =>
  Object.entries(slotsFor(kind, over)).map(([slot, text]) => ({ slot, text }));

const analysis = sourceSchema.parse({
  id: "emsnn",
  title: "EM-SNN: Spiking Dehazing",
  lang: "ko",
  sections: [
    { id: "sec1", depth: 1, heading: "EM-SNN: Spiking Dehazing", text: "" },
    {
      id: "sec2",
      depth: 2,
      heading: "Q1: 이 논문은 어떤 문제를 해결하려고 하는가?",
      text: "안개가 대비를 낮춘다.",
    },
    {
      id: "sec3",
      depth: 2,
      heading: "Q2: 어떤 관련 연구가 있는가?",
      text: "Dark Channel Prior (DCP).",
    },
    {
      id: "sec4",
      depth: 2,
      heading: "Q3: 논문은 이 문제를 어떻게 해결하는가?",
      text: [
        "TM-LIF: 채널별 임계값 보정. TM-LIF는 고정 발화 임계값을 사용하는 대신, 학습 중 각 채널의 막전위 분산에 대한 지수이동평균 추정값을 유지한다. 채널 임계값은 이 추정값에 비례하도록 설정되며, 스케일링 계수는 $\\alpha$이다. 뉴런은 막전위를 클리핑된 정수 발화 수준으로 양자화한 다음, 그 수준을 $D$로 정규화한다.",
        "",
        "SSM: Sobel 기반 채널 및 공간 조절. 각 시간 단계에서 SSM은 채널에 걸쳐 특징을 평균화하고, 가로 및 세로 방향의 고정 Sobel 기울기를 계산한 뒤, 절댓값 크기를 더하고 공간 평균으로 구조 맵을 정규화한다.",
        "",
        "논문은 임계값 이하의 막 동역학이 1차 저역통과 필터처럼 작용하고, 누설 계수가 1에 가까워질수록 평활화가 강해진다는 점을 들어 SSM의 동기를 설명한다. Sobel 가이드는 이러한 깊이 방향의 에지 및 텍스처 감쇠를 상쇄하기 위한 것이다. 주장된 효율성에 중요한 아키텍처 선택은 고정 Sobel 필터, 소형 조절 분기, 시간 단계 간 가중치 공유, 스파이킹 특징 변환의 사용이다. 논문의 기본 구성은 $T{=}1$ 및 $D{=}4$을 사용하며, $\\alpha{=}0.6$, $\\beta{=}0.25$, EMA 모멘텀 $\\mu{=}0.9$을 사용한다.",
        "",
        "학습 설정은 배치 크기 4, 무작위 $256\\times256$ 크롭을 사용한다.",
      ].join("\n"),
    },
    { id: "sec5", depth: 2, heading: "Q4: 논문에서는 어떤 실험을 수행했는가?", text: "" },
    {
      id: "sec6",
      depth: 3,
      heading: "데이터셋, 설정 및 지표",
      text: "HRSD(LHID, DHID), SateHaze1K, RRSHID에서 평가했다. SateHaze1K는 정성 비교만 있다.",
    },
    {
      id: "sec7",
      depth: 3,
      heading: "보고된 표의 정량적 비교",
      text: [
        "LHID: 30.56 PSNR 및 0.9106 SSIM.",
        "",
        "- LHID: EM-SNN은 30.56 PSNR이다. 다음은 DehazeFormer-b의 29.73 PSNR이다.",
        "- DHID: SFRDP-Net이 28.89로 가장 높으며, EM-SNN은 28.83이다.",
        "- 복잡도: SFRDP-Net에 대해서는 파라미터 5.08 M, 에너지 175.21 mJ를 보고한다.",
      ].join("\n"),
    },
    { id: "sec9", depth: 2, heading: "Q5: 어떤 점을 더 탐구할 수 있는가?", text: "에너지 측정." },
    { id: "sec10", depth: 2, heading: "Q6: 논문의 주요 내용을 요약하라", text: "요약." },
    {
      id: "sec11",
      depth: 2,
      heading: "Q8: 이 논문의 한계는 무엇이며, 결과가 일반화되지 않을 수 있는 영역은 어디인가?",
      text: "한계.",
    },
  ],
  figures: [{ id: "gen-b02", src: "gen-b02.png", caption: "aerial", width: 1536, height: 1024 }],
  equations: [],
  tables: [],
});

const sec = (id: string) => ({ kind: "section", id });
/** Three shapes in turn, by beat number, so no plan here trips the variety rule. */
const SHAPES = [
  { archetype: "kinetic", params: { headline: "k", phrases: [{ text: "a" }, { text: "b" }] } },
  { archetype: "hero-number", params: { headline: "h", value: "4", label: "x" } },
  { archetype: "callout", params: { headline: "c", panels: [{ label: "p", lines: ["l"] }] } },
];
const beatOf = (id: string, part: string | undefined, cites: string[], extra = {}) => ({
  id,
  intent: id,
  ...(part ? { part } : {}),
  takeaway: `${id} takeaway`,
  evidence: cites.map(sec),
  ...SHAPES[Number(id.slice(1, 3)) % SHAPES.length],
  ...extra,
});
const title = {
  id: "b00-title",
  intent: "title",
  evidence: [sec("sec2")],
  archetype: "title",
  params: { headline: "EM-SNN" },
};

/** The stated chain on the deck's picture: every op and variant named in sec4. */
const OPERATE = {
  kind: "operate",
  picture: "b01-problem",
  chain: [
    { op: "channels", how: "mean", params: [], label: "채널 평균" },
    { op: "conv", how: "sobel-x", params: [], label: "가로 Sobel" },
    { op: "conv", how: "sobel-y", params: [], of: [1], label: "세로 Sobel" },
    { op: "combine", how: "abs-sum", params: [], of: [2, 3], label: "절댓값 합" },
    { op: "normalise", how: "mean", params: [], label: "공간 평균" },
  ],
  labels: [
    { slot: "input", text: "예시 장면" },
    { slot: "output", text: "구조 맵" },
    { slot: "example", text: "예시" },
    { slot: "caption", text: "논문이 밝힌 연산을 예시 이미지에 적용" },
  ],
};

/** A plan that covers every part, in deck order (limits before summary). */
const covered = () => [
  title,
  {
    id: "b01-problem",
    intent: "haze",
    part: "intro",
    takeaway: "haze fades edges",
    evidence: [sec("sec2")],
    archetype: "stage",
    params: {
      headline: "haze",
      placement: "bottom-left",
      figureId: "gen-b02",
    },
    literal: OPERATE,
  },
  beatOf("b02-prior", "prior-work", ["sec3"]),
  beatOf("b03-method", "method", ["sec4"], {
    literal: {
      kind: "region",
      picture: "b01-problem",
      cut: "crops",
      size: { value: "256" },
      count: { value: "4" },
      gather: true,
      labels: [
        { slot: "picture", text: "학습 사진" },
        { slot: "batch", text: "배치" },
        { slot: "example", text: "예시" },
      ],
    },
  }),
  beatOf("b04-setup", "experiments", ["sec6"]),
  beatOf("b05-results", "experiments", ["sec7"], {
    literal: {
      kind: "table",
      columns: ["", "PSNR", "SSIM"],
      rows: [["LHID", "30.56", "0.9106"]],
      highlight: [0],
    },
  }),
  beatOf("b06-future", "limits", ["sec9"]),
  beatOf("b07-limits", "limits", ["sec11"]),
  beatOf("b08-summary", "summary", ["sec10"], {
    literal: { kind: "recap", beats: ["b01-problem", "b03-method"] },
  }),
];
const plan = (beats: unknown[]) =>
  storyboardSchema.parse({ sourceId: "emsnn", title: "EM-SNN", beats });

describe("detecting a source's parts from its headings", () => {
  it("reads the hypepaper template in Korean and English, the specific part winning", () => {
    expect(partOfHeading("Q1: 이 논문은 어떤 문제를 해결하려고 하는가?")).toBe("intro");
    expect(partOfHeading("Q3: 논문은 이 문제를 어떻게 해결하는가?")).toBe("method");
    expect(
      partOfHeading(
        "Q8: 이 논문의 한계는 무엇이며, 결과가 일반화되지 않을 수 있는 영역은 어디인가?",
      ),
    ).toBe("limits");
    expect(partOfHeading("Q1: What problem does this paper try to solve?")).toBe("intro");
    expect(partOfHeading("Q3: How does the paper solve this problem?")).toBe("method");
    expect(partOfHeading("Q5: What can be explored further?")).toBe("limits");
    expect(partOfHeading("Related Work")).toBe("prior-work");
    expect(partOfHeading("Conclusion and Future Work")).toBe("summary");
    expect(partOfHeading("Cost")).toBeUndefined();
  });

  it("lists the parts in deck order, subsections inheriting their parent's part", () => {
    expect(sourceParts(analysis).map((p) => [p.part, p.sections.map((s) => s.id)])).toEqual([
      ["intro", ["sec2"]],
      ["prior-work", ["sec3"]],
      ["method", ["sec4"]],
      // sec5 has no text of its own: it is covered by covering its subsections.
      ["experiments", ["sec6", "sec7"]],
      // Q5 and Q8 are one part, and it comes BEFORE the summary although Q8 is after Q6.
      ["limits", ["sec9", "sec11"]],
      ["summary", ["sec10"]],
    ]);
  });

  it("is off for a document that is not an analysis", () => {
    const plain = sourceSchema.parse({
      ...analysis,
      sections: [
        { id: "a", depth: 1, heading: "Introduction", text: "x" },
        { id: "b", depth: 2, heading: "Cost", text: "y" },
        { id: "c", depth: 2, heading: "Limits", text: "z" },
      ],
    });
    expect(sourceParts(plain)).toEqual([]);
    expect(coverageFindings(plan([title]), plain)).toEqual([]);
  });

  it("is off for an article whose headings name three parts but no paper's prior work or experiments", () => {
    const article = sourceSchema.parse({
      ...analysis,
      sections: [
        { id: "a", depth: 2, heading: "Overview", text: "x" },
        { id: "b", depth: 2, heading: "How it works", text: "y" },
        { id: "c", depth: 2, heading: "Summary", text: "z" },
      ],
    });
    expect(sourceParts(article)).toEqual([]);
  });
});

describe("coverageFindings", () => {
  it("passes a plan covering every part and section in order", () => {
    expect(coverageFindings(plan(covered()), analysis)).toEqual([]);
  });

  it("names a missing part and its sections, and the title slide does not count as the problem", () => {
    const beats = covered().filter((b) => b.id !== "b02-prior" && b.id !== "b01-problem");
    const found = coverageFindings(plan(beats), analysis);
    expect(found).toContainEqual(
      expect.stringMatching(/prior work \(\[section sec3\] Q2: .*no beat covers it/),
    );
    expect(found).toContainEqual(
      expect.stringMatching(/introduction.*\[section sec2\].*no beat covers it/),
    );
  });

  it("names a section of a covered part that no beat cites", () => {
    const beats = covered().filter((b) => b.id !== "b04-setup");
    expect(coverageFindings(plan(beats), analysis)).toEqual([
      expect.stringMatching(/No "experiments" beat cites \[section sec6\]/),
    ]);
  });

  it("refuses the source's order where it is not the deck's: summary before limits", () => {
    const beats = covered();
    const summary = beats.pop();
    beats.splice(6, 0, summary as (typeof beats)[number]);
    expect(coverageFindings(plan(beats), analysis)).toEqual([
      expect.stringMatching(
        /b06-future \(part "limits"\) comes after b08-summary \(part "summary"\)/,
      ),
    ]);
  });

  it("refuses a beat with no part, and a part its evidence contradicts", () => {
    const beats = covered();
    beats[2] = beatOf("b02-prior", undefined, ["sec3"]);
    beats[3] = beatOf("b03-method", "method", ["sec3"]);
    const found = coverageFindings(plan(beats), analysis);
    expect(found).toContainEqual(expect.stringMatching(/b02-prior carry no `part`/));
    expect(found).toContainEqual(
      expect.stringMatching(/b03-method is part "method" but cites only prior-work/),
    );
  });
});

describe("literalFindings", () => {
  it("passes a plan whose literal beats resolve", () => {
    expect(literalFindings(plan(covered()), analysis, { takeaways: true })).toEqual([]);
  });

  it("refuses a picture on a later beat, or on a beat with no picture", () => {
    const beats = covered();
    beats[1] = { ...(beats[1] as object), literal: { ...OPERATE, picture: "b03-method" } } as never;
    beats[3] = beatOf("b03-method", "method", ["sec4"], {
      literal: { ...OPERATE, picture: "b02-prior" },
    });
    const found = literalFindings(plan(beats), analysis);
    expect(found).toContainEqual(expect.stringMatching(/b01-problem's operate .*a later beat/));
    expect(found).toContainEqual(
      expect.stringMatching(/b03-method's operate .*"b02-prior", which has none/),
    );
  });

  it("refuses a table number the source never states, and a row it does not have", () => {
    const beats = covered();
    beats[5] = beatOf("b05-results", "experiments", ["sec7"], {
      literal: { kind: "table", columns: ["PSNR"], rows: [["30.56"], ["31.20"]], highlight: [2] },
    });
    const found = literalFindings(plan(beats), analysis);
    expect(found).toContainEqual(
      expect.stringMatching(/table scene says "31.20", which the source never states/),
    );
    expect(found).toContainEqual(expect.stringMatching(/highlights row 2/));
  });

  it("refuses a length the source never states, and a mark on no cell", () => {
    const beats = covered();
    beats[5] = beatOf("b05-results", "experiments", ["sec7"], {
      literal: {
        kind: "place",
        form: "strip",
        measure: "length",
        lengths: {
          groups: [
            {
              label: "PSNR",
              unit: "dB",
              items: [
                { label: "EM-SNN", value: "30.56" },
                { label: "other", value: "99.9" },
              ],
            },
          ],
        },
      },
    });
    let found = literalFindings(plan(beats), analysis);
    expect(found).toContainEqual(
      expect.stringMatching(/lengths draw "99.9", which the source never states/),
    );
    expect(found.join("\n")).not.toMatch(/"30.56"/);
    beats[5] = beatOf("b05-results", "experiments", ["sec7"], {
      literal: { kind: "table", columns: ["PSNR"], rows: [["30.56"]], marks: [{ row: 0, col: 3 }] },
    });
    found = literalFindings(plan(beats), analysis);
    expect(found).toContainEqual(expect.stringMatching(/marks \(0, 3\), which is no cell/));
  });

  it("keeps at most one table: the others are drawn as what they list", () => {
    const beats = covered();
    const table = { kind: "table", columns: ["PSNR"], rows: [["30.56"]] };
    beats[4] = beatOf("b04-setup", "experiments", ["sec6"], { literal: table });
    beats[5] = beatOf("b05-results", "experiments", ["sec7"], { literal: table });
    expect(literalFindings(plan(beats), analysis)).toContainEqual(
      expect.stringMatching(/draws 2 tables \(b04-setup, b05-results\).*`place`.*sets/),
    );
    beats[4] = beatOf("b04-setup", "experiments", ["sec6"]);
    expect(literalFindings(plan(beats), analysis).join("\n")).not.toMatch(/tables/);
  });

  it("holds a prior-work lane's numbers to the names the source gives them, and its `from` to an earlier picture", () => {
    const beats = covered();
    const prior = (lanes: unknown[]) =>
      beatOf("b02-prior", "prior-work", ["sec3"], {
        literal: {
          kind: "prior-work",
          lanes,
          labels: [
            { slot: "reported", text: "보고된 값" },
            { slot: "example", text: "예시" },
          ],
        },
      });
    const numbers = (members: string) => ({
      family: "딥러닝",
      members,
      numbers: [{ label: "파라미터", value: "5.08 M" }],
      gap: "연산량",
    });
    beats[2] = prior([numbers("SFRDP-Net"), { ...numbers("SFRDP-Net"), family: "다른 것" }]);
    expect(literalFindings(plan(beats), analysis)).toEqual([]);
    beats[2] = prior([numbers("FooNet"), numbers("SFRDP-Net")]);
    let found = literalFindings(plan(beats), analysis).join("\n");
    expect(found).toMatch(/names "FooNet" in lane "딥러닝", which the source never names/);
    expect(found).toMatch(/credits "5.08 M" to lane "딥러닝" \(FooNet\)/);
    // A number the source states, but for another method.
    beats[2] = prior([numbers("DehazeFormer-b"), numbers("SFRDP-Net")]);
    expect(literalFindings(plan(beats), analysis).join("\n")).toMatch(/credits "5.08 M"/);
    // A lane that brings back a scene: it must be an earlier one with a picture.
    beats[2] = prior([
      { family: "사전", members: "SFRDP-Net", from: "b03-method", gap: "가정" },
      numbers("SFRDP-Net"),
    ]);
    found = literalFindings(plan(beats), analysis).join("\n");
    expect(found).toMatch(/lane "사전" names "b03-method", which is not an earlier beat/);
  });

  it("refuses a combos cell the source never reports as an ablation", () => {
    const beats = covered();
    beats[7] = beatOf("b07-limits", "limits", ["sec11"], {
      literal: {
        kind: "place",
        form: "combos",
        combos: {
          components: ["TM-LIF", "SSM"],
          // 28.83 is real — the full model's DHID PSNR — and no ablation of SSM is reported.
          reported: [
            { with: ["TM-LIF", "SSM"], result: "LHID 30.56" },
            { with: ["TM-LIF"], result: "PSNR 28.83" },
          ],
        },
        labels: labelsFor("place"),
      },
    });
    expect(literalFindings(plan(beats), analysis)).toEqual([
      expect.stringMatching(
        /reports "PSNR 28.83" for TM-LIF \(without SSM\), and the source never reports that number as a result without SSM/,
      ),
    ]);
  });

  it("places a margin only by the setting's own values, its named rival and the metric's direction", () => {
    const beats = covered();
    type V = { ours: string; best: string; rival: string };
    type M = {
      ours: string;
      metrics: [{ name: string; lowerIsBetter: boolean }];
      settings: [{ name: string; values: [V] }, { name: string; values: [V] }];
    };
    const margins = (over: (m: M) => void = () => {}) => {
      const m = {
        ours: "EM-SNN",
        metrics: [{ name: "PSNR", lowerIsBetter: false }],
        settings: [
          { name: "LHID", values: [{ ours: "30.56", best: "29.73", rival: "DehazeFormer-b" }] },
          { name: "DHID", values: [{ ours: "28.83", best: "28.89", rival: "SFRDP-Net" }] },
        ],
      };
      over(m as unknown as M);
      return beatOf("b05-results", "experiments", ["sec7"], {
        literal: {
          kind: "place",
          form: "strip",
          measure: "margin",
          margins: m,
          labels: labelsFor("place"),
        },
      });
    };
    beats[5] = margins();
    expect(literalFindings(plan(beats), analysis)).toEqual([]);
    beats[5] = margins((m) => {
      m.settings[0].values[0].best = "28.89";
    });
    expect(literalFindings(plan(beats), analysis).join("\n")).toMatch(
      /places LHID on PSNR by EM-SNN 30.56 against DehazeFormer-b 28.89/,
    );
    beats[5] = margins((m) => {
      m.ours = "OurNet";
      m.settings[0].values[0].rival = "MadeUpNet";
    });
    const found = literalFindings(plan(beats), analysis).join("\n");
    expect(found).toMatch(/names "OurNet", which the source never names/);
    expect(found).toMatch(/against MadeUpNet 29.73/);
    beats[5] = margins((m) => {
      m.metrics[0].lowerIsBetter = true;
    });
    expect(literalFindings(plan(beats), analysis).join("\n")).toMatch(
      /gives PSNR lowerIsBetter true; PSNR is higher is better/,
    );
    beats[5] = margins((m) => {
      m.settings[0].values[0].ours = "30.56 dB";
    });
    expect(literalFindings(plan(beats), analysis).join("\n")).toMatch(
      /gives "30.56 dB" as margin values; each is one number/,
    );
  });

  it("places a point only by the values a passage states beside its name", () => {
    const beats = covered();
    const point = (values: [string, string]) =>
      beatOf("b05-results", "experiments", ["sec7"], {
        literal: {
          kind: "place",
          form: "plane",
          axes: [
            { name: "PSNR", lowerIsBetter: false },
            { name: "SSIM", lowerIsBetter: false },
          ],
          items: [
            { label: "LHID", values },
            { label: "DehazeFormer-b", values: ["29.73", "29.73"] },
          ],
        },
      });
    beats[5] = point(["30.56", "0.9106"]);
    expect(literalFindings(plan(beats), analysis).join("\n")).not.toMatch(/places "LHID"/);
    beats[5] = point(["30.56", "28.89"]);
    expect(literalFindings(plan(beats), analysis).join("\n")).toMatch(
      /places "LHID" at 30.56, 28.89, and no passage/,
    );
  });

  it("holds set items to the source's names, and the first set to what has results", () => {
    const beats = covered();
    const sets = (first: string[]) =>
      beatOf("b04-setup", "experiments", ["sec6"], {
        literal: {
          kind: "place",
          form: "sets",
          sets: {
            rings: [
              { label: "수치", items: first },
              { label: "정성", items: ["SateHaze1K"] },
              { label: "없음", items: ["RRSHID"] },
            ],
          },
          labels: [],
        },
      });
    beats[4] = sets(["LHID", "DHID"]);
    expect(literalFindings(plan(beats), analysis)).toEqual([]);
    beats[4] = sets(["LHID", "DHID", "SateHaze1K"]);
    expect(literalFindings(plan(beats), analysis)).toEqual([
      expect.stringMatching(
        /puts "SateHaze1K" in its first set, which holds what the source shows results for/,
      ),
    ]);
    beats[4] = sets(["LHID", "다른 센서"]);
    expect(literalFindings(plan(beats), analysis).join("\n")).toMatch(
      /holds "다른 센서", which the source never names/,
    );
  });

  it("draws a word form at most once a deck, and never the same scene twice in a row", () => {
    const beats = covered();
    const sets = (id: string, part: string, cite: string) =>
      beatOf(id, part, [cite], {
        literal: {
          kind: "place",
          form: "sets",
          sets: {
            rings: [
              { label: "수치", items: ["LHID"] },
              { label: "없음", items: ["RRSHID"] },
            ],
          },
          labels: [],
        },
      });
    beats[4] = sets("b04-setup", "experiments", "sec6");
    beats[7] = sets("b07-limits", "limits", "sec11");
    expect(literalFindings(plan(beats), analysis)).toEqual([
      expect.stringMatching(/draws `place sets` 2 times \(b04-setup, b07-limits\)/),
    ]);
    const again = covered();
    again[2] = beatOf("b02-prior", "prior-work", ["sec3"], { literal: OPERATE });
    again[3] = beatOf("b03-method", "method", ["sec4"], { literal: OPERATE });
    expect(literalFindings(plan(again), analysis).join("\n")).toMatch(
      /b03-method draws the same scene as b02-prior \(operate b01-problem\)/,
    );
  });

  it("refuses a number in a literal label that the source never states", () => {
    const beats = covered();
    beats[5] = beatOf("b05-results", "experiments", ["sec7"], {
      literal: {
        kind: "table",
        columns: ["PSNR"],
        rows: [["30.56"]],
        labels: [{ slot: "caption", text: "30.56 vs 41.7" }],
      },
    });
    const found = literalFindings(plan(beats), analysis);
    expect(found).toContainEqual(
      expect.stringMatching(/says "41.7", which the source never states/),
    );
    expect(found.join("\n")).not.toMatch(/"30.56"/);
  });

  it("matches whole numbers, not substrings, in every word a scene shows", () => {
    const beats = covered();
    beats[5] = beatOf("b05-results", "experiments", ["sec7"], {
      literal: {
        kind: "place",
        form: "strip",
        measure: "length",
        // "0.91" and "30.5" are inside "0.9106" and "30.56"; "1/8" is no "1" and "8".
        lengths: {
          groups: [
            { label: "1/8 크기", unit: "dB", items: [{ label: "EM-SNN 0.91", value: "30.56" }] },
          ],
        },
        labels: [{ slot: "caption", text: "30.5 · LHID에서" }],
      },
    });
    const found = literalFindings(plan(beats), analysis).join("\n");
    for (const n of ["0.91", "30.5", "1/8"]) expect(found).toContain(`"${n}"`);
    beats[5] = beatOf("b05-results", "experiments", ["sec7"], {
      literal: { kind: "table", columns: ["RICE1"], rows: [["30.56"]], labels: [] },
    });
    expect(literalFindings(plan(beats), analysis).join("\n")).not.toMatch(/says/);
  });

  it("refuses a slot the kind does not have and a required one missing", () => {
    const beats = covered();
    beats[3] = beatOf("b03-method", "method", ["sec4"], {
      literal: {
        ...OPERATE,
        labels: [...OPERATE.labels.filter((l) => l.slot !== "output"), { slot: "gain", text: "x" }],
      },
    });
    const found = literalFindings(plan(beats), analysis).join("\n");
    expect(found).toMatch(/operate scene has no slot "gain"/);
    expect(found).toMatch(/needs slot "output"/);
  });

  it("refuses a recap of a beat that is not an earlier literal scene, or one that left no picture", () => {
    const beats = covered();
    beats[8] = beatOf("b08-summary", "summary", ["sec10"], {
      literal: { kind: "recap", beats: ["b04-setup"] },
    });
    expect(literalFindings(plan(beats), analysis)).toEqual([
      expect.stringMatching(/recap names "b04-setup"/),
    ]);
    beats[8] = beatOf("b08-summary", "summary", ["sec10"], {
      literal: { kind: "recap", beats: ["b01-problem", "b05-results"] },
    });
    expect(literalFindings(plan(beats), analysis)).toEqual([
      expect.stringMatching(/recap names "b05-results", a table scene, which leaves no picture/),
    ]);
  });

  it("asks for a takeaway on every beat but the title, only when asked to", () => {
    const beats = covered();
    beats[2] = { ...(beats[2] as object), takeaway: " " } as never;
    expect(literalFindings(plan(beats), analysis)).toEqual([]);
    expect(literalFindings(plan(beats), analysis, { takeaways: true })).toEqual([
      expect.stringMatching(/Beats b02-prior carry no `takeaway`/),
    ]);
  });
});

describe("the truth gate grounds every number in its role", () => {
  const text = (s: typeof analysis) =>
    s.sections
      .map((x) =>
        x.text
          .replace(
            /\\(alpha|beta|mu)\b/g,
            (_, g: string) => ({ alpha: "α", beta: "β", mu: "μ" })[g] as string,
          )
          .replace(/\{=\}/g, "=")
          .replace(/[{}$]/g, ""),
      )
      .join("\n\n");
  const T = text(analysis);
  const THRESH = /threshold|임계|閾値|阈值/i;
  const SIGMA = /σ|sigma|standard deviation|표준편차/i;
  const SCALE = /scal|factor|proportional|비례|스케일|계수/i;

  it("refuses a value the source binds to another symbol: β is never a threshold, μ is never a σ", () => {
    // A's own paragraph holds "임계값 이하의 막 동역학" and "β=0.25, μ=0.9" together.
    expect(paramProblem("0.25", undefined, THRESH, "threshold", T)).toMatch(
      /printed only as β=0.25/,
    );
    expect(paramProblem("0.25", "β", THRESH, "threshold", T)).toMatch(/never as the threshold/);
    expect(paramProblem("0.9", undefined, SIGMA, "σ", T)).toMatch(/printed only as μ=0.9/);
    expect(paramProblem("0.9", "μ", SIGMA, "σ", T)).toMatch(/never as the σ/);
  });

  it("accepts a value bound to its symbol when the symbol stands beside the role's name", () => {
    expect(paramProblem("0.6", "α", SCALE, "the threshold scale", T)).toBeUndefined();
    expect(paramProblem("0.6", "alpha", SCALE, "the threshold scale", T)).toBeUndefined();
    expect(paramProblem("0.9", "μ", /momentum|모멘텀|EMA/i, "the momentum", T)).toBeUndefined();
    // A bare value is grounded by its own place: "배치 크기 4".
    expect(paramProblem("4", undefined, /batch|배치/i, "the batch", T)).toBeUndefined();
    expect(paramProblem("7", undefined, THRESH, "θ", T)).toMatch(/not stated/);
  });

  it("refuses those two cases end to end, as a planned operate step", () => {
    const beats = covered();
    const step = (o: Record<string, unknown>) =>
      beatOf("b03-method", "method", ["sec4"], {
        literal: {
          ...OPERATE,
          chain: [{ op: "channels", how: "mean", params: [], label: "채널 평균" }, o],
        },
      });
    beats[3] = step({
      op: "threshold",
      how: "binary",
      params: [{ name: "theta", value: "0.25" }],
      label: "임계값",
    });
    expect(literalFindings(plan(beats), analysis).join("\n")).toMatch(
      /step 2 \(threshold binary\): the threshold θ 0.25 is printed only as β=0.25/,
    );
    beats[3] = step({
      op: "conv",
      how: "gaussian",
      params: [{ name: "sigma", value: "0.9", symbol: "μ" }],
      label: "블러",
    });
    const found = literalFindings(plan(beats), analysis).join("\n");
    expect(found).toMatch(
      /step 2 \(conv gaussian\): the source never names this operation|the Gaussian's σ 0.9 is printed, but never as/,
    );
  });

  it("accepts the stated chain: channel mean, fixed Sobel, absolute sum, normalised by the spatial mean", () => {
    expect(literalFindings(plan(covered()), analysis)).toEqual([]);
  });

  it("refuses a variant the source never names: the threshold scales with the variance, not the std", () => {
    const beats = covered();
    const rule = (stat: string) =>
      beatOf("b03-method", "method", ["sec4"], {
        literal: {
          ...OPERATE,
          chain: [
            { op: "channels", how: "mean", params: [], label: "채널 평균" },
            {
              op: "threshold",
              how: "binary",
              stat,
              over: "channel",
              params: [{ name: "scale", value: "0.6", symbol: "α" }],
              label: "채널별 임계값",
            },
          ],
        },
      });
    beats[3] = rule("var");
    expect(literalFindings(plan(beats), analysis).join("\n")).not.toMatch(/stat/);
    beats[3] = rule("std");
    expect(literalFindings(plan(beats), analysis).join("\n")).toMatch(
      /says the standard deviation \(`stat` std\)/,
    );
  });

  it("refuses a quantiser whose rounding the source does not state", () => {
    const beats = covered();
    beats[3] = beatOf("b03-method", "method", ["sec4"], {
      literal: {
        ...OPERATE,
        chain: [
          { op: "channels", how: "mean", params: [], label: "채널 평균" },
          {
            op: "quantize",
            how: "floor",
            params: [
              { name: "levels", value: "4", symbol: "D" },
              { name: "step", value: "0.6", symbol: "α" },
            ],
            label: "양자화",
          },
        ],
      },
    });
    expect(literalFindings(plan(beats), analysis).join("\n")).toMatch(
      /step 2 \(quantize floor\): no passage that names the operation says rounded down/,
    );
  });

  it("asks for the example tag on a picture, and refuses a computed value printed on it", () => {
    const beats = covered();
    beats[1] = {
      ...(beats[1] as object),
      literal: { ...OPERATE, labels: OPERATE.labels.filter((l) => l.slot !== "example") },
    } as never;
    expect(literalFindings(plan(beats), analysis).join("\n")).toMatch(
      /runs on example material .* needs the `example` slot/,
    );
    beats[1] = {
      ...(beats[1] as object),
      literal: {
        ...OPERATE,
        labels: OPERATE.labels.map((l) =>
          l.slot === "output" ? { ...l, text: "구조 맵 (최대 {max})" } : l,
        ),
      },
    } as never;
    expect(literalFindings(plan(beats), analysis).join("\n")).toMatch(
      /prints a computed value \(output\) on example material/,
    );
    beats[1] = {
      ...(beats[1] as object),
      literal: { ...OPERATE, labels: OPERATE.labels.filter((l) => l.slot !== "caption") },
    } as never;
    expect(literalFindings(plan(beats), analysis).join("\n")).toMatch(/give `caption`/);
  });

  it("refuses a learned stage that shows a computed layer, and an un-own figure", () => {
    const beats = covered();
    beats[3] = beatOf("b03-method", "method", ["sec4"], {
      literal: {
        kind: "flow",
        form: "chain",
        stages: [
          { id: "a", label: "입력", learned: false },
          { id: "b", label: "인코더", learned: true, show: "b01-problem" },
          { id: "c", label: "그림", learned: false, figure: "gen-b02" },
        ],
        labels: [
          { slot: "learned", text: "학습됨" },
          { slot: "example", text: "예시" },
        ],
      },
    });
    const found = literalFindings(plan(beats), analysis).join("\n");
    expect(found).toMatch(/stage "인코더" is learned and shows a computed layer/);
    expect(found).toMatch(/shows figure "gen-b02", which is not one of the source's own figures/);
  });
});

describe("a formula is grounded by every row of the table its checks cite", () => {
  const paper = sourceSchema.parse({
    id: "sd",
    title: "Fast decoding",
    lang: "en",
    sections: [
      {
        id: "s1",
        depth: 1,
        heading: "Choosing gamma",
        text: "Table 1: The total number of arithmetic operations and the inference speed vs the baseline, assuming c=0. α γ Operations Speed 0.6 2 1.53X 1.96X 0.7 3 1.58X 2.53X 0.8 2 1.23X 2.44X 0.8 5 1.63X 3.69X 0.9 2 1.11X 2.71X 0.9 10 1.60X 6.86X",
      },
      {
        id: "s2",
        depth: 1,
        heading: "Predictions",
        text: "Table 4: Expected improvement factor (Exp) vs. empirically measured improvement factor (Emp). Task Mq Temp γ α c Exp Emp EnDe Small 0 7 0.75 0.02 3.2 3.4 EnDe Base 0 7 0.8 0.04 3.3 2.8 EnDe Large 0 7 0.82 0.11 2.5 1.7 EnDe Small 1 7 0.62 0.02 2.3 2.6 EnDe Base 1 5 0.68 0.04 2.4 2.4 EnDe Large 1 3 0.71 0.11 2.0 1.4 Sum Small 0 5 0.65 0.02 2.4 3.1 Sum Base 0 5 0.73 0.04 2.6 3.0 Sum Large 0 3 0.74 0.11 2.0 2.2 Sum Small 1 5 0.53 0.02 1.9 2.3 Sum Base 1 3 0.55 0.04 1.8 2.2 Sum Large 1 3 0.56 0.11 1.6 1.7",
      },
    ],
    figures: [],
    equations: [],
    tables: [],
  });
  const ps = paper.sections.map((s) => s.text);
  const row = (a: string, g: string, out: string) => ({
    inputs: [
      { name: "α", value: a },
      { name: "γ", value: g },
    ],
    output: out,
  });
  const E1 = "(1 - α^(γ+1)) / (1 - α)";

  it("Eq. 1 reproduces Table 1 from two of its rows, and every other row of it", () => {
    expect(
      formulaProblems(E1, [row("0.6", "2", "1.96"), row("0.8", "5", "3.69")], [], "", ps),
    ).toEqual([]);
  });

  it("a wrong exponent fails on the table's other rows even where the cited rows let it through", () => {
    const found = formulaProblems(
      "(1 - α^γ) / (1 - α)",
      [row("0.8", "5", "3.69"), row("0.9", "10", "6.86")],
      [],
      "",
      ps,
    );
    expect(found.join("\n")).toMatch(
      /the row 0.6, 2, 1.96 of the table its checks come from does not fit/,
    );
  });

  it("one check is not enough, and a variable that never varies proves nothing", () => {
    expect(formulaProblems(E1, [row("0.6", "2", "1.96")], [], "", ps)[0]).toMatch(
      /two checks or more/,
    );
    expect(
      formulaProblems(E1, [row("0.6", "2", "1.96"), row("0.8", "2", "2.44")], [], "", ps).join(
        "\n",
      ),
    ).toMatch(/γ takes one value/);
  });

  it("Theorem 3.8 holds on all twelve rows of Table 4 under interval arithmetic, rounded inputs and all", () => {
    const T38 = "(1 - α^(γ+1)) / ((1 - α) * (γ*c + 1))";
    const r = (g: string, a: string, c: string, out: string) => ({
      inputs: [
        { name: "γ", value: g },
        { name: "α", value: a },
        { name: "c", value: c },
      ],
      output: out,
    });
    expect(
      formulaProblems(
        T38,
        [
          r("7", "0.75", "0.02", "3.2"),
          r("7", "0.8", "0.04", "3.3"),
          r("5", "0.68", "0.04", "2.4"),
        ],
        [],
        "",
        ps,
      ),
    ).toEqual([]);
  });

  it("checks printed nowhere together are refused", () => {
    expect(
      formulaProblems(E1, [row("0.6", "2", "1.96"), row("0.7", "2", "2.19")], [], "", ps).join(
        "\n",
      ),
    ).toMatch(/not printed together/);
  });
});

describe("what the planner is shown", () => {
  const v2 = prefsSchema.parse({ design: "v2" });
  const classic = prefsSchema.parse({});

  it("offers `part` only for a source with parts, and `takeaway`/`literal` only when scenes are drawn", () => {
    expect(JSON.stringify(schemaFor(classic, analysis))).toContain('"part"');
    expect(JSON.stringify(schemaFor(classic))).not.toContain('"part"');
    expect(JSON.stringify(schemaFor(classic, analysis))).not.toContain('"takeaway"');
    expect(JSON.stringify(schemaFor(classic, analysis))).not.toContain('"literal"');
    const json = JSON.stringify(schemaFor(v2, analysis));
    for (const k of LITERAL_KIND_NAMES) expect(json).toContain(`"${k}"`);
    expect(json).toContain('"takeaway"');
  });

  it("names every part with its sections, in deck order, and documents every literal kind", () => {
    const block = sourceBlocks(analysis, v2);
    const at = (s: string) => block.indexOf(s);
    expect(at("SECTION COVERAGE")).toBeGreaterThan(-1);
    expect(at("[section sec11]")).toBeLessThan(at("[section sec10]"));
    expect(at("  intro")).toBeLessThan(at("  prior-work"));
    expect(Object.keys(LITERAL_KIND_DOCS).sort()).toEqual([...LITERAL_KIND_NAMES].sort());
    for (const k of LITERAL_KIND_NAMES) expect(block).toContain(`  ${k} `);
    // The slots and the op library are listed from the tables the build and the gate read.
    expect(block).toContain("· output (required, may name {max}, {sum}, {mean})");
    for (const op of Object.keys(LITERAL_OPS)) expect(block).toContain(`  ${op} `);
    expect(block).toContain("THE GROUNDING LADDER");
    expect(sourceBlocks(analysis, classic)).not.toContain("LITERAL SCENES");
  });
});

describe("codexPlanner coverage repair", () => {
  const body = (beats: unknown[]) => JSON.stringify({ sourceId: "emsnn", title: "EM-SNN", beats });
  const missing = covered().filter((b) => b.id !== "b02-prior");
  // Variety is not what this tests: a short deck under no picture rules.
  const prefs = prefsSchema.parse({ slides: 5 });

  it("sends a plan missing a part back once, naming it, and keeps a repair that adds it", async () => {
    const prompts: string[] = [];
    const result = await codexPlanner(analysis, {
      prefs,
      run: async ({ prompt, outPath }) => {
        prompts.push(prompt);
        await writeFile(outPath, body(prompts.length === 1 ? missing : covered()));
      },
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("SECTION COVERAGE");
    expect(prompts[1]).toContain("DOES NOT COVER THE SOURCE");
    expect(prompts[1]).toMatch(/prior work \(\[section sec3\]/);
    expect(prompts[1]).not.toContain("BREAKS THE VARIETY RULES");
    expect(result.beats.map((b) => b.part ?? "-")).toContain("prior-work");
  });

  it("fails loudly when the repair still misses it", async () => {
    let calls = 0;
    await expect(
      codexPlanner(analysis, {
        prefs,
        run: async ({ outPath }) => {
          calls++;
          await writeFile(outPath, body(missing));
        },
      }),
    ).rejects.toThrow(/does not cover the source .* after one repair:\n.*prior work/s);
    expect(calls).toBe(2);
  });
});
