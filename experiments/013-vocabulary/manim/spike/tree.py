import sys, numpy as np
from manim import *
from manim.animation.transform_matching_parts import TransformMatchingTex, TransformMatchingShapes

def dump(m, indent=0, path="root"):
    lines = []
    kind = type(m).__name__
    ts = getattr(m, "tex_string", None)
    npts = len(m.points) if hasattr(m, "points") else 0
    try:
        w, h = m.width, m.height
    except Exception:
        w = h = float("nan")
    lines.append("%s%s  n_sub=%d  pts=%d  w=%.3f h=%.3f%s" % (
        "  " * indent, kind, len(m.submobjects), npts, w, h,
        ("  tex=%r" % ts) if ts is not None else ""))
    for i, s in enumerate(m.submobjects):
        lines += dump(s, indent + 1, path + "[%d]" % i)
    return lines

def show(title, mob):
    print("=" * 78)
    print(title)
    print("=" * 78)
    print("\n".join(dump(mob)))
    print()

# --- 1. one string, no author split -----------------------------------------
a = MathTex(r"a^2 + b^2 = c^2")
show('MathTex(r"a^2 + b^2 = c^2")   [ONE argument]', a)

# --- 2. author-split ---------------------------------------------------------
b = MathTex("a^2", "+", "b^2", "=", "c^2")
show('MathTex("a^2","+","b^2","=","c^2")   [FIVE arguments]', b)

# --- 3. the {{ }} sugar ------------------------------------------------------
c = MathTex("{{a}}^2", "+", "{{b}}^2", "=", "{{c}}^2")
show('MathTex("{{a}}^2","+","{{b}}^2","=","{{c}}^2")', c)
print("tex_strings after {{}} preprocessing:", c.tex_strings)
print()

# --- 4. a real paper formula -------------------------------------------------
att = MathTex(r"\mathrm{Attention}(Q,K,V)",
              "=",
              r"\mathrm{softmax}",
              r"\left(\frac{QK^{T}}{\sqrt{d_k}}\right)",
              "V")
show("scaled dot-product attention, author-split into 5", att)

att1 = MathTex(r"\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\left(\frac{QK^{T}}{\sqrt{d_k}}\right)V")
print("SAME formula as ONE string: top-level children =", len(att1.submobjects),
      " glyph leaves =", len(att1.family_members_with_points()))
print("its single child's tex_string =", repr(att1[0].tex_string))
print()

# --- 5. what TransformMatchingTex actually keys on ---------------------------
print("=" * 78); print("TransformMatchingTex key extraction"); print("=" * 78)
eq1 = MathTex("{{a}}^2", "+", "{{b}}^2", "=", "{{c}}^2")
eq2 = MathTex("{{a}}^2", "=", "{{c}}^2", "-", "{{b}}^2")
p1 = TransformMatchingTex.get_mobject_parts(eq1)
p2 = TransformMatchingTex.get_mobject_parts(eq2)
k1 = [TransformMatchingTex.get_mobject_key(p) for p in p1]
k2 = [TransformMatchingTex.get_mobject_key(p) for p in p2]
print("source keys:", k1)
print("target keys:", k2)
print("MATCHED (transformed):", sorted(set(k1) & set(k2)))
print("source-only (faded out):", sorted(set(k1) - set(k2)))
print("target-only (faded in): ", sorted(set(k2) - set(k1)))
print()

# the failure mode: one string -> no keys
one1 = MathTex("a^2 + b^2 = c^2")
one2 = MathTex("a^2 = c^2 - b^2")
q1 = [TransformMatchingTex.get_mobject_key(p) for p in TransformMatchingTex.get_mobject_parts(one1)]
q2 = [TransformMatchingTex.get_mobject_key(p) for p in TransformMatchingTex.get_mobject_parts(one2)]
print("UNSPLIT source keys:", q1)
print("UNSPLIT target keys:", q2)
print("UNSPLIT matched:", sorted(set(q1) & set(q2)), " <- nothing matches, whole thing crossfades")
print()

# --- 6. TransformMatchingShapes keying --------------------------------------
print("=" * 78); print("TransformMatchingShapes key extraction (glyph-level)"); print("=" * 78)
s1 = MathTex("a^2 + b^2 = c^2")
s2 = MathTex("a^2 = c^2 - b^2")
r1 = TransformMatchingShapes.get_mobject_parts(s1)
r2 = TransformMatchingShapes.get_mobject_parts(s2)
h1 = [TransformMatchingShapes.get_mobject_key(p) for p in r1]
h2 = [TransformMatchingShapes.get_mobject_key(p) for p in r2]
print("source has %d leaf glyphs, %d distinct shape hashes" % (len(h1), len(set(h1))))
print("target has %d leaf glyphs, %d distinct shape hashes" % (len(h2), len(set(h2))))
print("shape hashes in common: %d of %d source hashes" % (len(set(h1) & set(h2)), len(set(h1))))
print("NOTE duplicate-key collapse: source keys are unique? ", len(h1) == len(set(h1)))
print()

