// Calculs hors du fil principal : l'interface reste fluide même sur une grande image.
import { analyze } from './analyze.js';
import { quantize } from './quantize.js';

self.onmessage = e => {
  const { id, kind, rgba, w, h, opts } = e.data;
  try {
    const t0 = performance.now();
    if (kind === 'photo') {
      const q = quantize(new Uint8ClampedArray(rgba), w, h, opts.colors, opts.scale);
      q.ms = Math.round(performance.now() - t0);
      self.postMessage({ id, res: q }, [q.out.buffer, q.zones.buffer]);
      return;
    }
    const res = analyze(new Uint8ClampedArray(rgba), w, h, opts);
    res.ms = Math.round(performance.now() - t0);
    const transfer = [res.regionOf.buffer, res.shade.buffer, res.offsets.buffer, res.pixels.buffer, res.bbox.buffer,
      res.glyphs.bbox.buffer, res.glyphs.region.buffer, res.glyphs.cluster.buffer];
    self.postMessage({ id, res }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
