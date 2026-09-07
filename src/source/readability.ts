/**
 * WHICH PART OF A PAGE IS THE ARTICLE — the Readability scoring algorithm,
 * implemented here rather than depended on.
 *
 * `src/source/harvest.ts` picks its content region with three rules: believe
 * `<main>`, believe `<article>`, else take the deepest element whose block text
 * minus its link text is maximal. Its own comment says that is deliberately not
 * a Readability implementation, and it holds up on the shapes it was written
 * against. It loses on the shapes it was not: a `<main>` that also wraps the
 * comment thread is believed whole and short-circuits before the loop ever runs;
 * a `<div role="dialog">` cookie banner matches nothing in the walker's SKIP set,
 * so it is neither scored down nor skipped; and the score counts text inside
 * `nav`/`aside`/`footer` subtrees that the walker will then throw away, so a
 * wrapper can be chosen on the strength of text that never reaches the markdown.
 *
 * This is Mozilla Readability's `grabArticle`, in the shape that fits here:
 * strip the elements whose tag, role, class or id say chrome; score every
 * paragraph by its length and its comma count; propagate that score to the
 * parent, the grandparent and up to five levels of ancestor, dividing as it
 * climbs; discount each candidate by its LINK DENSITY, which is the term that
 * tells a rail of headlines from prose; take the highest, climb to a parent that
 * scores higher still, then merge in the siblings that score close to it.
 *
 * WHAT THIS IS NOT. It is not a semantic understanding of the page. Nothing here
 * reads the article; it is arithmetic over text length, punctuation, and the
 * words site authors happen to put in class names. It is much better than one
 * subtraction and it is wrong in ways that are structural rather than accidental,
 * so they are worth naming:
 *
 *  - A PAGINATED ARTICLE harvests as page one and nothing says so. Readability
 *    proper follows "next page" links; this cannot, because `harvest` fetches
 *    exactly one document and every subresource is aborted.
 *  - A PAGE WHOSE CONTENT IS A LIST OF LINKS — a link blog, a search result, a
 *    documentation index — is scored down by the very term that makes the pass
 *    work. Link density cannot tell a nav from a page that is a nav on purpose.
 *  - A GALLERY loses. Pictures carry no text, `<li>` is not a scored tag, and a
 *    page of captioned images scores near zero everywhere, so the winner is
 *    whichever caption block happened to be longest.
 *  - CLASS NAMES ARE A GUESS, and the same word list that rescues
 *    `<div class="article-body">` rescues `<div class="comment-body">`.
 *  - AN ELEMENT THE STRIP REMOVES TAKES ITS `<video>` WITH IT. That matters more
 *    here than in a reader: harvest's poster is the join that lets `attachClips`
 *    keep a clip's id, section and mention, so a silently dropped player demotes
 *    a clip with every gate green. Hence `mediaDropped` in the report — this pass
 *    counts what it lost rather than leaving the caller to find out later.
 *
 * When it declines it says so, PUTS BACK EVERY NODE IT REMOVED, and changes
 * nothing else, so `harvest`'s own heuristic runs against the document it would
 * have seen. Declining is the retry Readability performs with its flags off;
 * here the simpler pass IS that retry, and it already exists.
 *
 * IT RUNS INSIDE THE PAGE. `harvest` ships code into the browser as a function
 * reference — `page.evaluate(readDom)` — which puppeteer serialises with
 * `Function.prototype.toString()` and evaluates as source text. `readContentRegion`
 * is shipped the same way and carries the same rule: it may not close over
 * anything in this module, so every constant and every helper it uses is declared
 * inside it, INCLUDING the marker attribute that `CONTENT_MARKER` below spells a
 * second time. A closed-over constant does not fail here, where a test would see
 * it; it fails in the page, as a `ReferenceError`, on somebody's ingest — so
 * test/readability.test.ts asserts the two spellings agree and that the source
 * names nothing from Node. The node bundle is built with `minify: false`
 * (scripts/build.mjs), which is what keeps the serialised text intact.
 */

/**
 * The attribute the pass puts on the region it chose.
 *
 * A marker rather than a return value because an `Element` cannot cross the
 * `page.evaluate` boundary — what comes back is structured-clone data. Marking
 * is also what lets this stay a second self-contained function beside `readDom`
 * rather than something `readDom` has to grow a second job for: the walker's
 * `pickRoot` need only look for this attribute first and keep its own three
 * rules as the fallback for when this pass declines.
 */
