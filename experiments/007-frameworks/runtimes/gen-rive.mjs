// Spike: can a PROGRAM emit a .riv with no human step?
// Uses @stevysmith/rive-generator (MIT, third-party, 43KB, no deps).
import { writeFileSync } from 'node:fs';
import { RiveFile, hex, PropertyKey } from '@stevysmith/rive-generator';

const riv = new RiveFile();
const ab = riv.addArtboard({ name: 'Beat', width: 1920, height: 1080 });

// Three "bullet" bars that slide in — the shape of a DeckSmith claim beat,
// minus the text, because the generator has no text API at all.
const bars = [];
for (let i = 0; i < 3; i++) {
  const shape = riv.addShape(ab, { name: `bar${i}`, x: 200, y: 400 + i * 160 });
  riv.addRectangle(shape, { width: 900, height: 90 });
  const fill = riv.addFill(shape);
  riv.addSolidColor(fill, hex(['#3498db', '#e74c3c', '#2ecc71'][i]));
  bars.push(shape);
}

const anim = riv.addLinearAnimation(ab, { name: 'reveal', fps: 60, duration: 120, loop: 'oneShot' });
bars.forEach((shape, i) => {
  const ko = riv.addKeyedObject(anim, shape);
  const kx = riv.addKeyedProperty(ko, PropertyKey.x);
  riv.addKeyFrameDouble(kx, { frame: i * 20, value: -900, interpolation: 'cubic' });
  riv.addKeyFrameDouble(kx, { frame: i * 20 + 40, value: 200, interpolation: 'cubic' });
});

const bytes = riv.export();
writeFileSync(new URL('./out/beat.riv', import.meta.url), bytes);
// determinism of the WRITER itself: export twice, compare
const again = new RiveFile();
// (rebuild identically)
const ab2 = again.addArtboard({ name: 'Beat', width: 1920, height: 1080 });
const bars2 = [];
for (let i = 0; i < 3; i++) {
  const s = again.addShape(ab2, { name: `bar${i}`, x: 200, y: 400 + i * 160 });
  again.addRectangle(s, { width: 900, height: 90 });
  const f = again.addFill(s);
  again.addSolidColor(f, hex(['#3498db', '#e74c3c', '#2ecc71'][i]));
  bars2.push(s);
}
const anim2 = again.addLinearAnimation(ab2, { name: 'reveal', fps: 60, duration: 120, loop: 'oneShot' });
bars2.forEach((s, i) => {
  const ko = again.addKeyedObject(anim2, s);
  const kx = again.addKeyedProperty(ko, PropertyKey.x);
  again.addKeyFrameDouble(kx, { frame: i * 20, value: -900, interpolation: 'cubic' });
  again.addKeyFrameDouble(kx, { frame: i * 20 + 40, value: 200, interpolation: 'cubic' });
});
const b2 = again.export();
const same = Buffer.compare(Buffer.from(bytes), Buffer.from(b2)) === 0;
console.log(`riv bytes=${bytes.length} writer-deterministic=${same} header=${Buffer.from(bytes.slice(0, 4)).toString()}`);
