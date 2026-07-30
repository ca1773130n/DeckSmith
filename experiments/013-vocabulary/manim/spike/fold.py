"""
SPIKE: can a play-based Manim scene be COMPILED to seek-evaluable fromTo records?

Manim renders by stepping a clock: self.play() calls Animation.begin() (which
snapshots the mobject as it stands RIGHT THEN) and then interpolates forward.
DeckSmith seeks: it sets an absolute time and grabs one frame, in any order.

The claim under test: because begin() records an ABSOLUTE start snapshot and an
ABSOLUTE target snapshot, each play is already a fromTo. Playback at arbitrary t
needs no fold at all -- only the LAST play that touched a given mobject.

Method: run a 5-play scene with self.play replaced by a recorder. Then evaluate
at 200 arbitrary times, in shuffled order, from the records alone, and compare
against a monotone reference produced by the same records walked forwards.
"""
import random
import numpy as np
from manim import *

random.seed(11)


class Recorder:
    """Stands in for Scene, records each play as (t0, t1, anim)."""

    def __init__(self):
        self.t = 0.0
        self.plays = []          # (t0, t1, anim)
        self.mobjects = []

    # -- the Scene surface a construct() needs -------------------------------
    def add(self, *m):
        self.mobjects.extend(m)

    def remove(self, *m):
        for x in m:
            if x in self.mobjects:
                self.mobjects.remove(x)

    def replace(self, old, new):
        self.remove(old)
        self.add(new)

    def get_mobject_family_members(self):
        out = []
        for m in self.mobjects:
            out.extend(m.get_family())
        return out

    def play(self, *anims, run_time=1.0, **kw):
        from manim.animation.animation import prepare_animation
        prepared = [prepare_animation(a) for a in anims]
        for a in prepared:
            a.run_time = run_time
            if isinstance(a, Succession):
                a.scene = self
            a._setup_scene(self)
            a.begin()                       # <-- absolute from/to captured HERE
        t0, t1 = self.t, self.t + run_time
        self.plays.append((t0, t1, prepared))
        # advance the world to the end of this play so the NEXT begin() sees it
        for a in prepared:
            a.finish()
            a.clean_up_from_scene(self)
        self.t = t1
        return prepared

    def wait(self, d=1.0):
        self.t += d

    # -- seek ----------------------------------------------------------------
    def seek(self, T, chronological=True):
        """Set every recorded play to its alpha at absolute time T."""
        order = self.plays if chronological else sorted(self.plays, key=lambda p: random.random())
        for t0, t1, anims in order:
            a = 0.0 if T <= t0 else 1.0 if T >= t1 else (T - t0) / (t1 - t0)
            for an in anims:
                an.interpolate(a)


def snapshot(mobs):
    parts = []
    for m in mobs:
        for sm in m.family_members_with_points():
            parts.append(sm.points.ravel())
            parts.append(np.atleast_1d(np.asarray(sm.fill_opacity, float)).ravel())
    return np.concatenate(parts) if parts else np.zeros(1)


# ---------------------------------------------------------------------------
# a small but real explainer scene: title -> equation -> term morph -> plot
# ---------------------------------------------------------------------------
def construct(s):
    title = Tex("Scaled dot-product attention").to_edge(UP)
    eq1 = MathTex(r"\mathrm{softmax}", r"\left(", "Q", "K^{T}", r"\right)", "V")
    eq2 = MathTex(r"\mathrm{softmax}", r"\left(",
                  r"\frac{Q K^{T}}{\sqrt{d_k}}", r"\right)", "V")
    ax = Axes(x_range=[-4, 4], y_range=[0, 1]).scale(0.4).to_edge(DOWN)
    tracker = ValueTracker(0.5)
    curve = always_redraw(
        lambda: ax.plot(lambda x: 1 / (1 + np.exp(-x / tracker.get_value())),
                        color=YELLOW)
    )

    s.add(title, eq1)
    s.play(Write(title), run_time=1.0)
    s.play(FadeIn(eq1, shift=UP), run_time=1.0)
    s.play(TransformMatchingTex(eq1, eq2), run_time=1.5)
    s.add(ax, curve, tracker)
    s.play(Create(ax), run_time=1.0)
    s.play(tracker.animate.set_value(2.0), run_time=1.5)
    return [title, eq2, ax, curve]


rec = Recorder()
watch = construct(rec)
TOTAL = rec.t
print("compiled %d plays, total %.2fs" % (len(rec.plays), TOTAL))
for i, (t0, t1, anims) in enumerate(rec.plays):
    print("  play %d  [%.2f, %.2f]  %s" % (i, t0, t1, ", ".join(type(a).__name__ for a in anims)))
print()

TIMES = [round(TOTAL * i / 199, 6) for i in range(200)]

# reference: walk the records forwards
ref = {}
for T in TIMES:
    rec.seek(T)
    for m in watch:
        m.update(0)          # pump always_redraw
    ref[T] = snapshot(watch)

# now visit in shuffled order
shuffled = TIMES[:]
random.shuffle(shuffled)
worst = 0.0
badshape = 0
for T in shuffled:
    rec.seek(T)
    for m in watch:
        m.update(0)
    got = snapshot(watch)
    if got.shape != ref[T].shape:
        badshape += 1
        continue
    worst = max(worst, float(np.abs(got - ref[T]).max()))

print("200 absolute times, SHUFFLED, evaluated from records only")
print("  shape mismatches : %d" % badshape)
print("  max deviation    : %.6g" % worst)
print("  VERDICT          : %s" % ("SEEK-EQUIVALENT" if badshape == 0 and worst < 1e-9 else "NOT SEEK-EQUIVALENT"))
print()

# --- how much does a shape-level fromTo actually WEIGH? ---------------------
print("payload cost of shape-level morphing (what would have to reach the browser)")
for label, tex in [("a^2+b^2=c^2", "a^2 + b^2 = c^2"),
                   ("attention", r"\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\left(\frac{QK^{T}}{\sqrt{d_k}}\right)V")]:
    m = MathTex(tex)
    leaves = m.family_members_with_points()
    pts = sum(len(l.points) for l in leaves)
    print("  %-14s %2d glyph leaves, %4d bezier anchor/handle points, %6d floats (x,y,z)"
          % (label, len(leaves), pts, pts * 3))
    # a fromTo pair needs both ends
    print("  %-14s one Transform = %d floats -> %.1f KB as JSON at 3dp"
          % ("", pts * 3 * 2, pts * 3 * 2 * 7 / 1024))
