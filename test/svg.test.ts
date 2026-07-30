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

  // The 3.6px near-miss in line-chart is the reason this module exists. A figure
  // run is uniformly tabular, so it must clear the 0.58/char that sized that pad;
  // capitals must clear the 0.68 average the same emitter used for axis labels.
  it("clears the em-factors the archetypes used to guess", () => {
    for (const v of ["1.592", "32.13", "28.970", "0.930"]) {
      expect(textWidth(v, 40)).toBeGreaterThanOrEqual(v.length * 40 * 0.58);
    }
    for (const l of ["METHOD", "PARAMS", "SET5"]) {
      expect(textWidth(l, 40)).toBeGreaterThanOrEqual(l.length * 40 * 0.68);
    }
    expect(textWidth("MMMM", 40)).toBeGreaterThan(textWidth("iiii", 40));
  });

  it("treats bold as wider and CJK as full width", () => {
    expect(textWidth("Params", 40, 700)).toBeGreaterThan(textWidth("Params", 40, 400));
    expect(textWidth("복원", 40)).toBeGreaterThanOrEqual(2 * 40);
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
