import { describe, expect, it } from "vitest";
import { repairTex, texError } from "../src/emit/tex.js";

describe("texError", () => {
  it("is null for TeX the deck's KaTeX parses, under the deck's own options", () => {
    expect(texError("\\htmlClass{term t-a}{x} = y", true)).toBeNull();
  });

  it("is KaTeX's own message when it does not", () => {
    expect(texError("a \\right)", true)).toMatch(
      /KaTeX parse error: Expected 'EOF', got '\\right'/,
    );
  });
});

describe("repairTex", () => {
  it("leaves TeX that parses exactly as it is, and says nothing", () => {
    const tex = "\\left\\| x \\right\\|_2";
    expect(repairTex(tex, true)).toEqual({ tex, repairs: [], error: null });
  });

  it("closes a \\left with an invisible \\right., keeping the delimiter that was written", () => {
    const r = repairTex("f = \\left( a + b", true);
    expect(r.error).toBeNull();
    expect(r.tex).toBe("f = \\left( a + b \\right.");
    expect(r.repairs).toEqual([
      "1 \\left against 0 \\right: added 1 invisible \\right. to balance them",
    ]);
  });

  it("opens a stray \\right with an invisible \\left.", () => {
    const r = repairTex("a + b \\right) = c", true);
    expect(r.error).toBeNull();
    expect(r.tex).toBe("\\left. a + b \\right) = c");
  });

  it("does not count \\leftarrow or \\rightarrow as delimiters", () => {
    const r = repairTex("x \\rightarrow y, \\left( z", true);
    expect(r.error).toBeNull();
    expect(r.tex).toBe("x \\rightarrow y, \\left( z \\right.");
  });

  it("closes an unclosed brace group at the end", () => {
    const r = repairTex("\\frac{a}{b", true);
    expect(r.error).toBeNull();
    expect(r.tex).toBe("\\frac{a}{b}");
  });

  it("removes the anchors that draw nothing", () => {
    const r = repairTex("\\label{eq:loss} L = x \\nonumber", true);
    expect(r.error).toBeNull();
    expect(r.tex).toBe("L = x");
    expect(r.repairs).toEqual(["removed \\label{eq:loss}, \\nonumber, which draw nothing"]);
  });

  // HypePaper deck b316326c (2026-10-06): the paper's `\newcommand`s never reach
  // the source, and the deck died at verify on `\raydir`.
  it("draws a paper's undefined macros as their names, every occurrence, and names them", () => {
    const r = repairTex("\\raydir = \\camerarot \\cameraint^{-1} \\pixelcoord. \\raydir", true);
    expect(r.error).toBeNull();
    expect(r.tex).toBe(
      "\\operatorname{raydir} = \\operatorname{camerarot} \\operatorname{cameraint}^{-1} \\operatorname{pixelcoord}. \\operatorname{raydir}",
    );
    expect(r.repairs).toEqual([
      "\\raydir, \\camerarot, \\cameraint, \\pixelcoord are never defined in the source — drawn as their names in upright type",
    ]);
  });

  it("does not touch a longer name that merely starts with an undefined one", () => {
    expect(repairTex("\\foo + \\alpha", true).tex).toBe("\\operatorname{foo} + \\alpha");
  });

  it("returns KaTeX's reason when no repair makes it parse, rather than guessing", () => {
    const r = repairTex("x^a^b", true);
    expect(r.error).toMatch(/Double superscript/);
    expect(r.repairs).toEqual([]);
  });

  it("is deterministic, so plan reports the repair build will make", () => {
    const tex = "\\left( \\foo{x}";
    expect(repairTex(tex, true)).toEqual(repairTex(tex, true));
  });
});
