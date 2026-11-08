// Photo → coloriage numéroté (calcul pur, lancé dans le worker).
// Couleurs réduites par k-means en Lab, puis les zones trop petites ou trop fines
// pour porter un numéro sont fondues dans leur voisine. Rendu agrandi ×S avec des
// bords arrondis : on renvoie l'étiquette de couleur de chaque pixel agrandi.

const MIN_D = 3.5;   // rayon intérieur minimal d'une zone (pixels de travail) : la place d'un numéro
const MIN_AREA = 45;

export function quantize(rgba, W, H, K, S) {
  const N = W * H;
  const L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const [l, a, b] = toLab(rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]);
    L[i] = l; A[i] = a; B[i] = b;
  }
  for (const ch of [L, A, B]) { blur(ch, W, H); blur(ch, W, H); }

  // k-means++ sur un échantillon, graine fixe : la même photo donne le même coloriage
  const rnd = mulberry(7);
  const step = Math.max(1, Math.floor(N / 24000));
  const sample = [];
  for (let i = 0; i < N; i += step) sample.push(i);
  const C = [];
  const pick = i => C.push([L[i], A[i], B[i]]);
  pick(sample[Math.floor(rnd() * sample.length)]);
  const dmin = new Float64Array(sample.length).fill(Infinity);
  while (C.length < K) {
    const c = C[C.length - 1];
    let sum = 0;
    sample.forEach((i, s) => { const d = dist(L[i], A[i], B[i], c); if (d < dmin[s]) dmin[s] = d; sum += dmin[s]; });
    if (sum === 0) break; // photo avec moins de couleurs que demandé
    let t = rnd() * sum, s = 0;
    while (s < sample.length - 1 && (t -= dmin[s]) > 0) s++;
    pick(sample[s]);
  }
  const k = C.length;
  for (let it = 0; it < 14; it++) {
    const acc = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (const i of sample) {
      const c = acc[nearest(L[i], A[i], B[i], C)];
      c[0] += L[i]; c[1] += A[i]; c[2] += B[i]; c[3]++;
    }
    acc.forEach((a, j) => { if (a[3]) C[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  let lab = new Uint8Array(N);
  for (let i = 0; i < N; i++) lab[i] = nearest(L[i], A[i], B[i], C);
  for (let p = 0; p < 2; p++) lab = majority(lab, W, H, k);

  // fusion des zones trop petites, jusqu'à ce qu'il n'en reste plus
  let comp;
  for (let it = 0; it < 40; it++) {
    comp = components(lab, W, H);
    const small = [];
    for (let c = 0; c < comp.n; c++) if (comp.size[c] < MIN_AREA || comp.dmax[c] < MIN_D * 3) small.push(c);
    if (!small.length) break;
    small.sort((a, b) => comp.size[a] - comp.size[b]);
    const votes = new Int32Array(k);
    for (const c of small) {
      votes.fill(0);
      const own = lab[comp.pixels[comp.start[c]]];
      for (let q = comp.start[c]; q < comp.start[c + 1]; q++) {
        const i = comp.pixels[q], x = i % W;
        if (x > 0 && lab[i - 1] !== own) votes[lab[i - 1]]++;
        if (x < W - 1 && lab[i + 1] !== own) votes[lab[i + 1]]++;
        if (i >= W && lab[i - W] !== own) votes[lab[i - W]]++;
        if (i < N - W && lab[i + W] !== own) votes[lab[i + W]]++;
      }
      let best = -1;
      for (let j = 0; j < k; j++) if (votes[j] && (best < 0 || votes[j] > votes[best])) best = j;
      if (best < 0) continue; // zone seule sur toute l'image
      for (let q = comp.start[c]; q < comp.start[c + 1]; q++) lab[comp.pixels[q]] = best;
    }
  }
  comp = components(lab, W, H); // à jour même si la boucle s'est arrêtée au plafond

  // couleurs réellement utilisées, de la plus foncée à la plus claire
  const sum = Array.from({ length: k }, () => [0, 0, 0, 0]);
  for (let i = 0; i < N; i++) { const s = sum[lab[i]]; s[0] += rgba[4 * i]; s[1] += rgba[4 * i + 1]; s[2] += rgba[4 * i + 2]; s[3]++; }
  const used = sum.map((s, j) => ({ j, n: s[3], rgb: s.slice(0, 3).map(v => Math.round(v / (s[3] || 1))) }))
    .filter(u => u.n).sort((a, b) => lum(a.rgb) - lum(b.rgb));
  const remap = new Uint8Array(k);
  used.forEach((u, idx) => { remap[u.j] = idx; });
  for (let i = 0; i < N; i++) lab[i] = remap[lab[i]];

  // une étiquette par zone : là où elle est la plus large
  const zones = new Float32Array(comp.n * 4);
  for (let c = 0; c < comp.n; c++) {
    const i = comp.at[c];
    zones.set([(i % W + 0.5) * S, (Math.floor(i / W) + 0.5) * S, comp.dmax[c] / 3 * S, lab[i]], 4 * c);
  }
  return { colors: used.map(u => u.rgb), OW: W * S, OH: H * S, out: upscale(lab, W, H, S), zones };
}

// Agrandissement ×S : chaque pixel prend l'étiquette qui pèse le plus parmi ses
// 4 voisins de travail (interpolation bilinéaire des étiquettes) → bords arrondis
function upscale(lab, W, H, S) {
  const OW = W * S, OH = H * S, out = new Uint8Array(OW * OH);
  for (let Y = 0; Y < OH; Y++) {
    const fy = (Y + 0.5) / S - 0.5, y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(H - 1, y0 + 1);
    const ty = Math.min(1, Math.max(0, fy - y0));
    for (let X = 0; X < OW; X++) {
      const fx = (X + 0.5) / S - 0.5, x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(W - 1, x0 + 1);
      const tx = Math.min(1, Math.max(0, fx - x0));
      const a = lab[y0 * W + x0], b = lab[y0 * W + x1], c = lab[y1 * W + x0], d = lab[y1 * W + x1];
      const wa = (1 - tx) * (1 - ty), wb = tx * (1 - ty), wc = (1 - tx) * ty, wd = tx * ty;
      const weight = v => (a === v ? wa : 0) + (b === v ? wb : 0) + (c === v ? wc : 0) + (d === v ? wd : 0);
      let best = a, bw = weight(a);
      for (const v of [b, c, d]) { const w = weight(v); if (w > bw) { bw = w; best = v; } }
      out[Y * OW + X] = best;
    }
  }
  return out;
}

// zones 4-connexes d'une même couleur, avec leur rayon intérieur (distance de chanfrein 3/4)
function components(lab, W, H) {
  const N = W * H, id = new Int32Array(N).fill(-1), stack = new Int32Array(N);
  const size = [];
  let n = 0;
  for (let s = 0; s < N; s++) {
    if (id[s] >= 0) continue;
    const v = lab[s];
    let sp = 0, cnt = 0;
    stack[sp++] = s; id[s] = n;
    while (sp) {
      const i = stack[--sp], x = i % W;
      cnt++;
      if (x > 0 && id[i - 1] < 0 && lab[i - 1] === v) { id[i - 1] = n; stack[sp++] = i - 1; }
      if (x < W - 1 && id[i + 1] < 0 && lab[i + 1] === v) { id[i + 1] = n; stack[sp++] = i + 1; }
      if (i >= W && id[i - W] < 0 && lab[i - W] === v) { id[i - W] = n; stack[sp++] = i - W; }
      if (i < N - W && id[i + W] < 0 && lab[i + W] === v) { id[i + W] = n; stack[sp++] = i + W; }
    }
    size.push(cnt); n++;
  }
  // distance au bord de la zone (bord de l'image compris)
  const d = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const x = i % W, c = id[i];
    const edge = x === 0 || x === W - 1 || i < W || i >= N - W ||
      id[i - 1] !== c || id[i + 1] !== c || id[i - W] !== c || id[i + W] !== c;
    d[i] = edge ? 3 : 1 << 29;
  }
  for (let y = 1; y < H; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    d[i] = Math.min(d[i], d[i - 1] + 3, d[i - W] + 3, d[i - W - 1] + 4, d[i - W + 1] + 4);
  }
  for (let y = H - 2; y >= 0; y--) for (let x = W - 2; x > 0; x--) {
    const i = y * W + x;
    d[i] = Math.min(d[i], d[i + 1] + 3, d[i + W] + 3, d[i + W + 1] + 4, d[i + W - 1] + 4);
  }
  const dmax = new Int32Array(n), at = new Int32Array(n), start = new Int32Array(n + 1);
  for (let i = 0; i < N; i++) { const c = id[i]; start[c + 1]++; if (d[i] > dmax[c]) { dmax[c] = d[i]; at[c] = i; } }
  for (let c = 0; c < n; c++) start[c + 1] += start[c];
  const fillp = start.slice(0, n), pixels = new Int32Array(N);
  for (let i = 0; i < N; i++) pixels[fillp[id[i]]++] = i;
  return { n, size, dmax, at, start, pixels };
}

function majority(lab, W, H, k) {
  const out = new Uint8Array(lab.length), cnt = new Uint8Array(k);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    cnt.fill(0);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) cnt[lab[yy * W + xx]]++;
    }
    const own = lab[y * W + x];
    let best = own;
    for (let j = 0; j < k; j++) if (cnt[j] > cnt[best]) best = j;
    out[y * W + x] = best;
  }
  return out;
}

function blur(ch, W, H) { // boîte 3×3 séparable
  const t = new Float32Array(ch.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    t[i] = (ch[x > 0 ? i - 1 : i] + ch[i] + ch[x < W - 1 ? i + 1 : i]) / 3;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    ch[i] = (t[y > 0 ? i - W : i] + t[i] + t[y < H - 1 ? i + W : i]) / 3;
  }
}

const dist = (l, a, b, c) => (l - c[0]) ** 2 + (a - c[1]) ** 2 + (b - c[2]) ** 2;
function nearest(l, a, b, C) {
  let bj = 0, bd = Infinity;
  for (let j = 0; j < C.length; j++) { const d = dist(l, a, b, C[j]); if (d < bd) { bd = d; bj = j; } }
  return bj;
}
const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function toLab(r, g, b) {
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), Bl = lin(b);
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * Bl) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * Bl);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * Bl) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
