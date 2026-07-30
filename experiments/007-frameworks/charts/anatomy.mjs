// How much of a chart archetype is geometry (a library could supply it) vs
// choreography + slide-specific layout (only we can)?
import { readFileSync } from "node:fs";

for (const f of ["line-chart", "bar-compare"]) {
  const src = readFileSync(`../../../src/emit/archetypes/${f}.ts`, "utf8");
  const lines = src.split("\n");
  let code = 0,
    comment = 0,
    blank = 0,
    inBlock = false;
  for (const l of lines) {
    const t = l.trim();
    if (!t) {
      blank++;
      continue;
    }
    if (inBlock) {
      comment++;
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (t.startsWith("/*")) {
      comment++;
      if (!t.includes("*/")) inBlock = true;
      continue;
    }
    if (t.startsWith("//")) {
      comment++;
      continue;
    }
    code++;
  }
  console.log(
    f.padEnd(13),
    `total ${lines.length}`.padEnd(11),
    `code ${code}`.padEnd(10),
    `comment ${comment}`.padEnd(13),
    `blank ${blank}`.padEnd(10),
    `tween() calls ${(src.match(/tween\(/g) || []).length}`.padEnd(17),
    `css decls ${(src.match(/^\s*`\./gm) || []).length}`,
  );
}