export const CONTENT_MARKER = "data-ds-content";

/** One element the scorer considered, in the terms it was judged on. */
export interface Candidate {
  /** Up to three levels, `div#page > div#content > article.post`, to name it. */
  path: string;
  /** Paragraph scores propagated up, plus this element's tag and class weight. */
  content: number;
  /** Anchor text over all text, 0..1 — a rail of headlines is near 1. */
  linkDensity: number;
  /** `content * (1 - linkDensity)`. This is what the winner is chosen on. */
  score: number;
  /** Characters of text held, whitespace collapsed. */
  text: number;
}

/** What the pass hands back across the `page.evaluate` boundary. */
export interface ContentPick {
  /** True when some element in the document now carries `CONTENT_MARKER`. */
  marked: boolean;
  /**
   * Why, in a sentence a `warnings` entry can carry verbatim. Populated on
   * every path, including the ones that change nothing.
   */
  reason: string;
  /** The best few candidates, best first, so a failure names which part broke. */
  candidates: Candidate[];
  /** Siblings merged in beside the winner, the winner itself not counted. */
  merged: number;
  /** Elements the strip removed. Zero when the pass declined and put them back. */
  stripped: number;
  /** Characters of text in the marked region. */
  text: number;
  /**
   * `<video>` and `<iframe>` elements the page had that the region does not.
   * Not an error — a related-videos rail SHOULD be lost — but the clip path is
   * load-bearing enough downstream that the number is reported rather than
   * discovered.
   */
  mediaDropped: number;
}

/**
 * Choose the content region, mark it, and report what that cost.
 *
 * Evaluated INSIDE THE PAGE, so nothing outside this function body exists at
 * run time. Type annotations are erased by the build and are the only thing
 * here that refers to anything above.
 */
