/**
 * What is installed, asked before anything expensive is spent.
 *
 * The pipeline shells out to four separate things and only finds out at the
 * stage that needs them: Codex a minute in, edge-tts two, ffmpeg four. A job
 * that dies four minutes deep because ffmpeg is absent is the worst shape this
 * can fail in — the work is gone, the Codex spend is gone, and the message
 * arrives at the end.
 *
 * So the MCP asks first. Each probe is a `--version` with a short timeout, run
 * in parallel; the whole check is under a second and the answer goes in
 * `decksmith_capabilities`, which the tool description tells an agent to call
 * before anything else.
 *
 * REPORTED, NEVER ENFORCED. A missing ffmpeg does not stop a deck being planned
 * and built — only rendered — and refusing the whole request because the last
 * optional stage cannot run would be worse than the thing being fixed. The
 * create tool checks only what its own options actually need.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Prereq {
  name: string;
  ok: boolean;
  /** The stage that cannot run without it. */
  neededFor: string;
  /** What to type. Named because "install ffmpeg" is not an instruction. */
  install: string;
  /** Version string when it answered, so a wrong-version bug is visible. */
  version?: string;
}

/** One probe. Never throws — absence is the answer, not an error. */
async function probe(
  name: string,
  neededFor: string,
  install: string,
  argv: [string, string[]],
): Promise<Prereq> {
  try {
    const { stdout, stderr } = await run(argv[0], argv[1], { timeout: 5000 });
    const version = `${stdout}${stderr}`.trim().split("\n")[0]?.slice(0, 80);
    return { name, ok: true, neededFor, install, ...(version ? { version } : {}) };
  } catch {
    return { name, ok: false, neededFor, install };
  }
}

/**
 * Chrome is the odd one out: `hyperframes check` and the renderer each resolve
 * their OWN browser, so probing one binary cannot prove either will find it.
 * `npx puppeteer browsers install chrome` is what fixes it either way, and the
 * probe is therefore advisory — hence the honest `neededFor` naming both stages.
 */
export function prereqs(): Promise<Prereq[]> {
  return Promise.all([
    probe("codex", "plan", "npm i -g @openai/codex && codex login", ["codex", ["--version"]]),
    probe("edge-tts", "narrate", "python3 -m pip install --user edge-tts", [
      "python3",
      ["-m", "edge_tts", "--version"],
    ]),
    probe("ffmpeg", "render", "brew install ffmpeg", ["ffmpeg", ["-version"]]),
    probe("chrome", "build and render", "npx puppeteer browsers install chrome", [
      "node",
      ["-e", "process.stdout.write(require('puppeteer-core/package.json').version)"],
    ]),
  ]);
}

/** The ones a job with these options actually needs, and which are missing. */
export function missingFor(
  found: readonly Prereq[],
  opts: { narrate: boolean; video: boolean },
): Prereq[] {
  const need = new Set(["codex"]);
  if (opts.narrate || opts.video) need.add("edge-tts");
  if (opts.video) need.add("ffmpeg");
  return found.filter((p) => need.has(p.name) && !p.ok);
}
