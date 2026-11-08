// Symbole de chaque zone, à partir des symboles détectés et de leurs étiquettes.

// labels[groupe] = caractère ('' = pas un symbole). Renvoie un tableau (string | null) par zone.
// Le symbole d'une zone part de son plus grand caractère, plus ses voisins sur la
// même ligne (pour « 10 » ou « 12 ») ; une miette de trait isolée est ignorée.
export function regionSymbols(res, labels) {
  const g = res.glyphs;
  const byRegion = new Map();
  for (let k = 0; k < g.n; k++) {
    if (!labels[g.cluster[k]]) continue;
    const r = g.region[k];
    if (!byRegion.has(r)) byRegion.set(r, []);
    byRegion.get(r).push(k);
  }
  const out = new Array(res.M).fill(null);
  const box = k => g.bbox.subarray(4 * k, 4 * k + 4);
  for (const [r, list] of byRegion) {
    let main = list[0];
    for (const k of list) if (h(box(k)) * w(box(k)) > h(box(main)) * w(box(main))) main = k;
    const m = box(main), mh = h(m);
    const row = list.filter(k => {
      if (k === main) return true;
      const b = box(k);
      const overlap = Math.min(b[3], m[3]) - Math.max(b[1], m[1]) + 1;
      const gap = Math.max(b[0] - m[2], m[0] - b[2]);
      return overlap > 0.6 * Math.min(mh, h(b)) && gap < 0.8 * mh && h(b) > 0.7 * mh;
    }).sort((a, b) => g.bbox[4 * a] - g.bbox[4 * b]);
    out[r] = row.map(k => labels[g.cluster[k]]).join('');
  }
  return out;
}
const w = b => b[2] - b[0] + 1;
const h = b => b[3] - b[1] + 1;

// hauteur médiane des membres de chaque groupe
export function clusterHeights(res) {
  const g = res.glyphs, lists = res.clusters.map(() => []);
  for (let k = 0; k < g.n; k++) lists[g.cluster[k]].push(g.bbox[4 * k + 3] - g.bbox[4 * k + 1] + 1);
  return lists.map(l => l.sort((a, b) => a - b)[l.length >> 1] || 0);
}
