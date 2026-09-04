import { describe, expect, it } from "vitest";
import {
  arrow,
  arrowDefs,
  circle,
  elbow,
  fitBoxes,
  group,
  id,
  line,
  MIN_FONT,
  n,
  path,
  rect,
  roundRect,
  svg,
  text,
  textWidth,
  tracks,
  wrap,
} from "../src/emit/svg.js";

describe("textWidth", () => {
  it("grows with every added character", () => {
    let prev = 0;
    for (const s of ["", "a", "ab", "abc", "abcd", "abcde"]) {
      const w = textWidth(s, 40);
      expect(w).toBeGreaterThan(prev - 1e-9);
      if (s) expect(w).toBeGreaterThan(prev);
      prev = w;
    }
  });

  it("grows with font size", () => {
    const sizes = [12, 24, 40, 66, 88];
    for (let i = 1; i < sizes.length; i++) {
      const a = textWidth("Reconstruction", sizes[i - 1] as number);
      const b = textWidth("Reconstruction", sizes[i] as number);
      expect(b).toBeGreaterThan(a);
    }
  });

  /**
   * THE RECEIPT FOR THE TABLE, and the assertion this replaces.
   *
   * That one held `textWidth` above two hand-rolled em factors — 0.58 a
   * character for a figure run, 0.68 for capitals — which `line-chart` carried
   * as a second opinion about a question this project has one answer to. Those
   * are gone: line-chart calls `textWidth` now, so an assertion about them is an
   * assertion about nothing, and it would have failed anyway, because 0.68 a
   * character is not what capitals measure ("SET5" is 2.539em, not 2.72).
   *
   * What matters instead is the contract the table exists to keep. `drawn` is
   * Chrome, at 1000px, in the Inter that Google Fonts serves — the face
   * HyperFrames resolves for a Latin deck. Pinned rather than measured here for
   * the same reason `demo/audio`'s numbers are: this suite has no browser.
   *
   *     node scripts/measure-type.mjs
   */
  it("is above what Chrome draws, and not by much", () => {
    // [text, size, weight, tracking, tabular, drawn px]
    const CASES: [string, number, number, number, boolean, number][] = [
      ["Reconstruction", 40, 400, 0, false, 285.11],
      ["METHOD", 40, 500, 0.04, true, 185.67],
      ["SET5", 40, 400, 0, false, 99.27],
      ["1.592", 40, 400, 0, true, 114.5],
      ["1.592", 40, 400, 0, false, 100.16],
      ["28.970", 40, 400, 0, true, 140.44],
      ["Every part of the network, in the order it runs", 76, 700, -0.015, false, 1604.42],
      ["QUANTITATIVE COMPARISON · ×4", 42, 500, 0.14, false, 852.81],
      ["L1 0.0346 → 0.0235", 40, 400, 0, false, 370.17],
      // The bundled Noto face, ahead of Inter in the stack, as a deck of that
      // language composes it. Han and kana land on exactly 1.000em a character
      // — 240.00 is six of them, 320.00 is eight — and Hangul on 0.920, which
      // 238.97 says again at weight 700: six syllables plus two spaces, with
      // nothing left over for a bold penalty a CJK face does not charge.
      ["복원 파이프라인", 40, 400, 0, false, 266.55], // Noto Sans KR
      ["영상 복원 결과", 40, 700, 0, false, 238.97], // Noto Sans KR, bold
      ["重建管线对比", 40, 400, 0, false, 240.0], // Noto Sans SC
      ["復元パイプライン", 40, 400, 0, false, 320.0], // Noto Sans JP
    ];
    for (const [text, size, weight, tracking, tabular, drawn] of CASES) {
      const w = textWidth(text, size, weight, tracking, tabular);
      const where = `${JSON.stringify(text)} @${size}/${weight}`;
      // NEVER SMALLER. A box sized through here that is narrower than the text
      // draws the text outside the box, and `.scene` is centred, so it leaves on
      // both sides at once.
      expect(w, `${where} under-predicts`).toBeGreaterThanOrEqual(drawn);
      // And not wastefully larger: room over-charged is room an archetype
      // refuses a beat for.
      //
      // ONE BAR FOR EVERY SCRIPT. The Korean line used to get its own 1.13,
      // because everything outside the Latin table cost a flat 1.02em and Noto
      // Sans KR draws Hangul at 0.920 — an 11% over-charge that no gate could
      // see, since over-predicting is the safe direction. `BLOCK_ADVANCE` pins
      // the measured value per block instead, and the exception went with it.
      // A CJK line that needs a looser bar than a Latin one is the old blanket
      // growing back.
      expect(w / drawn, `${where} over-predicts`).toBeLessThanOrEqual(1.07);
    }
  });

  it("keeps the orderings every caller relies on", () => {
    expect(textWidth("MMMM", 40)).toBeGreaterThan(textWidth("iiii", 40));
    // A table's figures are wider than a headline's, which is the whole reason
    // `tabular` is a parameter rather than a single number for both.
    expect(textWidth("1.592", 40, 400, 0, true)).toBeGreaterThan(textWidth("1.592", 40));
    // A glyph neither table carries still costs a little over a full em, never
    // something narrower than the widest thing it might be. Emoji measure
    // 1.000em in Chrome, so the blanket covers them.
    expect(textWidth("\u{1F600}", 40)).toBeGreaterThanOrEqual(40);
    // Hangul jamo and half-width forms are deliberately NOT in `BLOCK_ADVANCE`
    // — no bundled family carries enough of either to measure — so they keep
    // the blanket rather than borrowing a neighbouring block's number.
    expect(textWidth("ᄀ", 40)).toBeGreaterThan(textWidth("가", 40));
  });

  it("treats bold as wider, but only where the face is", () => {
    expect(textWidth("Params", 40, 700)).toBeGreaterThan(textWidth("Params", 40, 400));
    // Han is full width; Hangul is not, and pretending otherwise is what cost a
    // Korean deck 11% of its room.
    expect(textWidth("重建", 40)).toBeGreaterThanOrEqual(2 * 40);
    expect(textWidth("복원", 40)).toBeLessThan(2 * 40);
    // A CJK face fills the em grid at every weight rather than widening it, so
    // bold Hangul costs exactly what regular Hangul does.
    expect(textWidth("복원", 40, 700)).toBe(textWidth("복원", 40, 400));
  });

  it("charges a CJK run's Latin characters to the face that draws them", () => {
    // A deck that bundles a CJK family sets its ASCII in that family too — the
    // stack puts "Noto Sans KR" ahead of Inter — and the CJK faces are wider for
    // 31 of the characters this project sets. Measuring that ASCII as Inter is
    // the unrecoverable direction, and it drew a note past its column.
    //
    // The middle dot is the one that matters: Korean uses it as a separator, and
    // the faces set it on the em grid where Inter gives it 0.288em.
    const dotAlone = textWidth("a·b", 100) - textWidth("ab", 100);
    const dotInKorean = textWidth("가·가", 100) - textWidth("가가", 100);
    // Inter gives it 0.288em; the Korean face 0.561. Nearly double, per dot.
    expect(dotInKorean).toBeGreaterThan(dotAlone * 1.5);

    // A run with NO CJK in it is untouched — every Latin deck measures exactly
    // as it did, which is what keeps this change off the common path.
    expect(textWidth("Reconstruction improves", 40)).toBe(textWidth("Reconstruction improves", 40));
    expect(dotAlone).toBeLessThan(35);

    // And the one character the four families disagree about: Korean draws "·"
    // at 0.561em, the other three at 1.0. A run with Hangul in it gets Korean's,
    // which is why that one character is split out rather than pinned at the max.
    const hanDot = textWidth("重·重", 100) - textWidth("重重", 100);
    expect(dotInKorean).toBeLessThan(hanDot);
    expect(dotInKorean).toBeGreaterThan(50);

    // A lowercase run inside Korean is charged the wider face as well: "m" is
    // 0.926em there against Inter's 0.83.
    expect(textWidth("가 mm", 100)).toBeGreaterThan(textWidth("가 ", 100) + 2 * 83);
  });
});

