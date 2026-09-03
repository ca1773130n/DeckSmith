/**
 * A hypepaper-style analysis markdown becomes a `Source`.
 *
 * The document is read as a flat stream of blocks: headings open sections, and
 * figures, equations and tables are lifted out of the prose into addressable
 * lists. Ids are assigned in document order — `fig1`, `eq1`, `tbl1`, `sec1` —
 * because a beat's `evidence` is only provenance if it still means the same
 * thing on the next run over the same input.
 */
import { createHash } from "node:crypto";
import type { Nodes, Root, RootContent, Table as TableNode } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { type Equation, type Figure, type Section, type Source, sourceSchema } from "../types.js";

export interface ParseOptions {
  /** Stable document id. Defaults to a content hash, so re-parsing is idempotent. */
  id?: string;
  /** BCP-47 override. Defaults to a script sniff, which is what picks the font. */
  lang?: string;
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

export function parseMarkdown(md: string, opts: ParseOptions = {}): Source {
  const root = parser.parse(md) as Root;

  const sections: Section[] = [];
  const figures: Figure[] = [];
  const equations: Equation[] = [];
  const tables: Source["tables"] = [];

  let title = "";
  let open: { depth: number; heading: string; lines: string[] } | null = null;
  const flush = () => {
    if (!open) return;
    const id = `sec${sections.length + 1}`;
    sections.push({ id, depth: open.depth, heading: open.heading, text: open.lines.join("\n\n") });
    open = null;
  };
  /** Content can appear before the first heading; it still needs somewhere to live. */
  const current = () => (open ??= { depth: 1, heading: "", lines: [] });

  /**
   * Every prose block and every lifted image, by their index in the stream, so a
   * figure can be matched to the paragraph that refers to it. That paragraph is
   * as often AFTER the image as before it, and when the image is lifted it has
   * not been read yet — hence a second pass rather than a lookup here.
   */
  const prose: Array<{ at: number; text: string }> = [];
  const placed: Array<{ figure: Figure; at: number; opened: number }> = [];
  /** Where the open section began, which bounds the fallback below. */
  let opened = -1;

  const children = root.children;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (!node) continue;

    if (node.type === "heading") {
      const heading = textOf(node);
      if (!title) title = heading;
      flush();
      open = { depth: node.depth, heading, lines: [] };
      opened = i;
      continue;
    }

    if (node.type === "table") {
      const caption = captionOf(children[i + 1]);
      tables.push({
        id: `tbl${tables.length + 1}`,
        ...readTable(node),
        ...(caption && { caption }),
      });
      if (caption !== undefined) i++;
      continue;
    }

    const images = node.type === "paragraph" ? onlyImages(node.children) : undefined;
    if (images) {
      // The real input captions a figure with the italic paragraph that follows it.
      const caption = captionOf(children[i + 1]);
      for (const img of images) {
        const figure: Figure = {
          id: `fig${figures.length + 1}`,
          src: img.url,
          caption: caption ?? img.alt ?? "",
          // 1x1 until assets.ts reads the actual bytes. The schema has no "unknown",
          // and a square placeholder is a visible wrong rather than a plausible one.
          width: 1,
          height: 1,
          // The section is still open, so the id `flush` is about to give it is
          // the id this figure belongs to. Absent before the first heading,
          // where there is no section to name yet.
          ...(open && { sectionId: `sec${sections.length + 1}` }),
        };
        figures.push(figure);
        placed.push({ figure, at: i, opened });
      }
      if (caption !== undefined) i++;
      continue;
    }

    collectMath(node, equations);
    if (node.type === "math") continue; // lifted, not prose
    const text = blockText(node);
    if (text) {
      current().lines.push(text);
      prose.push({ at: i, text });
    }
  }
  flush();

  for (const p of placed) {
    // A figure BEFORE the first heading has no section open at lift time, but if
    // any prose preceded or followed it the flush created a preamble section and
    // the figure is inside it — so the id exists, it is just not known until
    // now. Deferred here rather than guessed above: `sections.length + 1` at
    // lift time would have named a section that might never be created, and the
    // hero figure of a document that opens with an image is exactly the one this
    // dropped.
    // The marker for "lifted before the first heading" is the absent id itself:
    // `open` was null, so nothing named it. If the flush then created a preamble
    // section — the one with no heading — that is the section the figure is in.
    const preamble = sections[0];
    if (p.figure.sectionId === undefined && preamble && preamble.heading === "") {
      p.figure.sectionId = preamble.id;
    }
    const mention = mentionOf(p.figure.caption, prose, p.at, p.opened);
    if (mention) p.figure.mention = mention;
  }

