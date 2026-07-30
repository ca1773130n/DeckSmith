import { describe, expect, it } from "vitest";
import { mathy } from "../src/emit/kit.js";

describe("mathy", () => {
  // The column names of a real markdown table, which reached the slide as
  // literal "PSNR$_{\mathrm{RGB}}$" because everything went through esc().
  it.each([
    ["$T$", '<span class="ds-tex">T</span>'],
    ["PSNR$_{\\mathrm{RGB}}$", 'PSNR<span class="ds-tex">_{\\mathrm{RGB}}</span>'],
    ["$x$ vs $y$", '<span class="ds-tex">x</span> vs <span class="ds-tex">y</span>'],
  ])("marks %s", (raw, want) => {
    expect(mathy(raw)).toBe(want);
  });

  it.each(["L1", "0.0386", "plain text", "28.91"])("leaves %s alone", (raw) => {
    expect(mathy(raw)).toBe(raw);
  });

  // A bare $ is money far more often than maths. Getting this wrong turns a
  // price list into a rendering error, which is worse than showing a dollar sign.
  it("does not treat currency as maths", () => {
    expect(mathy("Costs $5 and $10 total")).toBe("Costs $5 and $10 total");
  });

  it("still escapes the prose around the maths", () => {
    expect(mathy("a < b and $x_1$")).toBe('a &lt; b and <span class="ds-tex">x_1</span>');
  });

  it("escapes the tex it marks, so a span cannot close its own tag", () => {
    expect(mathy("$a</span>_1$")).not.toContain("</span>_1");
  });
});
