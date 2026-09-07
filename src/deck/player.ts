/**
 * `<decksmith-player deck="/decks/foo/">` — the deck, as a module.
 *
 * WHAT A CONSUMER HAS TO LEARN: a deck URL. Not that hyperframes exists, not
 * that there is a slideshow island, not that we have a build. That is the test
 * this design was chosen against, and it is why the deck stays in its own frame
 * rather than being mounted into the host page.
 *
 * WHY THE FRAME IS THE BOUNDARY rather than something to remove. Three facts,
 * each verified in the tree:
 *
 *  - `frameOf` in runtime.ts reaches the composition through `contentDocument`
 *    and `contentWindow.__timelines`, and returns null cross-origin while the
 *    runtime only warns. Hosting the deck in the consumer's page transplants
 *    that same-origin requirement onto host-to-deck, so a deck served from a
 *    CDN would navigate perfectly and paint NOTHING, silently. In a frame the
 *    same-origin pair is deck.html to index.html — one directory, always true.
 *  - `customElements.define` is one registry per document. Hosting the vendored
 *    hyperframes player in the app shell means two decks are two bundles, and
 *    the second `define` throws.
 *  - The deck's own chrome is written against `100vh` being the box, which is
 *    true inside a frame and quietly wrong outside it — a mis-sized slide, not
 *    an error.
 *
 * So the frame is promoted, not dissolved, and the link across it is
 * `postMessage`, which does not care about origin.
 *
 * SILENCE IS A SUPPORTED STATE. A deck is a static artifact that outlives the
 * tool that built it, and every deck published before this bridge existed has no
 * listener. The element waits, gives up, emits `ds-error` with a distinct
 * reason, and leaves the deck exactly as usable as it was — it is still a deck
 * in a frame, and its own keyboard still works. It does not blank, and it does
 * not throw.
 */
import { CHANNEL, type Command, type FromDeck, isOurs } from "./protocol.js";

/** How long a deck gets to answer the handshake, mirroring the runtime's own ready gate. */
const HELLO_TIMEOUT_MS = 5000;

/** One stop, as a host sees it. */
export interface PlayerStop {
  i: number;
  label: string;
  notes?: string;
}

export class DecksmithPlayer extends HTMLElement {
  static observedAttributes = ["deck"];

  #frame: HTMLIFrameElement | null = null;
  #onMessage: ((e: MessageEvent) => void) | null = null;
  #timer: ReturnType<typeof setTimeout> | 0 = 0;
  #stops: PlayerStop[] = [];
  #at = 0;
  #connected = false;

  /** Every stop the deck reported, empty until `ds-ready`. */
  get stops(): PlayerStop[] {
    return this.#stops;
  }
  /** Where the deck is now. */
  get at(): number {
    return this.#at;
  }
  /** Whether the deck answered the handshake. */
  get connected(): boolean {
    return this.#connected;
  }

  connectedCallback(): void {
    if (!this.#frame) this.#mount();
  }

  disconnectedCallback(): void {
    this.#teardown();
  }

  attributeChangedCallback(name: string, was: string | null, now: string | null): void {
    // Re-mount on a changed deck, and only on a CHANGED one: setting the same
    // value again is common in frameworks that re-render, and reloading a deck
    // there would restart its narration mid-sentence.
    if (name === "deck" && was !== now && this.isConnected) {
      this.#teardown();
      this.#mount();
    }
  }

  next(): void {
    this.#send({ channel: CHANNEL, type: "next" });
  }
  prev(): void {
    this.#send({ channel: CHANNEL, type: "prev" });
  }
  go(at: number): void {
    this.#send({ channel: CHANNEL, type: "go", at });
  }
  play(on = true): void {
    this.#send({ channel: CHANNEL, type: "play", on });
  }

  #send(msg: Command): void {
    // Dropped rather than queued when the deck has not answered. A queue would
    // replay a burst of arrow presses the moment a slow deck connects, which is
    // worse than the press doing nothing.
    this.#frame?.contentWindow?.postMessage(msg, "*");
  }

  #mount(): void {
    const deck = this.getAttribute("deck");
    if (!deck) return;
    // The deck page, not the composition: `index.html` is what the RENDERER
    // captures and has no navigation in it at all.
    const src = new URL("deck.html", new URL(deck, location.href)).href;

    const frame = document.createElement("iframe");
    frame.src = src;
    frame.setAttribute("allow", "fullscreen; autoplay");
    frame.setAttribute("allowfullscreen", "");
    frame.title = this.getAttribute("label") ?? "Deck";
    frame.style.cssText = "display:block;width:100%;height:100%;border:0";
    this.#frame = frame;

    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || !isOurs(e.data)) return;
      const msg = e.data as FromDeck;
      if (msg.type === "ready") {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = 0;
        this.#connected = true;
        this.#stops = msg.stops;
        this.#at = msg.at;
        this.dispatchEvent(
          new CustomEvent("ds-ready", { detail: { stops: msg.stops, at: msg.at } }),
        );
      } else if (msg.type === "stop") {
        this.#at = msg.at;
        this.dispatchEvent(new CustomEvent("ds-stop", { detail: msg }));
      }
    };
    this.#onMessage = onMessage;
    addEventListener("message", onMessage);

    frame.addEventListener("load", () => {
      // The handshake is sent to "*" ON PURPOSE and is the only message that is:
      // it carries nothing, and the host cannot know the deck's origin before
      // the deck has told it. Everything the DECK sends back is addressed to the
      // origin it learns here.
      frame.contentWindow?.postMessage({ channel: CHANNEL, type: "hello" }, "*");
      this.#timer = setTimeout(() => {
        if (this.#connected) return;
        this.dispatchEvent(
          new CustomEvent("ds-error", {
            detail: {
              reason: "no-bridge",
              message:
                "The deck did not answer. It was probably built before this element existed — it still plays, and its own keyboard still works.",
            },
          }),
        );
      }, HELLO_TIMEOUT_MS);
    });

    if (!this.style.display) this.style.display = "block";
    this.appendChild(frame);
  }

  #teardown(): void {
    // EVERY listener and timer, because a host that swaps decks would otherwise
    // accumulate one live `message` handler per mount, each still dispatching
    // events on a detached element.
    if (this.#onMessage) removeEventListener("message", this.#onMessage);
    if (this.#timer) clearTimeout(this.#timer);
    this.#onMessage = null;
    this.#timer = 0;
    this.#frame?.remove();
    this.#frame = null;
    this.#connected = false;
    this.#stops = [];
    this.#at = 0;
  }
}

/**
 * Register the element, once.
 *
 * GUARDED AND PARAMETERISED because `customElements.define` throws on a
 * duplicate name, and a host page that imports this twice — two bundlers, or a
 * hot reload — should get a no-op rather than an exception that takes the page
 * down. The tag is an argument so a consumer whose page already owns
 * `decksmith-player` can mount it under another name.
 *
 * NOT called at import time. A module with a side effect cannot be imported for
 * its types, and `player-element.ts` exists precisely so the side-effecting
 * entry point is a separate file a consumer opts into.
 */
export function define(tag = "decksmith-player"): void {
  if (typeof customElements === "undefined" || customElements.get(tag)) return;
  customElements.define(tag, DecksmithPlayer);
}
