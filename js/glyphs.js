// Reconnaissance des symboles : on compare la forme trouvée dans l'image aux
// caractères dessinés avec quelques polices courantes. Pas d'OCR externe.
import { featureOf, featDist } from './analyze.js';

const FONTS = ['Arial', 'Verdana', 'DejaVu Sans', 'Roboto', 'Segoe UI', 'sans-serif'];
export const DEFAULT_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const cache = new Map();

// Caractère dessiné à la hauteur du symbole trouvé : même anticrénelage, même épaisseur relative
const ctx = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  return c.getContext('2d', { willReadFrequently: true });
})();

function inkBox(d, S, min) {
  let x0 = S, y0 = S, x1 = -1, y1 = -1;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (d[(y * S + x) * 4 + 3] >= min) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

function draw(ch, font, weight, px) {
  const S = 160;
  ctx.clearRect(0, 0, S, S);
  ctx.font = `${weight} ${px}px "${font}"`;
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, 20, 80);
  return ctx.getImageData(0, 0, S, S).data;
}

function templates(ch, h) {
  const key = ch + '|' + h;
  if (cache.has(key)) return cache.get(key);
  const list = [];
  for (const font of FONTS) {
    for (const weight of ['400', '700']) {
      const big = inkBox(draw(ch, font, weight, 100), 160, 128);
      if (!big) continue;
      const px = 100 * h / (big[3] - big[1] + 1);
      const d = draw(ch, font, weight, Math.min(140, px));
      const b = inkBox(d, 160, 90);
      if (!b) continue;
      list.push(featureOf((x, y) => d[(y * 160 + x) * 4 + 3] / 255, b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1));
    }
  }
  cache.set(key, list);
  return list;
}

export function best(mean, chars, h) {
  let sym = '', bd = Infinity;
  for (const ch of chars) {
    const bias = /\d/.test(ch) ? -0.004 : 0; // à forme égale, 0 plutôt que O
    for (const t of templates(ch, Math.max(5, Math.min(60, Math.round(h))))) {
      const d = featDist(mean, t) + bias;
      if (d < bd) { bd = d; sym = ch; }
    }
  }
  return { sym, dist: bd };
}

// heights[k] : hauteur médiane en pixels des symboles du groupe k.
// Renvoie le caractère proposé pour chaque groupe ('' si rien de crédible)
// et la liste des caractères qui semblent utilisés dans le coloriage.
export function autoLabels(clusters, heights, symbols) {
  let chars = symbols;
  if (!chars) {
    // 1. Les symboles lisibles décident de l'alphabet du coloriage : une lecture
    // très sûre suffit, une lecture moyenne doit se répéter
    const count = new Map(), sure = new Set();
    clusters.forEach((cl, k) => {
      if (heights[k] < 9) return;
      const b = best(cl.mean, DEFAULT_CHARS.split(''), heights[k]);
      if (b.dist < 0.06) sure.add(b.sym);
      if (b.dist < 0.12) count.set(b.sym, (count.get(b.sym) || 0) + cl.n);
    });
    chars = [...new Set([...sure, ...[...count].filter(([, n]) => n >= 2).map(([s]) => s)])];
  }
  chars = sortSymbols(chars.filter(s => s.length === 1));
  // 2. Tous les groupes, petits compris, ne choisissent que parmi cet alphabet
  const labels = clusters.map((cl, k) => {
    if (!chars.length) return '';
    const b = best(cl.mean, chars, heights[k]);
    return b.dist < 0.15 ? b.sym : '';
  });
  return { labels, symbols: chars };
}

export function sortSymbols(list) {
  return [...list].sort((a, b) => {
    const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
    if (na && nb) return Number(a) - Number(b);
    if (na !== nb) return na ? -1 : 1;
    return a.localeCompare(b, 'fr');
  });
}