export function readContentRegion(): ContentPick {
  // The literal `CONTENT_MARKER` also spells. Kept in step by a test, because a
  // reference to the exported constant would be a `ReferenceError` in the page.
  const MARKER = "data-ds-content";

  /**
   * Below this much text, the winner is not an article and the pass declines.
   * Readability's own floor is 500 and it retries with its flags off; the retry
   * here is harvest's simpler heuristic, so this can afford to be lower. 250 is
   * roughly two real paragraphs — under that, "densest container" is as good a
   * guess as this one and does not need the page mutated to make it.
   */
  const MIN_TEXT = 250;
  /** Readability's ancestor cap: past five levels the fraction is noise. */
  const MAX_ANCESTORS = 5;
  /** A sibling joins the region at a fifth of the winner's score, or 10. */
  const SIBLING_FRACTION = 0.2;
  const MIN_SIBLING_SCORE = 10;
  /** A paragraph shorter than this is a caption or a label, not content. */
  const MIN_PARAGRAPH = 25;

  /**
   * Readability's `unlikelyCandidates`, with `header` REMOVED and the modern
   * consent-banner words added.
   *
   * `header` is out because harvest's SKIP set already leaves it out for a
   * stated reason — inside an article it holds that article's own title and
   * byline — and stripping `<div class="entry-header">` would take the `<h1>`
   * the walker reads the document title from. The page-level masthead is caught
   * by the tag rule below instead, which can tell where it sits.
   */
  const UNLIKELY =
    /-ad-|ai2html|banner|breadcrumb|combx|comment|community|consent|cookie|disqus|extra|footer|gdpr|legends|masthead|menu|modal|newsletter|paywall|popup|promo|related|remark|replies|rss|share|shoutbox|sidebar|skyscraper|social|sponsor|subscribe|supplemental|pagination|pager|toolbar|yom-remote/i;
  /** Readability's `okMaybeItsACandidate` — words that overrule the list above. */
  const MAYBE = /and|article|body|column|content|main|shadow|story/i;
  /** Readability's class-weight lists: +25 for each match, -25 for each. */
  const POSITIVE = /article|body|content|entry|hentry|h-entry|main|page|post|story|text|blog/i;
  const NEGATIVE =
    /-ad-|banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|widget/i;

  /**
   * ARIA roles that say chrome outright. This is what catches the cookie
   * banner — `<div role="dialog">` wears no class the word lists know and is
   * neither skipped nor scored down by anything harvest does today.
   */
  const CHROME_ROLES = new Set([
    "alert",
    "alertdialog",
    "banner",
    "complementary",
    "contentinfo",
    "dialog",
    "menu",
    "menubar",
    "navigation",
    "search",
    "toolbar",
    "tooltip",
  ]);

  /**
   * Removed outright. This is harvest's own SKIP set: the two passes disagreeing
   * about what counts as chrome is how a region gets chosen on the strength of
   * text the walker then discards, which is the bug this list closes.
   * `iframe` is deliberately absent — a player iframe becomes a video block.
   */
  const CHROME_TAGS = new Set([
    "nav",
    "aside",
    "footer",
    "script",
    "style",
    "noscript",
    "form",
    "svg",
    "canvas",
    "template",
    "button",
    "select",
    "textarea",
  ]);

  /** Readability's DEFAULT_TAGS_TO_SCORE. `li` is absent: lists are often nav. */
  const SCORED = "p, td, pre, section, h2, h3, h4, h5, h6";

  function textOf(node: Node | null): string {
    return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  function labelOf(el: Element): string {
    return `${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""}`;
  }

  function nameOf(el: Element): string {
    const id = el.getAttribute("id");
    const cls = (el.getAttribute("class") ?? "").trim().split(/\s+/)[0];
    return el.tagName.toLowerCase() + (id ? `#${id}` : "") + (cls ? `.${cls}` : "");
  }

  /** Three levels is enough to tell two `div.row`s apart in a failing test. */
  function pathOf(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && parts.length < 3) {
      parts.unshift(nameOf(node));
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  /** Three decimals, so an assertion against a score is a stable string. */
  function round(n: number): number {
    return Math.round(n * 1000) / 1000;
  }

  /**
   * Anchor text over all text.
   *
   * A hash-only href counts at 0.3: a footnote marker or an in-page jump is part
   * of prose, and counting it whole makes a heavily annotated article look like
   * a nav. That coefficient is Readability's.
   */
  function linkDensity(el: Element): number {
    const total = textOf(el).length;
    if (total === 0) return 0;
    let inLinks = 0;
    for (const a of el.querySelectorAll("a")) {
      const href = a.getAttribute("href") ?? "";
      inLinks += textOf(a).length * (href.startsWith("#") ? 0.3 : 1);
    }
    return inLinks / total;
  }

  function classWeight(el: Element): number {
    let weight = 0;
    for (const label of [el.getAttribute("class") ?? "", el.getAttribute("id") ?? ""]) {
      if (label === "") continue;
      if (NEGATIVE.test(label)) weight -= 25;
      if (POSITIVE.test(label)) weight += 25;
    }
    return weight;
  }

  /**
   * What an element is worth before any paragraph is counted into it.
   *
   * A `<div>` is the shape an article wrapper usually takes, so it starts ahead;
   * a list, a definition list or a heading is the shape chrome usually takes, so
   * it starts behind. These are Readability's numbers unchanged.
   */
  function tagBonus(tag: string): number {
    if (tag === "div") return 5;
    if (tag === "pre" || tag === "td" || tag === "blockquote") return 3;
    if (tag === "th" || /^h[1-6]$/.test(tag)) return -5;
    if (/^(address|ol|ul|dl|dd|dt|li|form)$/.test(tag)) return -3;
    return 0;
  }

  const scores = new Map<Element, number>();

  function scoreOf(el: Element): number {
    const at = scores.get(el);
    if (at !== undefined) return at;
    const start = tagBonus(el.tagName.toLowerCase()) + classWeight(el);
    scores.set(el, start);
    return start;
  }

  /**
   * Every removal, with where to put it back.
   *
   * The strip is destructive because Readability's is, and because a region that
   * still holds the comment thread is not a region. But a pass that declines has
   * to leave the document exactly as it found it, or harvest's fallback
   * heuristic — which is what runs next — would be scoring a page this function
   * quietly edited. Reverse order on the way back: two siblings removed from one
   * parent restore correctly only if the later one goes home first.
   */
  const removed: { node: Element; parent: Element; next: Node | null }[] = [];

  function strip(el: Element): void {
    const parent = el.parentElement;
    if (!parent) return;
    removed.push({ node: el, parent, next: el.nextSibling });
    el.remove();
  }

  function restore(): void {
    for (let i = removed.length - 1; i >= 0; i--) {
      const at = removed[i];
      if (at) at.parent.insertBefore(at.node, at.next);
    }
    removed.length = 0;
  }

  function declined(reason: string, candidates: Candidate[]): ContentPick {
    restore();
    return {
      marked: false,
      reason,
      candidates,
      merged: 0,
      stripped: 0,
      text: 0,
      mediaDropped: 0,
    };
  }

  try {
    if (!document.body) {
      return declined("the document has no <body>, so there is no region to choose", []);
    }
    const mediaBefore = document.querySelectorAll("video, iframe").length;

    /* ------------------------------------------------------------- Strip */

    for (const el of [...document.body.querySelectorAll("*")]) {
      // An ancestor already went and took this with it. `remove()` on a
      // detached node succeeds silently, which would record an undo entry whose
      // parent is itself detached — so check rather than let it pass.
      if (!el.isConnected) continue;
      const tag = el.tagName.toLowerCase();
      if (CHROME_TAGS.has(tag)) {
        strip(el);
        continue;
      }
      // A `<header>` with no content ancestor is the site masthead; one inside
      // an article or a section is that article's own title and byline, which
      // harvest keeps on purpose and the walker's title reads from.
      if (tag === "header" && el.parentElement?.closest("article, main, section") == null) {
        strip(el);
        continue;
      }
      if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") {
        strip(el);
        continue;
      }
      if (CHROME_ROLES.has((el.getAttribute("role") ?? "").toLowerCase())) {
        strip(el);
        continue;
      }
      const label = labelOf(el);
      // The `querySelector` guard is not Readability's. It is here because one
      // wrapper wearing a bad word — `<div id="page-menu-shell">` around the
      // whole document — would otherwise take the article with it, and that
      // failure leaves nothing behind to notice it by.
      if (UNLIKELY.test(label) && !MAYBE.test(label) && !el.querySelector("main, article")) {
        strip(el);
      }
    }

    /* ------------------------------------------------------------- Score */

    for (const el of document.body.querySelectorAll(SCORED)) {
      const text = textOf(el);
      if (text.length < MIN_PARAGRAPH) continue;
      // One point for existing, one for each comma — prose is punctuated and a
      // list of headlines is not — and up to three for length, capped so that
      // one enormous block cannot outvote a whole article of ordinary ones.
      const base = 1 + (text.split(",").length - 1) + Math.min(Math.floor(text.length / 100), 3);
      let node = el.parentElement;
      let level = 0;
      while (node && node !== document.documentElement && level < MAX_ANCESTORS) {
        // The parent gets it whole, the grandparent half, and everything above
        // a third and falling: the further a wrapper is from the text, the less
        // that text says about whether the wrapper IS the article.
        const divider = level === 0 ? 1 : level === 1 ? 2 : level * 3;
        scores.set(node, scoreOf(node) + base / divider);
        node = node.parentElement;
        level++;
      }
    }

    const ranked: { el: Element; report: Candidate }[] = [];
    for (const [el, content] of scores) {
      const density = linkDensity(el);
      ranked.push({
        el,
        report: {
          path: pathOf(el),
          content: round(content),
          linkDensity: round(density),
          // THE WHOLE POINT OF THE PASS. A rail of related headlines and an
          // article of the same length hold the same number of characters; only
          // this term separates them, and it is why the discount is a
          // multiplier rather than a subtraction — a candidate that is entirely
          // links scores zero however long it is.
          score: round(content * (1 - density)),
          text: textOf(el).length,
        },
      });
    }
    ranked.sort((a, b) => b.report.score - a.report.score);
    const report = ranked.slice(0, 5).map((r) => r.report);

    let top = ranked[0];
    if (!top) {
      return declined(
        `nothing scored: the page has no paragraph of ${MIN_PARAGRAPH} characters or more ` +
          "outside its chrome. Save the page and ingest the file if a script builds its body.",
        report,
      );
    }

    /* ------------------------------------------------------------- Climb */

    // Because every ancestor takes a fraction of every paragraph below it, a
    // score that keeps RISING as you climb means the article is spread across
    // more than the winner — a wrapper of several sections rather than one of
    // them. Follow it while it rises; stop once a parent holds less than a third
    // of the winner, which is the point where the wrapper is mostly other things.
    const byElement = new Map(ranked.map((r) => [r.el, r]));
    const floor = top.report.score / 3;
    let last = top.report.score;
    let up = top.el.parentElement;
    while (up && up !== document.body && up !== document.documentElement) {
      const here = byElement.get(up);
      if (here) {
        if (here.report.score < floor) break;
        if (here.report.score > last) {
          top = here;
          break;
        }
        last = here.report.score;
      }
      up = up.parentElement;
    }

    /* ------------------------------------------------------------ Region */

    // The whole body won. That is the right answer for a single-column page with
    // no chrome — the paragraphs ARE body's children, so body is where their
    // score landed — and there is no container to build: marking body is the
    // answer, and it is not the same as declining, because the strip stays.
    if (top.el === document.body) {
      const text = textOf(document.body).length;
      if (text < MIN_TEXT) {
        return declined(
          `the page holds ${text} characters of text outside its chrome, under the ` +
            `${MIN_TEXT} this pass needs to be sure of a region; left it for the simpler heuristic`,
          report,
        );
      }
      document.body.setAttribute(MARKER, "");
      return {
        marked: true,
        reason: `chose <body>: nothing narrower than the page itself scored, ${text} characters`,
        candidates: report,
        merged: 0,
        stripped: removed.length,
        text,
        mediaDropped: mediaBefore - document.body.querySelectorAll("video, iframe").length,
      };
    }

    const parent = top.el.parentElement;
    if (!parent) {
      return declined("the winning candidate is not in the document any more", report);
    }

    // Siblings close to the winner belong with it: a page that puts its lede,
    // its body and its footnotes in three sibling divs has one article in three
    // boxes, and the winner alone would be a third of it. The `<p>` rule below
    // is Readability's, and it exists for the bare paragraph that sits beside
    // the article wrapper with no wrapper of its own, so it never got a score.
    const threshold = Math.max(MIN_SIBLING_SCORE, top.report.score * SIBLING_FRACTION);
    const topClass = top.el.getAttribute("class") ?? "";
    const keep: Element[] = [];
    for (const sib of [...parent.children]) {
      if (sib === top.el) {
        keep.push(sib);
        continue;
      }
      const twin = topClass !== "" && sib.getAttribute("class") === topClass;
      const bonus = twin ? top.report.score * SIBLING_FRACTION : 0;
      const here = byElement.get(sib);
      if (here && here.report.score + bonus >= threshold) {
        keep.push(sib);
        continue;
      }
      if (sib.tagName.toLowerCase() === "p") {
        const text = textOf(sib);
        const density = linkDensity(sib);
        const long = text.length > 80 && density < 0.25;
        // A short paragraph that ends in a sentence and holds no link at all:
        // a standfirst or a closing line, which is prose however short it is.
        const sentence =
          text.length > 0 && text.length <= 80 && density === 0 && /\.( |$)/.test(text);
        if (long || sentence) keep.push(sib);
      }
    }

    const text = keep.reduce((n, el) => n + textOf(el).length, 0);
    if (text < MIN_TEXT) {
      return declined(
        `the best region (${top.report.path}) holds ${text} characters, under the ${MIN_TEXT} ` +
          "this pass needs to be sure of it; left the page for the simpler heuristic",
        report,
      );
    }

    // One survivor needs no box. Marking the element itself keeps the DOM the
    // page's own, which is one less thing between a failing harvest and the HTML
    // a human is looking at.
    let region: Element;
    if (keep.length === 1 && keep[0]) {
      region = keep[0];
    } else {
      const box = document.createElement("div");
      for (const el of keep) box.appendChild(el);
      document.body.appendChild(box);
      region = box;
    }
    region.setAttribute(MARKER, "");

    return {
      marked: true,
      reason:
        `chose ${top.report.path} — score ${top.report.score}, link density ` +
        `${top.report.linkDensity}, ${textOf(region).length} characters` +
        (keep.length > 1 ? `, with ${keep.length - 1} sibling(s) merged in` : ""),
      candidates: report,
      merged: keep.length - 1,
      stripped: removed.length,
      text: textOf(region).length,
      mediaDropped: mediaBefore - region.querySelectorAll("video, iframe").length,
    };
  } catch (e) {
    // A throw here would reject `page.evaluate` and fail the whole harvest for a
    // pass that is an improvement, not a requirement. So it is caught, the page
    // is put back, and the reason travels out as text the caller can warn with.
    return declined(
      `the readability pass failed inside the page (${e instanceof Error ? e.message : String(e)}); ` +
        "the page was left as it was found and the simpler heuristic still applies",
      [],
    );
  }
}
