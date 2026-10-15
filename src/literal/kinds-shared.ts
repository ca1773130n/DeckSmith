/** Helpers more than one kind shares: a picture's own size, tile ratios. */

export async function nativeSize(image: string): Promise<{ w: number; h: number }> {
  // The picture's own pixel size, through ffprobe (render's dependency already).
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    image,
  ]);
  const [w, h] = String(stdout).trim().split(",").map(Number);
  if (!w || !h) throw new Error(`literal: ffprobe could not size ${image}`);
  return { w, h };
}

/** How many copies of the smallest value tile the largest (0: too close to be worth it). */
export const tiles = (vals: readonly number[]) => {
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  // Two copies at least: one copy laid along the larger length is an empty
  // outlined box that says nothing the bars do not (r1: 35 against 20).
  return min > 0 && max / min >= 2 ? Math.floor(max / min) : 0;
};

/**
 * The ratio line a tiled group prints ("35 ÷ 20 = 1.75"), or undefined when the
 * group does not tile. One function, so the truth gate checks the very number
 * the scene draws (src/plan/coverage.ts `literalTexts`).
 */
export function tileRatio(items: ReadonlyArray<{ value: string }>): string | undefined {
  const vals = items.map((it) => Number(it.value));
  if (!tiles(vals)) return undefined;
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  return `${items[vals.indexOf(max)]?.value} ÷ ${items[vals.indexOf(min)]?.value} = ${(max / min).toFixed(2)}`;
}
