// mockup-only: crop a source image region into a box of the given width
// data-crop="src,imgW,x,y,w,h"
for (const el of document.querySelectorAll('[data-crop]')) {
  const [src, iw, x, y, w, h] = el.dataset.crop.split(',');
  const W = el.offsetWidth, s = W / +w;
  el.style.height = `${(+h) * s}px`;
  el.style.backgroundImage = `url(${src})`;
  el.style.backgroundSize = `${(+iw) * s}px auto`;
  el.style.backgroundPosition = `${-x * s}px ${-y * s}px`;
}
