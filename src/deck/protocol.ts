/**
 * What a host page and a deck say to each other.
 *
 * ONE FILE, IMPORTED BY BOTH ENDS, so `tsc` checks the sender against the
 * receiver. The alternative — a string literal in the runtime and a matching one
 * in the element — is two copies of a contract that drift the first time a field
 * is added, and the drift is invisible because `postMessage` takes `any` and a
 * message nobody understands is simply ignored.
 *
 * WHY A BRIDGE AT ALL, rather than hosting the deck in the page. A deck is a
 * whole document with its own fonts, GSAP, KaTeX, a vendored player and a ready
 * gate, and `frameOf` in runtime.ts can only reach a SAME-ORIGIN frame — it
 * returns null otherwise and the runtime merely warns, so a deck served from
 * another origin would navigate perfectly and paint nothing, silently. Keeping
 * the frame keeps that same-origin pair inside one directory, where it is always
 * true, and makes the host link `postMessage`, which does not care about origin.
 *
 * VERSION COUPLING IS THE HAZARD. Every deck published before this existed has
 * no listener, and a deck is a static artifact that outlives the tool that made
 * it. So silence is a SUPPORTED state, not an error: the element times out, says
 * so with a distinct code, and leaves the deck usable — it is still a deck in a
 * frame, and its own keyboard still works.
 */

/** The channel name, on every message in both directions. */
export const CHANNEL = "decksmith-deck";

/** Sent by the host once the frame has loaded, to open the conversation. */
export interface Hello {
  channel: typeof CHANNEL;
  type: "hello";
}

/**
 * The deck's answer, and the only message that establishes the host's origin.
 *
 * NOTHING IS POSTED TO "*" AFTER THIS. A stop carries the slide's speaker
 * notes, and any page on the internet can put a deck in a frame — posting
 * wildcard would hand an arbitrary framer the presenter's notes. The origin is
 * taken from the `hello` event and every later message is addressed to it.
 */
export interface Ready {
  channel: typeof CHANNEL;
  type: "ready";
  /** Every stop the deck can land on, in order. */
  stops: { i: number; label: string; notes?: string }[];
  /** Where it is now. */
  at: number;
}

/** Where the deck landed, after any move. */
export interface Stopped {
  channel: typeof CHANNEL;
  type: "stop";
  at: number;
  total: number;
  label: string;
  notes?: string;
  playing: boolean;
}

/** What a host may ask for. Deliberately small: everything else is a deck concern. */
export type Command =
  | { channel: typeof CHANNEL; type: "next" }
  | { channel: typeof CHANNEL; type: "prev" }
  | { channel: typeof CHANNEL; type: "go"; at: number }
  | { channel: typeof CHANNEL; type: "play"; on: boolean };

export type FromDeck = Ready | Stopped;
export type ToDeck = Hello | Command;

/** A message from us, rather than from anything else sharing the window. */
export function isOurs(data: unknown): data is FromDeck | ToDeck {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { channel?: unknown }).channel === CHANNEL &&
    typeof (data as { type?: unknown }).type === "string"
  );
}
