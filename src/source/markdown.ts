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

  const children = root.children;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (!node) continue;

    if (node.type === "heading") {
      const heading = textOf(node);
      if (!title) title = heading;
      flush();
      open = { depth: node.depth, heading, lines: [] };
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
        figures.push({
          id: `fig${figures.length + 1}`,
          src: img.url,
          caption: caption ?? img.alt ?? "",
          // 1x1 until assets.ts reads the actual bytes. The schema has no "unknown",
          // and a square placeholder is a visible wrong rather than a plausible one.
          width: 1,
          height: 1,
        });
      }
      if (caption !== undefined) i++;
      continue;
    }

    collectMath(node, equations);
    if (node.type === "math") continue; // lifted, not prose
    const text = blockText(node);
    if (text) current().lines.push(text);
  }
  flush();

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
