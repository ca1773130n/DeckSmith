/**
 * Extract top-level declarations with exact line spans, so each can be
 * hand-classified. A function is the natural unit of "would this survive a
 * vocabulary rewrite"; a line is not. Doc comments belong to the declaration
 * they precede and are counted with it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/Users/neo/Developer/Projects/DeckSmith/src/emit";
const bare = (l) =>
  l
    .replace(/\\./g, "")
    .replace(/`(?:[^`$]|\$(?!\{))*`/g, "``")
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''")
    .replace(/\/\/.*$/, "");
const delta = (l) => {
  let d = 0;
  for (const c of bare(l)) {
    if ("([{".includes(c)) d++;
    else if (")]}".includes(c)) d--;
  }
  return d;
};
const isComment = (l) => /^\s*(\/\*|\*|\/\/)/.test(l);

export function units(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  const out = [];
  let depth = 0;
  let head = -1;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (depth === 0 && start < 0) {
      if (l.trim() === "") {
        head = -1;
        continue;
      }
      if (isComment(l)) {
        if (head < 0) head = i;
        continue;
      }
      start = head >= 0 ? head : i;
      head = -1;
    }
    depth += delta(l);
    if (depth <= 0) {
      depth = 0;
      const body = lines.slice(start, i + 1);
      const code = body.filter((x) => x.trim() && !isComment(x)).length;
      const decl = body.find((x) => x.trim() && !isComment(x)) ?? "";
      const name =
        decl.match(/(?:function|const|let|interface|type|class)\s+([A-Za-z_$][\w$]*)/)?.[1] ??
        decl.match(/^\s*(import|export)\b/)?.[1] ??
        decl.trim().slice(0, 30);
      const doc = body.find((x) => isComment(x) && x.replace(/[/*\s]/g, "").length > 3);
      out.push({
        name,
        from: start + 1,
        to: i + 1,
        lines: body.length,
        code,
        doc: (doc ?? "").replace(/^\s*[/*\s]+/, "").slice(0, 95),
      });
      start = -1;
    }
  }
  return out;
}

const files = [
  ...readdirSync(join(ROOT, "archetypes"))
    .filter((f) => f.endsWith(".ts") && f !== "index.ts")
    .sort()
    .map((f) => ["archetypes/" + f, join(ROOT, "archetypes", f)]),
  ...["kit.ts", "svg.ts", "theme.ts"].map((f) => [f, join(ROOT, f)]),
];

for (const [label, p] of files) {
  for (const u of units(p)) {
    if (u.name === "import" || u.name === "export") continue;
    console.log(`${label}\t${u.name}\t${u.from}-${u.to}\t${u.code}\t${u.doc}`);
  }
}
