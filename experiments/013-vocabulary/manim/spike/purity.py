import random, numpy as np
from manim import *

random.seed(7)
ALPHAS = [i / 40 for i in range(41)]

def snap(m):
    fam = m.family_members_with_points()
    if not fam:
        return np.array([0.0])
    return np.concatenate([np.concatenate([sm.points.ravel(),
                                           np.atleast_1d(np.asarray(sm.fill_opacity, dtype=float)).ravel(),
                                           np.atleast_1d(np.asarray(sm.stroke_opacity, dtype=float)).ravel()])
                           for sm in fam])

def probe(name, factory, watch=None):
    """factory() -> (animation, mobject_to_watch). Compare monotone sweep vs random order."""
    a1, w1 = factory()
    if isinstance(a1, Succession): a1.scene = None
    a1.begin()
    ref = {}
    for al in ALPHAS:
        a1.interpolate(al)
        ref[al] = snap(w1)
    a2, w2 = factory()
    if isinstance(a2, Succession): a2.scene = None
    a2.begin()
    order = ALPHAS[:]
    random.shuffle(order)
    worst = 0.0
    for al in order:
        a2.interpolate(al)
        r, g = snap(w2), ref[al]
        if r.shape != g.shape:
            print("%-34s SHAPE MISMATCH -> IMPURE" % name)
            return
        worst = max(worst, float(np.abs(r - g).max()))
    verdict = "PURE" if worst < 1e-9 else "IMPURE"
    print("%-34s max|random - monotone| = %-10.4g  %s" % (name, worst, verdict))

# ---- Transform family -------------------------------------------------------
def f_transform():
    a = Square(); b = Circle().shift(RIGHT*2)
    return Transform(a, b, path_arc=PI/3), a
probe("Transform(path_arc)", f_transform)

def f_replacement():
    a = Square(); b = Circle().shift(RIGHT*2)
    return ReplacementTransform(a, b), a
probe("ReplacementTransform", f_replacement)

def f_fadetransform():
    a = Square(); b = Circle().shift(RIGHT*2)
    return FadeTransform(a, b), a
probe("FadeTransform", f_fadetransform)

def f_animate():
    a = Square()
    return a.animate.shift(RIGHT*3).set_fill(RED, 1).build(), a
probe(".animate builder", f_animate)

def f_rotate():
    a = Square()
    return Rotate(a, PI), a
probe("Rotate", f_rotate)

def f_applymatrix():
    a = Square()
    return ApplyMatrix([[2, 1], [0, 1]], a), a
probe("ApplyMatrix", f_applymatrix)

def f_applypointwise():
    a = Circle()
    return ApplyPointwiseFunction(lambda p: p * 2 + RIGHT, a), a
probe("ApplyPointwiseFunction", f_applypointwise)

# ---- creation family --------------------------------------------------------
def f_create():
    a = Circle()
    return Create(a), a
probe("Create", f_create)

def f_uncreate():
    a = Circle()
    return Uncreate(a), a
probe("Uncreate", f_uncreate)

def f_write():
    a = Text("morse")
    return Write(a), a
probe("Write(Text)", f_write)

def f_drawborder():
    a = Square(fill_opacity=1)
    return DrawBorderThenFill(a), a
probe("DrawBorderThenFill", f_drawborder)

def f_fadein():
    a = Square()
    return FadeIn(a, shift=UP), a
probe("FadeIn(shift)", f_fadein)

def f_fadeout():
    a = Square()
    return FadeOut(a, shift=UP), a
probe("FadeOut(shift)", f_fadeout)

def f_growfrom():
    a = Square()
    return GrowFromCenter(a), a
probe("GrowFromCenter", f_growfrom)

def f_spiral():
    a = Text("hi")
    return SpiralIn(a), a
probe("SpiralIn", f_spiral)

# ---- indication -------------------------------------------------------------
def f_indicate():
    a = Square()
    return Indicate(a), a
probe("Indicate", f_indicate)

def f_flash():
    a = Square()
    return Circumscribe(a), a
probe("Circumscribe", f_flash)

def f_wiggle():
    a = Square()
    return Wiggle(a), a
probe("Wiggle", f_wiggle)

def f_passing():
    a = Line(LEFT*3, RIGHT*3)
    return ShowPassingFlash(a), a
probe("ShowPassingFlash", f_passing)

# ---- composition ------------------------------------------------------------
def f_group():
    a, b, c = Square(), Circle(), Triangle()
    g = VGroup(a, b, c)
    return AnimationGroup(a.animate.shift(UP), b.animate.shift(DOWN),
                          c.animate.scale(2)), g