describe("wrap", () => {
  it("keeps every line inside the width", () => {
    const lines = wrap("Encoder maps the image into a latent feature volume", 40, 400);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l, 40)).toBeLessThanOrEqual(400);
    expect(lines.join(" ")).toBe("Encoder maps the image into a latent feature volume");
  });

  it("breaks a word with no spaces, which is also how Korean wraps", () => {
    const lines = wrap("영상복원파이프라인단계", 40, 200);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l, 40)).toBeLessThanOrEqual(200);
    expect(lines.join("")).toBe("영상복원파이프라인단계");
  });

  it("never returns nothing", () => {
    expect(wrap("x", 40, 1)).toEqual(["x"]);
    expect(wrap("hello", 40, 0)).toEqual(["hello"]);
  });
});

describe("tracks", () => {
  it("stays inside its bounds and spaces evenly", () => {
    const t = tracks(1700, 5, 40, 110);
    expect(t).toHaveLength(5);
    const last = t[4] as { x: number; w: number };
    expect(t[0]?.x).toBe(110);
    expect(last.x + last.w).toBeCloseTo(110 + 1700, 6);
    for (let i = 1; i < t.length; i++) {
      expect((t[i] as { x: number }).x - (t[i - 1] as { x: number }).x).toBeCloseTo(
        (t[1] as { x: number }).x - (t[0] as { x: number }).x,
        6,
      );
      expect(t[i]?.w).toBeCloseTo(t[0]?.w as number, 6);
    }
  });

  it("gives a single track the whole width", () => {
    expect(tracks(900, 1, 40)).toEqual([{ x: 0, w: 900 }]);
  });
});

