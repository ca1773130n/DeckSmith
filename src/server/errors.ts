/**
 * A failure, said in a way the person who uploaded the file can act on.
 *
 * The house rule from src/cli.ts is that a failure is a bad document or a bad
 * path, not a stack trace — and over HTTP that rule is stricter, because the
 * person reading the message did not install anything and cannot see the box.
 * So every error becomes two sentences: what went wrong, and what to do.
 *
 * The messages the library already writes are good ones and are kept verbatim;
 * this table only adds the "and here is the fix" half, matched on the phrase the
 * library actually emits. Where nothing matches, the message still passes
 * through — a wrong hint is worse than no hint.
 */
import { UploadError } from "./upload.js";

export interface JobError {
  message: string;
  hint: string;
}

/** Phrase in the library's message → what to do about it. Order matters. */
const HINTS: { when: RegExp; hint: string }[] = [
  {
    when: /"codex" CLI is not on PATH/i,
    hint: "Install it on the server with `npm i -g @openai/codex`, then run `codex login` as the user this process runs as. Planning is the only stage that needs it.",
  },
  {
    when: /Codex did not finish within/i,
    hint: "The document is probably long. Split it, or ask for fewer slides, and try again.",
  },
  {
    when: /codex exec exited|final message was not JSON|produced no final message/i,
    hint: "Codex answered but not with a storyboard. Retry once — if it repeats, the document is likely too long or too unstructured to plan from.",
  },
  {
    when: /edge-tts is not installed/i,
    hint: "Install it on the server with `python3 -m pip install --user edge-tts`, or submit with narration off — the deck itself needs no network.",
  },
  {
    when: /\bffprobe\b|\bffmpeg\b/i,
    hint: "Install ffmpeg on the server (`brew install ffmpeg` / `apt install ffmpeg`). Narration measures its own audio with ffprobe and the video is muxed with ffmpeg.",
  },
  {
    when: /Cannot burn in captions/i,
    hint: "Ask for sidecar subtitles instead of burned-in ones, or install a Chrome for the caption pass.",
  },
  {
    when: /browsers install chrome|DECKSMITH_CHROME|No (installed )?(Chrome|browser)/i,
    hint: "Install a browser on the server with `npx puppeteer browsers install chrome`, or point DECKSMITH_CHROME at one. Only the video render needs it; the deck does not.",
  },
  {
    when: /timing\.json is missing/i,
    hint: "The video needs narration to time itself against. Re-submit with narration on.",
  },
  {
    when: /Deck runtime missing/i,
    hint: "The server was started without a build. Run `npm run build` and restart it.",
  },
  {
    // Seen on a real run: "Codex returned a storyboard that does not validate:
    // beats.3.params.bars: Too small". The planner is schema-constrained but not
    // schema-guaranteed, and a retry usually lands — so the hint has to match the
    // sentence the library actually writes, not the one this table first guessed.
    when: /storyboard that does not validate|is not a valid storyboard|does not resolve|dangling/i,
    hint: "The planner answered with a storyboard that does not fit the schema — a beat came back half-filled. This is usually one bad roll of the dice; submit the same document again.",
  },
  {
    // A planner problem that surfaces wherever the emitter is first called —
    // which is `narrate`, because narration asks the emitter how many stops a
    // beat has. The stage in the UI is therefore honest about WHERE it stopped
    // and misleading about WHAT went wrong, so the hint has to say so.
    when: /equation-walk .*term|none of its \d+ term/i,
    hint: "The planner labelled a symbol the equation does not contain. Nothing is wrong with your document; it is a planning miss and a fresh run usually writes the term correctly. Reported at the narration stage because that is the first stage that builds a slide.",
  },
  {
    when: /unrecognised image header/i,
    hint: "One of the figures is not a PNG, JPEG or GIF. SVG and PDF figures are not read; export them to PNG first.",
  },
  {
    when: /ENOSPC|no space left/i,
    hint: "The server is out of disk. Nothing you can do from here — tell whoever runs it.",
  },
];

const FALLBACK =
  "This one is not a document problem we recognise. The stage list above shows how far it got; re-running an identical upload is worth one try.";

/**
 * Turn anything thrown into the `{ message, hint }` the API promises.
 *
 * `UploadError` already carries its own hint, because the thing that knows a
 * zip has no markdown in it is the code that looked.
 */
export function explain(err: unknown): JobError {
  if (err instanceof UploadError) return { message: err.message, hint: err.hint };
  const message = err instanceof Error ? err.message : String(err);
  // A message with a stack glued on happens when something rethrows badly; keep
  // the sentence and drop the frames, which are never the reader's business.
  const clean = message.split("\n    at ")[0]?.trim() || "The job failed.";
  return { message: clean, hint: HINTS.find((h) => h.when.test(message))?.hint ?? FALLBACK };
}