probe("AnimationGroup", f_group)

def f_lagged():
    ms = VGroup(*[Dot().shift(LEFT*i) for i in range(5)])
    return LaggedStart(*[m.animate.shift(UP) for m in ms], lag_ratio=0.4), ms
probe("LaggedStart(lag_ratio=0.4)", f_lagged)

def f_lagged_map():
    ms = VGroup(*[Dot().shift(LEFT*i) for i in range(5)])
    return LaggedStartMap(FadeIn, ms, lag_ratio=0.5), ms
probe("LaggedStartMap", f_lagged_map)

def f_succession():
    a, b = Dot(), Dot()
    s = Succession(a.animate.shift(RIGHT*3), b.animate.shift(UP*2))
    s.scene = None
    return s, VGroup(a, b)
probe("Succession", f_succession)

def f_nested_succ():
    a, b, c = Dot(), Dot(), Dot()
    s = Succession(a.animate.shift(RIGHT), b.animate.shift(UP))
    s.scene = None
    return AnimationGroup(s, c.animate.shift(DOWN)), VGroup(a, b, c)
probe("AnimationGroup(Succession,..)", f_nested_succ)

# ---- ValueTracker / updaters ------------------------------------------------
print()
print("---- ValueTracker + always_redraw, driven by Transform ----")
def f_vt():
    t = ValueTracker(0)
    dot = always_redraw(lambda: Dot().shift(RIGHT * 3 * t.get_value()))
    anim = t.animate.set_value(1).build()
    class Pair:
        pass
    p = VGroup(dot)
    class Wrapped:
        def __init__(s): s.a = anim; s.t = t; s.dot = dot
    return anim, (t, dot)

# custom probe because the redraw has to be pumped
def probe_vt():
    def build():
        t = ValueTracker(0)
        dot = always_redraw(lambda: Dot().shift(RIGHT * 3 * t.get_value()))
        a = t.animate.set_value(1).build()
        a.begin()
        return a, t, dot
    a1, t1, d1 = build()
    ref = {}
    for al in ALPHAS:
        a1.interpolate(al); d1.update(0)
        ref[al] = d1.get_center().copy()
    a2, t2, d2 = build()
    order = ALPHAS[:]; random.shuffle(order)
    worst = 0.0
    for al in order:
        a2.interpolate(al); d2.update(0)
        worst = max(worst, float(np.abs(d2.get_center() - ref[al]).max()))
    print("%-34s max|random - monotone| = %-10.4g  %s" %
          ("ValueTracker+always_redraw", worst, "PURE" if worst < 1e-9 else "IMPURE"))
probe_vt()

print("---- dt-driven updater (always_rotate) ----")
def probe_dt():
    def build():
        sq = Square()
        always_rotate(sq, rate=PI)
        return sq
    # emulate a monotone 30fps play of 1 second
    s1 = build()
    for _ in range(30):
        s1.update(1/30)
    monotone = s1.points.copy()
    # emulate a SEEK: one call with dt = total elapsed
    s2 = build()
    s2.update(1.0)
    seeked = s2.points.copy()
    # emulate a seek that never pumped intermediate frames at all
    s3 = build()
    s3.update(0)
    cold = s3.points.copy()
    print("30 x dt=1/30 vs 1 x dt=1.0 identical?",
          np.allclose(np.asarray(monotone), np.asarray(seeked)))
    print("cold single update(0) equals either? ",
          np.allclose(s3.points, s1.points), np.allclose(s3.points, s2.points))
    print("-> always_rotate/always_shift are TIME INTEGRATORS: state = f(history of dt)")
probe_dt()

print()
print("---- rate functions: pure? ----")
from manim.utils import rate_functions as rf
import inspect
names = [n for n, f in vars(rf).items()
         if callable(f) and not n.startswith("_") and n not in ("unit_interval", "zero")]
impure = []
for n in sorted(names):
    f = getattr(rf, n)
    try:
        sig = inspect.signature(f)
    except (ValueError, TypeError):
        continue
    if len(sig.parameters) == 0:
        continue
    try:
        v1 = [f(x) for x in (0, .25, .5, .75, 1)]
        v2 = [f(x) for x in (1, .75, .5, .25, 0)][::-1]
        if not np.allclose(v1, v2):
            impure.append(n)
    except Exception:
        pass
print("rate functions checked:", len(names), " order-dependent:", impure or "none")
