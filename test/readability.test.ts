/**
 * The content-extraction pass, and the two ways it can be wrong.
 *
 * Split the way test/harvest.test.ts is split, and for the same reason. The
 * second half needs a real Chrome, because the thing under test is a function
 * that only exists inside a page — there is no DOM in Node here and a hand-built
 * stand-in would be a fourth instrument that agrees with none of the other
 * three. CI installs no Chrome, so that half is skipped there.
 *
 * The first half runs on every push and guards the failure a browser would never
 * show: the pass is shipped into the page as `Function.prototype.toString()`
 * text, so a reference to anything in its own module compiles, typechecks, lints
 * and then throws `ReferenceError` in somebody's browser. That is checked here
 * against the source itself.
 *
 * The fixtures are real page SHAPES rather than real pages: a nav, a rail of
 * related links, a cookie banner and a comment thread around an article; a page
 * of undifferentiated divs; a tail of link text longer than the article beside
 * it; one column and no chrome at all. Each asserts on the extracted region AND
 * on the candidate report, so a failure names whether the strip, the score or
 * the link-density discount is what broke.
 */
import type { Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath } from "../src/render/capture.js";
import { CONTENT_MARKER, readContentRegion } from "../src/source/readability.js";

/* ------------------------------------------- What the page will be handed */

