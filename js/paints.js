// Recettes de mélange avec des tubes de peinture courants (gouache ou acrylique).
// Modèle de Kubelka-Munk à une constante, canal par canal : un mélange de pigments
// absorbe, il ne s'additionne pas comme de la lumière (bleu + jaune donne du vert).
// shortcut: couleurs des tubes approchées en sRGB et même pouvoir colorant pour tous ;
// le dosage est indicatif. Passer à des spectres mesurés si la précision devient un besoin.

export const PAINTS = [
  { id: 'blanc', name: 'Blanc de titane', hex: '#f4f3ef' },
  { id: 'noir', name: 'Noir', hex: '#1d1c1e' },
  { id: 'jaune', name: 'Jaune primaire', hex: '#f6d21c' },
  { id: 'ocre', name: 'Ocre jaune', hex: '#c8952e' },
  { id: 'rouge', name: 'Rouge vermillon', hex: '#dc3a22' },
  { id: 'magenta', name: 'Magenta primaire', hex: '#c51a6f' },
  { id: 'cyan', name: 'Bleu cyan primaire', hex: '#0a86c6' },
  { id: 'outremer', name: 'Bleu outremer', hex: '#2c3190' },
  { id: 'vert', name: 'Vert émeraude', hex: '#108a5c' },
  { id: 'sienne', name: 'Terre de Sienne brûlée', hex: '#8c3d20' },
];

// Parts possibles d'un tube face à la plus petite (1 part) : les teintes claires
// demandent beaucoup de blanc pour une pointe de pigment.
const STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 40, 60];

const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const gam = v => Math.round(255 * Math.max(0, Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const ks = R => { R = Math.max(R, 0.001); return (1 - R) ** 2 / (2 * R); };
const unks = k => 1 + k - Math.sqrt(k * k + 2 * k);

const KS = PAINTS.map(p => hexRgb(p.hex).map(v => ks(lin(v))));

// couleur obtenue en mélangeant parts[j] parts de la peinture idx[j]
export function mixRgb(idx, parts) {
  const tot = parts.reduce((a, b) => a + b, 0);
  return [0, 1, 2].map(c => gam(unks(idx.reduce((s, p, j) => s + KS[p][c] * parts[j], 0) / tot)));
}

const lab = ([r, g, b]) => labLin(lin(r), lin(g), lin(b));
function labLin(R, G, B) {
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export const deltaE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

// Meilleure recette pour une couleur : 1 à 3 tubes, le moins dosé vaut 1 part.
// À précision voisine, on préfère moins de tubes et moins de parts.
export function recipe(hex) {
  const T = lab(hexRgb(hex)), n = PAINTS.length;
  let best = null;
  const tryMix = (idx, parts) => {
    let tot = 0;
    for (const p of parts) tot += p;
    let k0 = 0, k1 = 0, k2 = 0;
    for (let j = 0; j < idx.length; j++) { const K = KS[idx[j]]; k0 += K[0] * parts[j]; k1 += K[1] * parts[j]; k2 += K[2] * parts[j]; }
    const L = labLin(unks(k0 / tot), unks(k1 / tot), unks(k2 / tot));
    const dE = Math.hypot(L[0] - T[0], L[1] - T[1], L[2] - T[2]);
    const score = dE + 1.5 * (idx.length - 1) + 0.6 * Math.log2(tot);
    if (!best || score < best.score) best = { score, dE, idx, parts };
  };
  for (let a = 0; a < n; a++) {
    tryMix([a], [1]);
    for (let b = a + 1; b < n; b++) {
      for (const s of STEPS) { tryMix([a, b], [s, 1]); if (s > 1) tryMix([a, b], [1, s]); }
      for (let c = b + 1; c < n; c++)
        for (const s of STEPS) for (const t of STEPS) {
          tryMix([a, b, c], [1, s, t]);
          if (s > 1) tryMix([a, b, c], [s, 1, t]);
          if (s > 1 && t > 1) tryMix([a, b, c], [s, t, 1]);
        }
    }
  }
  const items = best.idx.map((p, j) => ({ paint: PAINTS[p], parts: best.parts[j] })).sort((x, y) => y.parts - x.parts);
  const hex2 = '#' + mixRgb(best.idx, best.parts).map(v => v.toString(16).padStart(2, '0')).join('');
  return { items, mix: hex2, dE: best.dE };
}