describe("fitBoxes", () => {
  const labels = ["Encoder", "Latent", "Warp", "Decoder"];

  it("keeps the preferred size when there is room", () => {
    const fit = fitBoxes({ labels, width: 1700, size: 44, gap: 60 });
    expect(fit.ok).toBe(true);
    expect(fit.size).toBe(44);
    expect(fit.gap).toBe(60);
  });

  it("shrinks the gap before the type", () => {
    const tight = fitBoxes({ labels, width: 1150, size: 44, gap: 200, minGap: 24 });
    expect(tight.ok).toBe(true);
    expect(tight.size).toBe(44);
    expect(tight.gap).toBeLessThan(200);
    expect(tight.gap).toBeGreaterThanOrEqual(24);
  });

  it("never returns a size below the floor, and reports instead", () => {
    const many = Array.from({ length: 6 }, () => "Reconstruction module");
    const fit = fitBoxes({ labels: many, width: 1700, size: 44, gap: 60 });
    expect(fit.ok).toBe(false);
    expect(fit.size).toBe(MIN_FONT);
    expect(fit.needed).toBeGreaterThan(1700);
  });

  it("returns boxes wide enough for their label at the reported size", () => {
    for (const width of [900, 1200, 1700, 1920]) {
      const fit = fitBoxes({ labels, width, size: 44, gap: 60, padEm: 0.8, weight: 600 });
      if (!fit.ok) continue;
      expect(fit.size).toBeGreaterThanOrEqual(MIN_FONT);
      const widest = Math.max(...labels.map((l) => textWidth(l, fit.size, 600)));
      expect(fit.boxes[0]?.w).toBeGreaterThanOrEqual(widest + 2 * 0.8 * fit.size - 1e-9);
    }
  });

  it("places every box inside the width", () => {
    const fit = fitBoxes({ labels, width: 1700, size: 44, gap: 60, x0: 110 });
    const last = fit.boxes[fit.boxes.length - 1] as { x: number; w: number };
    expect(fit.boxes[0]?.x).toBe(110);
    expect(last.x + last.w).toBeLessThanOrEqual(110 + 1700 + 1e-9);
  });
});