describe("the source that is shipped into the page", () => {
  const src = readContentRegion.toString();

  it("names nothing from the module it lives in", () => {
    // The exported constant is the one thing a reader would reach for, and
    // reaching for it is the bug: puppeteer sends the function's TEXT, not its
    // closure. The literal below is how the two are kept in step instead.
    expect(src).not.toContain("CONTENT_MARKER");
    expect(src).toContain(`"${CONTENT_MARKER}"`);
  });

  it("names nothing from Node", () => {
    // `node:` is only looked for inside a string, because `{ node: el }` is an
    // ordinary property name and the first version of this line failed on one.
    expect(src).not.toMatch(/\brequire\(|\bimport\s*[({]|\bprocess\.|["']node:/);
  });
});

/* ---------------------------------------------------- The pass, in a page */

/**
 * No Chrome, no pass — and no pretending otherwise, exactly as
 * test/harvest.test.ts does it. CI installs none, so these are skipped there.
 */
const chrome = await chromePath().catch(() => null);

describe.skipIf(chrome === null)("readContentRegion, in a real browser", () => {
  let browser: Browser;

  beforeAll(async () => {
    const { default: puppeteer } = await import("puppeteer-core");
    browser = await puppeteer.launch({
      executablePath: chrome as string,
      headless: true,
      args: [
        "--disable-background-networking",
        "--disable-extensions",
        "--no-default-browser-check",
        "--no-first-run",
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  /**
   * Run the pass over one page and read back both the report and the region.
   *
   * Requests are aborted the way `readInBrowser` aborts them, so these fixtures
   * are as offline as a harvest is — no fixture below names a subresource, and
   * this makes that true rather than assumed.
   */
  async function pick(body: string) {
    const page = await browser.newPage();
    try {
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        request.abort().catch(() => {});
      });
      await page.setContent(`<!doctype html><html><body>${body}</body></html>`, {
        waitUntil: "domcontentloaded",
      });
      const report = await page.evaluate(readContentRegion);
      const [text, tags] = await page.evaluate((marker: string) => {
        const el = document.querySelector(`[${marker}]`);
        return [
          (el?.textContent ?? "").replace(/\s+/g, " ").trim(),
          [...document.querySelectorAll("nav, section, div")].map((n) => n.tagName.toLowerCase()),
        ] as const;
      }, CONTENT_MARKER);
      return { report, text, tags };
    } finally {
      await page.close().catch(() => {});
    }
  }

  /** Prose with commas in it, which is half of what the paragraph score reads. */
  const prose = [
    "<p>Attention over a long context is quadratic, which is the whole problem, and the reason every practical system truncates.</p>",
    "<p>The method keeps a sparse set of keys per query, so the cost falls to linear in the sequence length, at a small accuracy cost.</p>",
    "<p>We compare against the dense baseline on four datasets, and report the wall-clock time as well as the perplexity, because one without the other is not a result.</p>",
    "<p>The remaining gap is concentrated in the long-document split, where the sparsity pattern has the least to work with, as expected.</p>",
  ].join("");

  it("keeps the article and drops the nav, the rail, the banner and the comments", async () => {
    const got = await pick(`
      <header class="site"><h1>The Lab</h1><nav><a href="/about">About the lab</a></nav></header>
      <div id="cookie-consent" role="dialog">
        <p>We use cookies to measure traffic and to personalise the advertising you are shown.</p>
        <button>Accept all cookies</button>
      </div>
      <div id="page">
        <div class="rail">
          <h3>Related reading from the lab</h3>
          <p><a href="/1">Another paper about attention, and what it means for long contexts</a></p>
          <p><a href="/2">A third paper about attention, sparsity, and the cost of a kernel</a></p>
          <p><a href="/3">A fourth paper about attention, from the same group a year later</a></p>
        </div>
        <article class="post"><h1>Sparse attention at scale</h1>${prose}</article>
        <section id="comments">
          <p>First! This is exactly what I have been saying for years, and nobody listened.</p>
          <p>Did the authors try the obvious ablation, or is that left to the reader again?</p>
        </section>
      </div>
      <footer>Copyright the lab</footer>`);

    expect(got.report.marked).toBe(true);
    expect(got.report.candidates[0]?.path).toContain("article.post");
    expect(got.text).toContain("The method keeps a sparse set of keys per query");
    expect(got.text).toContain("The remaining gap is concentrated");
    expect(got.text).not.toContain("About the lab");
    expect(got.text).not.toContain("Another paper about attention");
    expect(got.text).not.toContain("cookies");
    expect(got.text).not.toContain("nobody listened");
    expect(got.text).not.toContain("Copyright the lab");
  });

  it("strips the banner and the comment thread out of the document, not just out of the region", async () => {
    // The region test above would pass just as well if the banner sat beside the
    // article untouched. It must be GONE: harvest's own walker has no rule that
    // would drop a `<div role="dialog">`, so anything left behind reaches the
    // markdown the moment the region is wider than one element.
    const got = await pick(`
      <div id="cookie-consent" role="dialog"><p>We use cookies to measure traffic here.</p></div>
      <nav><a href="/about">About the lab</a></nav>
      <div id="page"><article class="post">${prose}</article>
        <section id="comments"><p>First! This is exactly what I have been saying for years.</p></section>
      </div>`);

    expect(got.report.stripped).toBeGreaterThanOrEqual(3);
    expect(got.tags).not.toContain("nav");
    expect(got.tags).not.toContain("section");
  });

  it("finds the content in a page of undifferentiated divs", async () => {
    const got = await pick(`
      <div id="shell">
        <div id="rail">
          <p><a href="/1">Another paper about attention, and what it means for long contexts</a></p>
          <p><a href="/2">A third paper about attention, sparsity, and the cost of a kernel</a></p>
          <p><a href="/3">A fourth paper about attention, from the same group a year later</a></p>
        </div>
        <div id="body"><h1>No main, no article</h1>${prose}</div>
      </div>`);

    expect(got.report.marked).toBe(true);
    expect(got.report.candidates[0]?.path).toContain("div#body");
    expect(got.text).toContain("The method keeps a sparse set of keys per query");
    expect(got.text).not.toContain("Another paper about attention");
  });

  it("loses to no tail of link text, however much longer than the article it is", async () => {
    // The tail wears a neutral id on purpose: no word list rescues this, and no
    // tag rule removes it. If this test fails, the LINK DENSITY term is what
    // broke — the tail holds more characters than the article does.
    const links = (n: number) =>
      `<p>${[1, 2, 3, 4, 5]
        .map(
          (i) =>
            `<a href="/t/${n}${i}">Everything we have ever published about attention and sparsity, part ${n}${i}</a>`,
        )
        .join(" &middot; ")}</p>`;
    const got = await pick(`
      <div id="wrap">
        <div id="story"><h1>Sparse attention at scale</h1>${prose}</div>
        <div id="tail">
          ${links(1)}${links(2)}${links(3)}${links(4)}
          <p>All content is provided as is, without warranty of any kind, express or implied.</p>
        </div>
      </div>`);

    const tail = got.report.candidates.find((c) => c.path.endsWith("div#tail"));
    const story = got.report.candidates.find((c) => c.path.endsWith("div#story"));
    expect(tail?.linkDensity).toBeGreaterThan(0.8);
    expect(story?.linkDensity).toBeLessThan(0.05);
    // The tail holds MORE text and still scores less. That is the discount.
    expect(tail?.text).toBeGreaterThan(story?.text ?? 0);
    expect(tail?.score).toBeLessThan(story?.score ?? 0);
    expect(got.text).toContain("The method keeps a sparse set of keys per query");
    expect(got.text).not.toContain("Everything we have ever published");
  });

  it("marks the body itself on a single column with no chrome at all", async () => {
    // Every paragraph's parent IS the body, so the body is where their score
    // lands and there is nothing narrower to choose. Marking it is the answer;
    // declining would be a different one, and would lose the strip.
    const got = await pick(`<h1>Sparse attention at scale</h1>${prose}`);

    expect(got.report.marked).toBe(true);
    expect(got.report.reason).toContain("<body>");
    expect(got.report.merged).toBe(0);
    expect(got.text).toContain("Attention over a long context is quadratic");
    expect(got.text).toContain("The remaining gap is concentrated");
  });

  it("merges the siblings that score close to the winner", async () => {
    // One article in three boxes is one article. Without the merge the region is
    // a third of the page and the deck is built from a third of the evidence,
    // with nothing anywhere saying so.
    const got = await pick(`
      <nav><a href="/about">About the lab</a></nav>
      <div class="chunk">${prose}</div>
      <div class="chunk"><p>The ablation removes the sparsity pattern, one head at a time, and measures what that costs on the long split.</p><p>Two heads carry most of it, which is a result about the data rather than about the method, and we say so.</p></div>`);

    expect(got.report.marked).toBe(true);
    expect(got.report.merged).toBeGreaterThanOrEqual(1);
    expect(got.text).toContain("The method keeps a sparse set of keys per query");
    expect(got.text).toContain("The ablation removes the sparsity pattern");
    expect(got.text).not.toContain("About the lab");
  });

  it("declines a page too thin to be sure of, and puts back everything it stripped", async () => {
    // Declining is not failing: harvest's own heuristic runs next, and it has to
    // run against the document it would have seen. A pass that stripped a nav
    // and then walked away would be editing the page for a decision it refused
    // to make.
    const got = await pick(`
      <nav><a href="/about">About the lab</a></nav>
      <div id="main"><p>Too short to be an article, by any measure.</p></div>`);

    expect(got.report.marked).toBe(false);
    expect(got.report.reason).toContain("250");
    expect(got.report.stripped).toBe(0);
    expect(got.text).toBe("");
    expect(got.tags).toContain("nav");
  });

  it("counts the media it lost rather than leaving it to be noticed later", async () => {
    // A clip that never reaches the markdown is a figure with no id, no section
    // and no mention — a demotion no gate reads. The number is reported so the
    // caller can warn; this pass does not get to decide that silently.
    const got = await pick(`
      <div id="page">
        <article class="post">${prose}</article>
        <div class="related-videos"><video src="promo.mp4"></video><p>More from the lab</p></div>
      </div>`);

    expect(got.report.marked).toBe(true);
    expect(got.report.mediaDropped).toBe(1);
  });
});