# --- 7. is Transform a pure function of alpha? -------------------------------
print("=" * 78); print("PURITY PROBE: Transform.interpolate(alpha)"); print("=" * 78)
src = MathTex("a^2", "+", "b^2", "=", "c^2")
tgt = MathTex("a^2", "=", "c^2", "-", "b^2").shift(DOWN)
t = Transform(src, tgt)
t.begin()

def snap(m):
    return np.concatenate([sm.points.copy().ravel() for sm in m.family_members_with_points()])

# forward sweep
t.interpolate(0.0); z0 = snap(src)
t.interpolate(0.3); f3 = snap(src)
t.interpolate(0.7); f7 = snap(src)
t.interpolate(1.0); f10 = snap(src)
# now go BACKWARD and out of order
t.interpolate(0.3); b3 = snap(src)
t.interpolate(0.0); b0 = snap(src)
t.interpolate(0.7); b7 = snap(src)
print("interpolate(0.3) forward == backward :", np.allclose(f3, b3), "  maxdiff=%.3g" % np.abs(f3-b3).max())
print("interpolate(0.0) forward == backward :", np.allclose(z0, b0), "  maxdiff=%.3g" % np.abs(z0-b0).max())
print("interpolate(0.7) forward == backward :", np.allclose(f7, b7), "  maxdiff=%.3g" % np.abs(f7-b7).max())
# random-order 200 probes, compare against a fresh forward-only reference
import random
random.seed(1)
ref = {}
t2 = Transform(MathTex("a^2","+","b^2","=","c^2"), MathTex("a^2","=","c^2","-","b^2").shift(DOWN))
t2.begin()
alphas = [i/40 for i in range(41)]
for al in alphas:
    t2.interpolate(al); ref[al] = snap(t2.mobject)
shuffled = alphas[:]; random.shuffle(shuffled)
worst = 0.0
for al in shuffled:
    t.interpolate(al)
    worst = max(worst, float(np.abs(snap(src) - ref[al]).max()))
print("41 alphas visited in RANDOM order vs monotone reference: max deviation = %.3g" % worst)
print()

# --- 8. AnimationGroup / Succession purity ----------------------------------
print("=" * 78); print("PURITY PROBE: Succession.interpolate(alpha)"); print("=" * 78)
d1 = Dot(); d2 = Dot()
def mk():
    a1, a2 = Dot(), Dot()
    s = Succession(a1.animate.shift(RIGHT*3), a2.animate.shift(UP*2))
    s.scene = None
    return s, a1, a2
sc, m1, m2 = mk()
sc.begin()
sc.interpolate(0.9)
late = (m1.get_center().copy(), m2.get_center().copy())
sc.interpolate(0.1)          # seek BACKWARD
back = (m1.get_center().copy(), m2.get_center().copy())
sc2, n1, n2 = mk()
sc2.begin(); sc2.interpolate(0.1)
fresh = (n1.get_center().copy(), n2.get_center().copy())
print("after fwd 0.9 then seek back to 0.1 :", back[0].round(4), back[1].round(4))
print("cold evaluation at 0.1              :", fresh[0].round(4), fresh[1].round(4))
print("Succession backward-seek correct?   :",
      np.allclose(back[0], fresh[0]) and np.allclose(back[1], fresh[1]))
print()

print("=" * 78); print("PURITY PROBE: AnimationGroup cold jump vs sweep"); print("=" * 78)
def mkg():
    a1, a2, a3 = Dot(), Dot(), Dot()
    return LaggedStart(a1.animate.shift(RIGHT), a2.animate.shift(RIGHT*2),
                       a3.animate.shift(RIGHT*3), lag_ratio=0.5), (a1,a2,a3)
g, ms = mkg(); g.begin(); g.interpolate(0.5)
sweep = [m.get_center().copy() for m in ms]
g2, ms2 = mkg(); g2.begin()
for al in [0.0,0.1,0.2,0.3,0.4,0.5]: g2.interpolate(al)
sweep2 = [m.get_center().copy() for m in ms2]
g3, ms3 = mkg(); g3.begin()
for al in [1.0, 0.5]: g3.interpolate(al)
after_end = [m.get_center().copy() for m in ms3]
print("cold jump to 0.5      :", [x.round(4).tolist() for x in sweep])
print("monotone sweep to 0.5 :", [x.round(4).tolist() for x in sweep2])
print("1.0 then back to 0.5  :", [x.round(4).tolist() for x in after_end])
print("cold == sweep :", all(np.allclose(a,b) for a,b in zip(sweep,sweep2)))
print("cold == rewind:", all(np.allclose(a,b) for a,b in zip(sweep,after_end)))