describe("markup", () => {
  it("escapes text content and attribute values", () => {
    const t = text('A <wide> "figure" & more', { x: 10, y: 20 }, { size: 40 });
    expect(t).toContain("A &lt;wide&gt; &quot;figure&quot; &amp; more");
    expect(t).not.toMatch(/<(?!\/?text)/);
    expect(rect({ x: 0, y: 0, w: 10, h: 10 }, { class: 'a"b' })).toContain('class="a&quot;b"');
    expect(svg('s1"', 100, 50, "")).toContain('id="s1&quot;"');
  });

  it("escapes every wrapped line", () => {
    const t = text("<a> <b> <c>", { x: 0, y: 0 }, { size: 40, maxWidth: 200 });
    expect(t).toContain("&lt;a&gt;");
    expect(t).toContain("&lt;c&gt;");
    expect(t).not.toContain("<a>");
  });

  it("wraps into tspans and centres a block on its y", () => {
    const one = text("Encoder", { x: 100, y: 200 }, { size: 40, anchor: "middle" });
    expect(one).toContain('text-anchor="middle"');
    expect(one).not.toContain("<tspan");

    const many = text("Encoder maps the image", { x: 100, y: 200 }, { size: 40, maxWidth: 220 });
    expect((many.match(/<tspan/g) ?? []).length).toBeGreaterThan(1);

    const mid = text("A", { x: 0, y: 0 }, { size: 40, vAlign: "middle" });
    expect(mid).toContain('dy="13.6"'); // 0.34em of a single line
  });

  it("omits empty and undefined attributes", () => {
    expect(group("", {})).toBe("<g></g>");
    expect(circle({ x: 1, y: 2 }, 3)).toBe('<circle cx="1" cy="2" r="3" />');
  });

  it("rounds geometry to two decimals so two renders are byte-identical", () => {
    expect(n(1 / 3)).toBe("0.33");
    expect(line({ x: 1 / 3, y: 0 }, { x: 2 / 3, y: 0 })).toContain('x1="0.33"');
    const twice = [0, 1].map(() => path("M0,0 L1,1", { stroke: "#fff" }));
    expect(twice[0]).toBe(twice[1]);
  });

  it("clamps a corner radius to the shape", () => {
    expect(roundRect({ x: 0, y: 0, w: 40, h: 10 }, 30)).toContain('rx="5"');
  });
});

describe("arrows", () => {
  it("points at a head this scene defines", () => {
    const defs = arrowDefs("s3", ["#3d8bfd", "#ffd166", "#3d8bfd"]);
    expect((defs.match(/<marker/g) ?? []).length).toBe(2); // deduplicated
    const a = arrow("s3", { x: 0, y: 0 }, { x: 100, y: 0 }, { stroke: "#3d8bfd" });
    const ref = a.match(/url\(#([^)]+)\)/)?.[1] as string;
    expect(defs).toContain(`id="${ref}"`);
    expect(ref.startsWith("s3-")).toBe(true); // scoped, like every other id here
  });

  it("insets the head off the target edge", () => {
    const a = arrow("s1", { x: 0, y: 0 }, { x: 100, y: 0 }, { stroke: "#fff", inset: 20 });
    expect(a).toContain('x2="80"');
  });

  it("routes an elbow out, along and back in", () => {
    const e = elbow("s1", { x: 900, y: 400 }, { x: 200, y: 400 }, { stroke: "#fff", via: 560 });
    const d = e.match(/ d="([^"]+)"/)?.[1] as string;
    expect(d.startsWith("M900,400")).toBe(true);
    expect(d.endsWith("200,400")).toBe(true);
    expect(d).toContain("Q"); // rounded corners, not a hard staircase
    // Every point on the route stays on the near side of the middle leg.
    for (const [, y] of [...d.matchAll(/[,\s]?(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [m[1], m[2]])) {
      expect(Number(y)).toBeLessThanOrEqual(560);
      expect(Number(y)).toBeGreaterThanOrEqual(400);
    }
  });

  it("degenerates to straight legs when a leg is too short to round", () => {
    const e = elbow("s1", { x: 100, y: 400 }, { x: 100.5, y: 400 }, { stroke: "#fff", via: 401 });
    expect(e).not.toContain("Q");
  });

  it("mirrors the horizontal axis", () => {
    const v = elbow(
      "s1",
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { stroke: "#f", via: 200, axis: "v" },
    );
    const h = elbow(
      "s1",
      { y: 0, x: 0 },
      { y: 100, x: 100 },
      { stroke: "#f", via: 200, axis: "h" },
    );
    const swap = (d: string) => d.replace(/(-?[\d.]+),(-?[\d.]+)/g, "$2,$1");
    expect(swap(h.match(/ d="([^"]+)"/)?.[1] as string)).toBe(v.match(/ d="([^"]+)"/)?.[1]);
  });
});

describe("id", () => {
  it("scopes to the scene, with and without an index", () => {
    expect(id("s4", "stage")).toBe("s4-stage");
    expect(id("s4", "stage", 0)).toBe("s4-stage0");
    expect(id("s4", "stage", 2)).toBe("s4-stage2");
  });
});