  return sourceSchema.parse({
    id: opts.id ?? createHash("sha256").update(md).digest("hex").slice(0, 12),
    title: title || "Untitled",
    lang: opts.lang ?? sniffLang(md),
    sections,
    figures,
    equations,
    tables,
  });
}

/**
 * A script sniff, not language detection. All it has to decide is which family
 * `fonts.ts` must subset and ship, and that question only has four answers.
 */
function sniffLang(md: string): string {
  if (/[가-힣]/.test(md)) return "ko";
  if (/[぀-ヿ]/.test(md)) return "ja";
  if (/[一-鿿]/.test(md)) return "zh";
  return "en";
}

/** The paragraph's images, if the paragraph holds nothing else. */
function onlyImages(kids: RootContent[]) {
  const solid = kids.filter((c) => !(c.type === "text" && !c.value.trim()));
  const images = solid.filter((c) => c.type === "image");
  return images.length > 0 && images.length === solid.length ? images : undefined;
}

/** A paragraph that is one run of italics, i.e. the caption convention. */
function captionOf(node: RootContent | undefined): string | undefined {
  if (node?.type !== "paragraph") return undefined;
  const solid = node.children.filter((c) => !(c.type === "text" && !c.value.trim()));
  const first = solid[0];
  return solid.length === 1 && first?.type === "emphasis" ? textOf(first) : undefined;
}

/**
 * The prose a figure is referred to by: the nearest paragraph that NAMES it —
 * the one before it, or failing that the first one after — and where the author
 * never wrote "Figure 2" at all, the paragraph immediately in front of the image.
 *
 * A named reference may sit anywhere in the document, because the name says
 * which figure it is about. The unnamed fallback may not: it is a guess from
 * position alone, so it is bounded by the figure's own section. A paragraph from
 * the section above is about something else, and the planner cannot tell a wrong
 * reference from a right one.
 */
function mentionOf(
  caption: string,
  prose: ReadonlyArray<{ at: number; text: string }>,
  at: number,
  opened: number,
): string | undefined {
  const name = figureName(caption);
  if (name) {
    const before = prose.filter((p) => p.at < at && name.test(p.text)).at(-1);
    const found = before ?? prose.find((p) => p.at > at && name.test(p.text));
    if (found) return found.text;
  }
  return prose.filter((p) => p.at > opened && p.at < at).at(-1)?.text;
}

/**
 * How the document would refer to this figure in a sentence, read off the
 * caption's own numbering: a caption opening "Figure 2 —" is cited as "Figure 2"
 * or "Fig. 2". Undefined for a caption with no number in it, which is exactly
 * when there is nothing to match on.
 */
function figureName(caption: string): RegExp | undefined {
  const match = /^\s*(fig(?:ure)?\.?|그림|図|图)\s*([0-9]+)/i.exec(caption);
  const word = match?.[1];
  const number = match?.[2];
  if (!word || !number) return undefined;
  // Latin prose abbreviates what the caption spells out; CJK does not, and the
  // three CJK words carry no characters a regex reads specially.
  const head = /^fig/i.test(word) ? String.raw`fig(?:ure)?\.?` : word;
  return new RegExp(`${head}\\s*${number}\\b`, "i");
}

function readTable(node: TableNode) {
  const [head, ...body] = node.children.map((row) => row.children.map(textOf));
  return { columns: head ?? [], rows: body };
}

/** Push every math node under `node` in document order. */
function collectMath(node: Nodes, out: Equation[]): void {
  if (node.type === "math" || node.type === "inlineMath") {
    out.push({ id: `eq${out.length + 1}`, tex: node.value.trim(), display: node.type === "math" });
    return;
  }
  if ("children" in node) for (const child of node.children) collectMath(child, out);
}

function blockText(node: RootContent): string {
  switch (node.type) {
    case "code":
      return node.value;
    case "list":
      return node.children
        .map((item, n) => {
          const marker = node.ordered ? `${(node.start ?? 1) + n}.` : "-";
          return `${marker} ${item.children.map(blockText).join(" ")}`;
        })
        .join("\n");
    case "blockquote":
      return node.children.map(blockText).join("\n");
    case "html":
    case "definition":
    case "thematicBreak":
      return "";
    default:
      return textOf(node);
  }
}

function textOf(node: Nodes): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
      return node.value;
    // Inline math stays in the prose as TeX so the sentence still reads, even
    // though it is also lifted into `equations` with an id of its own.
    case "inlineMath":
      return `$${node.value}$`;
    case "break":
      return "\n";
    case "math":
    case "image":
    case "html":
      return "";
    default:
      return "children" in node ? node.children.map(textOf).join("") : "";
  }
}
