/**
 * A fake scene reply built the way its prompt's CHART BUILD asks
 * (src/bespoke/databuild.ts `checkBuild`), so a test's one generic fragment
 * passes on a data beat too. A prompt with no build gets the fragment back.
 */
import type { Fragment } from "../../src/bespoke/contract.js";

const MARK: Record<string, string> = {
  "line-callout": "data-callout",
  delta: "data-delta",
  "small-multiples": "data-panel",
};

export function asBuilt(prompt: string, f: Fragment): Fragment {
  const build = /CHART BUILD: "([\w-]+)"/.exec(prompt)?.[1];
  const mark = build ? MARK[build] : undefined;
  if (!build || !mark) return f;
  const g =
    `<g id="SCENEID-build" data-build="${build}">` +
    [1, 2, 3].map((i) => `<g id="SCENEID-m${i}" ${mark}="1"></g>`).join("") +
    `<path id="SCENEID-line" d="M0 0 L10 10"/>` +
    `<text id="SCENEID-dv" font-size="40">0</text></g>`;
  const markup = f.markup.includes("</svg>")
    ? f.markup.replace(/<\/svg>(?![\s\S]*<\/svg>)/, `${g}</svg>`)
    : `${f.markup}<svg id="SCENEID-bsvg" width="10" height="10">${g}</svg>`;
  const script = [
    f.script,
    'tl.fromTo("#SCENEID-cam", { scale: 1 }, { scale: 1.2, duration: 1 }, 2);',
    'tl.fromTo("#SCENEID-cam", { scale: 1.2 }, { scale: 1, duration: 1 }, 4);',
    build === "line-callout"
      ? 'tl.fromTo("#SCENEID-line", { drawSVG: "0% 0%" }, { drawSVG: "0% 100%", duration: 1 }, 1);'
      : "",
    build === "delta"
      ? 'tl.fromTo("#SCENEID-dv", { textContent: 0 }, { textContent: 12, snap: { textContent: 1 }, duration: 1 }, 3);'
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { ...f, markup, script };
}
