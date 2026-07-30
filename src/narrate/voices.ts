/**
 * Which voice says it.
 *
 * A voice id is not a preference the user should have to hold: `edge-tts
 * --list-voices` prints several hundred rows, a wrong id fails at synthesis time
 * with an unhelpful error, and the interesting choice — language and register —
 * is already in `prefs`. So the table below maps (lang, tone) to an id that was
 * read off this machine's own `--list-voices`, and an explicit
 * `prefs.narration.voice` always wins over it.
 *
 * Multilingual neural voices are preferred wherever Microsoft ships one: they
 * are the newer models, they read a foreign proper noun mid-sentence without
 * switching accent, and they are the closest thing here to a presenter rather
 * than a reader.
 */
import type { z } from "zod";
import type { prefsSchema } from "../types.js";

type Prefs = z.infer<typeof prefsSchema>;
type Tone = Prefs["tone"];

/** Every value here appeared in `edge-tts --list-voices`; do not invent more. */
const VOICES: Record<string, Record<Tone, string>> = {
  en: {
    plain: "en-US-AndrewMultilingualNeural",
    academic: "en-US-BrianMultilingualNeural",
    conversational: "en-US-AvaMultilingualNeural",
    punchy: "en-US-EmmaMultilingualNeural",
  },
  // Hyunsu is Korean's only multilingual voice, so it carries both registers
  // where the difference is warmth rather than formality.
  ko: {
    plain: "ko-KR-HyunsuMultilingualNeural",
    academic: "ko-KR-InJoonNeural",
    conversational: "ko-KR-HyunsuMultilingualNeural",
    punchy: "ko-KR-SunHiNeural",
  },
  ja: {
    plain: "ja-JP-NanamiNeural",
    academic: "ja-JP-KeitaNeural",
    conversational: "ja-JP-NanamiNeural",
    punchy: "ja-JP-KeitaNeural",
  },
  zh: {
    plain: "zh-CN-XiaoxiaoNeural",
    academic: "zh-CN-YunyangNeural",
    conversational: "zh-CN-YunxiNeural",
    punchy: "zh-CN-YunjianNeural",
  },
};

/**
 * The primary subtag, lowercased: "zh-Hans-CN" and "zh" pick the same row, and
 * "en-GB" does not fall off the table for want of its own entry.
 */
function primary(lang: string): string {
  return (lang.split("-")[0] ?? "").toLowerCase();
}

/**
 * Pick the voice for these preferences.
 *
 * An unlisted language falls back to the English multilingual row, which speaks
 * some forty languages: the accent will be wrong, but a deck that narrates in a
 * borrowed accent is worth more than one that fails to narrate at all.
 */
export function pickVoice(prefs: Prefs): string {
  const explicit = prefs.narration.voice?.trim();
  if (explicit) return explicit;
  const row = VOICES[primary(prefs.lang)] ?? (VOICES.en as Record<Tone, string>);
  return row[prefs.tone];
}

/** The languages with a voice of their own. Everything else borrows English's. */
export function narratableLangs(): string[] {
  return Object.keys(VOICES);
}
