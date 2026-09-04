# Three views of one frame, and why two of them are not the render

**Date** 2026-09-04. Run while exposing the `fidelity` gate's capture path as
`decksmith frames`, to check the claim that motivated the work: that the frame a
human looks at should be, and now is, the frame the renderer would produce. The
first half of that is still right. The second half did not survive the test.

## What was staged

`demo/deck`, copied, with one thing added before `</body>`: a fixed band across
the top of the canvas whose opacity is written **only** from a GSAP `onUpdate`
callback hung off a three-second tween on scene `s3`'s own paused timeline.

```js
window.__timelines.s3.to(proxy, {
  v: 1, duration: 3, ease: "none",
  onUpdate: function () {
    document.getElementById("lab-flag").style.opacity = String(proxy.v);
  }
}, 0);
```

Nothing is tweened on the element itself. This is invariant 11's forbidden shape,
built on purpose: if a callback cannot move anything under capture, this band can
never be anything but transparent.

`s3` runs 15–24s absolute, so the tween covers 15–18s and t=17.0 sits two thirds
through it. Expected mid-tween red, if the callback runs: 0.667 × 208 ≈ 139.

## What each tool showed at that instant

Mean RGB of the top 200px band.

| view | RGB | what it means |
| --- | --- | --- |
| `decksmith frames` | (11,13,17) | background. The callback never ran. |
| `hyperframes snapshot` | (143,4,5) | mid-tween, as a browser would play it. |
| `hyperframes render` | ramps to (205,0,0) | the callback ran, repeatedly. |

The render was scanned frame by frame rather than sampled: 3120 frames, one
averaged pixel each. The band is at background through frame 474, first exceeds
the threshold at frame 475 (t=15.83s), and then climbs — 43, 44, 46, 49, 51, 52,
56 … 109 — with **68 frames landing strictly between background and full red**,
against the ~90 a three-second tween at 30fps predicts. That is a genuine ramp,
not a snap. From frame ~540 it sits at 205 for the remaining 88 seconds, because
the inline style is never reset once written.

## The surprise

Invariant 11 says a callback "NEVER FIRES under capture", and that motion driven
by one "plays perfectly in a browser and renders a **frozen video**". Here it
rendered as a correct three-second animation.

The mechanism is not mysterious. `src/emit/composition.ts` already says it:
capture is driven by Chrome's `beginFrame`, not by the rAF loop — and the render
log confirms `"captureMode":"beginframe"`. Under `beginFrame` the page's clock
advances and GSAP ticks, so callbacks run. `suppressEvents` is a property of a
**seek**, and the shipping capture is not seeking.

So one of two things is true, and this experiment does not distinguish them:

1. **Invariant 11 is narrower than it reads.** It would be exactly right about a
   seek-driven capture (`forceScreenshot`, and both frame tools here) and wrong
   about the `beginFrame` path the renderer actually uses.
2. **This injection is unlike the failure the invariant was written from.** The
   tween is added late, after the runtime has built the timelines. A tween
   present at build time might be handled differently — though suppression is a
   property of the seek call, not of the tween, so late addition should not
   matter.

Resolving it needs a deck whose callback-driven motion is emitted by an archetype
rather than injected, rendered once. That is cheap — one render — and it has not
been done.

## What this changes now

- **`decksmith frames` is the `fidelity` gate's view, not the render's.** That is
  still worth having and worth shipping: it is what the gate saw, which is the
  right thing to look at when asking why a gate said what it said. The README
  says exactly that and no more.
- **No still frame settles invariant 11.** All three tools disagree, and the one
  that ships disagrees with both of the cheap ones. Watch the mp4.
- **The rule against callback-driven state stands regardless.** Whichever branch
  is true, it is the shape none of the cheap instruments agree about, and that is
  reason enough not to write it.
- **The css3d spike's snapshot claim did not reproduce.** A static CSS 3D
  transform (`rotateY(22deg) rotateX(10deg)` with perspective, injected into the
  same deck) came back correctly rotated under BOTH `frames` and
  `hyperframes snapshot` — no flat frame. Whatever produced the flat frame at
  t=3.9s in `.planning/2026-09-04-css-3d-spike.md`, it was not static CSS 3D, and
  that note should not be read as "snapshot cannot draw perspective".

## Evidence kept

`~/.blackhole/DeckSmith/2026-09-04/lab-truth.mp4` — the render scanned above,
104s, from `onupdate-lab/`. Delete once someone has either reproduced the ramp or
run the emitted-archetype version that supersedes it.
