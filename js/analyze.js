// Analyse d'un coloriage magique : traits, zones fermées et symboles imprimés.
// Pur calcul, sans DOM : tourne dans le worker et dans les tests.
//
// Idée : au lieu d'un flood fill à chaque toucher, on étiquette une seule fois
// toutes les zones (remplissage par pile, 4-connexe). Un toucher devient une
// simple lecture regionOf[pixel], et remplir une zone, une boucle sur ses pixels.

export const FEAT = 16; // côté de la vignette normalisée d'un symbole
// À incrémenter si les numéros de zones changent : les coloriages enregistrés repartent de zéro
export const VERSION = 3;

export function analyze(rgba, W, H, opts = {}) {
  const N = W * H;

  // 1. Luminance (composée sur blanc si transparence) et histogramme
  const lum = new Uint8Array(N);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const a = rgba[p + 3];
    let l = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
    if (a < 255) l = (l * a + 255 * (255 - a)) / 255;
    lum[i] = l;
    hist[lum[i]]++;
  }
  const T = Math.min(240, Math.max(40, otsu(hist, N) + (opts.offset || 0)));

  // 2. Moyenne locale (image intégrale) : un trait doit être plus sombre que le
  // papier autour de lui, ce qui tient bon sur une photo à l'éclairage inégal.
  const W1 = W + 1;
  const sat = new Uint32Array(W1 * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += lum[y * W + x];
      sat[(y + 1) * W1 + x + 1] = sat[y * W1 + x + 1] + row;
    }
  }
  const R = Math.max(6, Math.round(Math.min(W, H) / 40));
  const localMean = (x, y) => {
    const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1);
    const y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
    const s = sat[y1 * W1 + x1] - sat[y0 * W1 + x1] - sat[y1 * W1 + x0] + sat[y0 * W1 + x0];
    return s / ((x1 - x0) * (y1 - y0));
  };

  const ink = new Uint8Array(N); // pixel réellement sombre
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      const l = lum[i];
      ink[i] = l <= T && l < localMean(x, y) - 8 ? 1 : 0;
    }
  }
  // Option « fermer les petites ouvertures » : on épaissit les traits d'un pixel
  let wall = ink;
  if (opts.closeGaps) {
    wall = new Uint8Array(N);
    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i++) {
        if (!ink[i]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx >= 0 && xx < W) wall[yy * W + xx] = 1;
          }
        }
      }
    }
  }

  // 3. Zones : composantes 4-connexes du papier (une diagonale ne fuit pas)
  const stack = new Int32Array(N);
  const lab = new Int32Array(N).fill(-1);
  const rArea = [], rBorder = [];
  for (let s = 0; s < N; s++) {
    if (wall[s] || lab[s] >= 0) continue;
    const id = rArea.length;
    let sp = 0, area = 0, border = 0;
    stack[sp++] = s; lab[s] = id;
    while (sp) {
      const i = stack[--sp];
      area++;
      const x = i % W, y = (i - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = 1;
      if (x > 0 && !wall[i - 1] && lab[i - 1] < 0) { lab[i - 1] = id; stack[sp++] = i - 1; }
      if (x < W - 1 && !wall[i + 1] && lab[i + 1] < 0) { lab[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && !wall[i - W] && lab[i - W] < 0) { lab[i - W] = id; stack[sp++] = i - W; }
      if (y < H - 1 && !wall[i + W] && lab[i + W] < 0) { lab[i + W] = id; stack[sp++] = i + W; }
    }
    rArea.push(area); rBorder.push(border);
  }
  const nR = rArea.length;

  // 4. Traits : composantes 8-connexes. Un chiffre isolé dans une zone en est une petite.
  const wlab = new Int32Array(N).fill(-1);
  const cArea = [], cBox = [], cBorder = [];
  for (let s = 0; s < N; s++) {
    if (!wall[s] || wlab[s] >= 0) continue;
    const id = cArea.length;
    let sp = 0, area = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    stack[sp++] = s; wlab[s] = id;
    while (sp) {
      const i = stack[--sp];
      area++;
      const x = i % W, y = (i - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx;
          if (wall[j] && wlab[j] < 0) { wlab[j] = id; stack[sp++] = j; }
        }
      }
    }
    cArea.push(area); cBox.push(x0, y0, x1, y1);
    cBorder.push(x0 === 0 || y0 === 0 || x1 === W - 1 || y1 === H - 1 ? 1 : 0);
  }
  const nC = cArea.length;
  const maxG = Math.max(8, Math.round(Math.min(W, H) * 0.05));
  const cand = new Uint8Array(nC);
  for (let c = 0; c < nC; c++) {
    const w = cBox[4 * c + 2] - cBox[4 * c] + 1, h = cBox[4 * c + 3] - cBox[4 * c + 1] + 1;
    cand[c] = w <= maxG && h <= maxG && !cBorder[c] ? 1 : 0;
  }

  // 5. Voisinages trait/zone (au plus 4 zones par symbole candidat, 2 traits par zone)
  const cAdj = new Int32Array(nC * 4).fill(-1), cAdjN = new Uint8Array(nC);
  const rW = new Int32Array(nR * 2).fill(-1), rWN = new Uint8Array(nR);
  const link = (c, r) => {
    if (cand[c] && cAdjN[c] <= 4) {
      let k = 0;
      while (k < cAdjN[c] && cAdj[4 * c + k] !== r) k++;
      if (k === cAdjN[c]) { if (k < 4) cAdj[4 * c + k] = r; cAdjN[c]++; }
    }
    if (rWN[r] <= 2) {
      let k = 0;
      while (k < rWN[r] && rW[2 * r + k] !== c) k++;
      if (k === rWN[r]) { if (k < 2) rW[2 * r + k] = c; rWN[r]++; }
    }
  };
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      if (x < W - 1 && wall[i] !== wall[i + 1]) wall[i] ? link(wlab[i], lab[i + 1]) : link(wlab[i + 1], lab[i]);
      if (y < H - 1 && wall[i] !== wall[i + W]) wall[i] ? link(wlab[i], lab[i + W]) : link(wlab[i + W], lab[i]);
    }
  }

  // 6. Trous de lettres (intérieur d'un 0, 8, A, B, D) : zone minuscule bordée par
  // un seul petit trait. Un îlot vide entouré d'un cercle a un intérieur trop grand
  // par rapport au trait, il reste une vraie zone.
  const holeC = new Int32Array(nR).fill(-1);
  for (let r = 0; r < nR; r++) {
    if (rWN[r] !== 1 || rBorder[r]) continue;
    const c = rW[2 * r];
    if (cand[c] && rArea[r] <= 1.5 * cArea[c]) holeC[r] = c;
  }
  // Symbole : petit trait dont toutes les zones voisines (hors ses trous) n'en font qu'une
  const owner = new Int32Array(nC).fill(-1);
  for (let c = 0; c < nC; c++) {
    if (!cand[c] || cAdjN[c] > 4) continue;
    let o = -1, ok = true;
    for (let k = 0; k < cAdjN[c]; k++) {
      const r = cAdj[4 * c + k];
      if (holeC[r] === c) continue;
      if (o === -1) o = r; else if (o !== r) { ok = false; break; }
    }
    if (ok && o >= 0) owner[c] = o;
  }
  const parent = new Int32Array(nR);
  for (let r = 0; r < nR; r++) parent[r] = holeC[r] >= 0 && owner[holeC[r]] >= 0 ? owner[holeC[r]] : r;
  const root = r => { let k = 0; while (parent[r] !== r && k++ < 8) r = parent[r]; return r; };

  // 7. Identifiants finaux compacts
  const newId = new Int32Array(nR).fill(-1);
  let M = 0;
  for (let r = 0; r < nR; r++) if (root(r) === r) newId[r] = M++;
  const regionOf = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    if (!wall[i]) regionOf[i] = newId[root(lab[i])];
    else { const o = owner[wlab[i]]; regionOf[i] = o >= 0 ? newId[root(o)] : -1; }
  }
  // Pixels clairs avalés par l'épaississement : rendus à la zone voisine
  if (opts.closeGaps) {
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < N; k++) {
        const i = pass ? N - 1 - k : k;
        if (ink[i] || regionOf[i] >= 0) continue;
        const x = i % W;
        const n = (x > 0 && regionOf[i - 1] >= 0) ? i - 1 : (x < W - 1 && regionOf[i + 1] >= 0) ? i + 1
          : (i >= W && regionOf[i - W] >= 0) ? i - W : (i + W < N && regionOf[i + W] >= 0) ? i + W : -1;
        if (n >= 0) regionOf[i] = regionOf[n];
      }
    }
  }

  // 7b. Miettes : une zone minuscule sans symbole (poche entre deux traits doublés)
  // est rattachée à la zone voisine la plus présente, sinon elle resterait en blanc.
  {
    const minArea = Math.max(12, Math.round(N * 6e-6));
    const area = new Int32Array(M), glyphed = new Uint8Array(M);
    for (let i = 0; i < N; i++) if (regionOf[i] >= 0) area[regionOf[i]]++;
    for (let c = 0; c < nC; c++) if (owner[c] >= 0) glyphed[newId[root(owner[c])]] = 1;
    const votes = new Map();
    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i++) {
        const r = regionOf[i];
        if (r < 0 || area[r] >= minArea || glyphed[r]) continue;
        let v = votes.get(r);
        if (!v) votes.set(r, v = new Map());
        for (let dy = -2; dy <= 2; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            const q = regionOf[yy * W + xx];
            if (q >= 0 && q !== r && area[q] >= minArea) v.set(q, (v.get(q) || 0) + 1);
          }
        }
      }
    }
    const to = new Int32Array(M);
    for (let r = 0; r < M; r++) to[r] = r;
    for (const [r, v] of votes) {
      let best = -1, bn = 0;
      for (const [q, n] of v) if (n > bn) { bn = n; best = q; }
      if (best >= 0) to[r] = best;
    }
    const compact = new Int32Array(M).fill(-1);
    let M2 = 0;
    for (let r = 0; r < M; r++) if (to[r] === r) compact[r] = M2++;
    for (let i = 0; i < N; i++) if (regionOf[i] >= 0) regionOf[i] = compact[to[regionOf[i]]];
    for (let r = 0; r < nR; r++) if (newId[r] >= 0) newId[r] = compact[to[newId[r]]];
    M = M2;
  }

  // 8. Ombrage : près d'un trait on garde l'anticrénelage (couleur x luminance),
  // ailleurs la couleur est franche, ce qui efface aussi le symbole.
  const shade = new Uint8Array(N).fill(255);
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      if (regionOf[i] < 0 || ink[i]) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < W && regionOf[yy * W + xx] < 0) { near = true; break; }
        }
      }
      if (near) shade[i] = Math.min(255, Math.round(lum[i] * 255 / Math.max(1, localMean(x, y))));
    }
  }

  // 9. Liste des pixels par zone (format compact) et boîtes englobantes
  const offsets = new Int32Array(M + 1);
  const bbox = new Int32Array(M * 4);
  for (let r = 0; r < M; r++) { bbox[4 * r] = W; bbox[4 * r + 1] = H; bbox[4 * r + 2] = -1; bbox[4 * r + 3] = -1; }
  for (let i = 0; i < N; i++) if (regionOf[i] >= 0) offsets[regionOf[i] + 1]++;
  for (let r = 0; r < M; r++) offsets[r + 1] += offsets[r];
  const pixels = new Int32Array(offsets[M]);
  const fillPos = offsets.slice(0, M);
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      const r = regionOf[i];
      if (r < 0) continue;
      pixels[fillPos[r]++] = i;
      const b = 4 * r;
      if (x < bbox[b]) bbox[b] = x; if (y < bbox[b + 1]) bbox[b + 1] = y;
      if (x > bbox[b + 2]) bbox[b + 2] = x; if (y > bbox[b + 3]) bbox[b + 3] = y;
    }
  }

  // 10. Symboles : vignette normalisée puis regroupement des formes identiques,
  // pour que l'utilisateur n'ait à dire qu'une fois « cette forme est un 3 ».
  // Un petit caractère peut sortir en morceaux (haut et bas d'un B) : les morceaux
  // empilés dans la même zone forment un seul symbole.
  const comps = [];
  for (let c = 0; c < nC; c++) if (owner[c] >= 0) comps.push(c);
  const gpar = new Map(comps.map(c => [c, c]));
  const gfind = c => { while (gpar.get(c) !== c) c = gpar.get(c); return c; };
  const byOwner = new Map();
  for (const c of comps) {
    const o = owner[c];
    if (!byOwner.has(o)) byOwner.set(o, []);
    byOwner.get(o).push(c);
  }
  for (const list of byOwner.values()) {
    if (list.length < 2 || list.length > 40) continue;
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const A = cBox.slice(4 * list[a], 4 * list[a] + 4), B = cBox.slice(4 * list[b], 4 * list[b] + 4);
      const ov = Math.min(A[2], B[2]) - Math.max(A[0], B[0]) + 1;
      const narrow = Math.min(A[2] - A[0], B[2] - B[0]) + 1;
      const gap = Math.max(A[1], B[1]) - Math.min(A[3], B[3]) - 1;
      const tall = Math.max(A[3], B[3]) - Math.min(A[1], B[1]) + 1;
      if (ov >= 0.5 * narrow && gap <= 2 && tall <= maxG) gpar.set(gfind(list[a]), gfind(list[b]));
    }
  }
  const groups = new Map();
  for (const c of comps) {
    const g = gfind(c);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  const gid = new Int32Array(nC).fill(-1);
  const gl = [];
  for (const members of groups.values()) {
    const k = gl.length;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, area = 0;
    for (const c of members) {
      gid[c] = k;
      x0 = Math.min(x0, cBox[4 * c]); y0 = Math.min(y0, cBox[4 * c + 1]);
      x1 = Math.max(x1, cBox[4 * c + 2]); y1 = Math.max(y1, cBox[4 * c + 3]);
      area += cArea[c];
    }
    // niveaux de gris : un chiffre de 6 px garde sa forme grâce à l'anticrénelage
    let inkL = 255;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (gid[wlab[y * W + x]] === k && lum[y * W + x] < inkL) inkL = lum[y * W + x];
    const paper = localMean((x0 + x1) >> 1, (y0 + y1) >> 1), span = Math.max(20, paper - inkL);
    const reg = owner[members[0]];
    const ex0 = Math.max(0, x0 - 1), ey0 = Math.max(0, y0 - 1), ex1 = Math.min(W - 1, x1 + 1), ey1 = Math.min(H - 1, y1 + 1);
    const feat = featureOf((x, y) => {
      const i = y * W + x;
      if (wall[i]) return wlab[i] >= 0 && gid[wlab[i]] === k ? 1 : 0;
      if (lab[i] !== reg && !(holeC[lab[i]] >= 0 && gid[holeC[lab[i]]] === k)) return 0;
      return Math.max(0, Math.min(1, (paper - lum[i]) / span));
    }, ex0, ey0, ex1, ey1);
    gl.push({ x0, y0, x1, y1, area, region: newId[root(reg)], feat });
  }
  const clusters = clusterGlyphs(gl);

  const n = gl.length;
  const gBox = new Int32Array(n * 4), gRegion = new Int32Array(n), gCluster = new Int32Array(n);
  gl.forEach((g, k) => {
    gBox.set([g.x0, g.y0, g.x1, g.y1], 4 * k);
    gRegion[k] = g.region; gCluster[k] = g.cluster;
  });

  return {
    W, H, M, T, regionOf, shade, offsets, pixels, bbox,
    glyphs: { n, bbox: gBox, region: gRegion, cluster: gCluster },
    clusters,
  };
}

// Vignette FEAT x FEAT de couverture (0..1), forme centrée, proportions gardées.
// isOn(x, y) renvoie un booléen ou un poids entre 0 et 1.
export function featureOf(isOn, x0, y0, x1, y1) {
  const w = x1 - x0 + 1, h = y1 - y0 + 1, s = Math.max(w, h) / FEAT;
  const ox = x0 + w / 2 - (FEAT / 2) * s, oy = y0 + h / 2 - (FEAT / 2) * s;
  const f = new Float32Array(FEAT * FEAT);
  for (let v = 0; v < FEAT; v++) {
    for (let u = 0; u < FEAT; u++) {
      let acc = 0;
      for (let sy = 0; sy < 3; sy++) {
        const py = Math.floor(oy + (v + (sy + 0.5) / 3) * s);
        if (py < y0 || py > y1) continue;
        for (let sx = 0; sx < 3; sx++) {
          const px = Math.floor(ox + (u + (sx + 0.5) / 3) * s);
          if (px >= x0 && px <= x1) acc += +isOn(px, py);
        }
      }
      f[v * FEAT + u] = acc / 9;
    }
  }
  // léger flou : tolère les écarts d'épaisseur et de police
  const out = new Float32Array(FEAT * FEAT);
  for (let v = 0; v < FEAT; v++) {
    for (let u = 0; u < FEAT; u++) {
      let s2 = 0, k = 0;
      for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) {
        const uu = u + du, vv = v + dv;
        if (uu >= 0 && uu < FEAT && vv >= 0 && vv < FEAT) { s2 += f[vv * FEAT + uu] * (du || dv ? 1 : 2); k += du || dv ? 1 : 2; }
      }
      out[v * FEAT + u] = s2 / k;
    }
  }
  return out;
}

export function featDist(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
}

const CLUSTER_MAX = 0.05;

function clusterGlyphs(gl) {
  // les grands symboles, plus nets, ouvrent les groupes
  const order = gl.map((_, k) => k).sort((a, b) => gl[b].area - gl[a].area);
  const cl = [];
  for (const k of order) {
    const g = gl[k];
    let best = -1, bd = CLUSTER_MAX;
    for (let j = 0; j < cl.length; j++) {
      const d = featDist(g.feat, cl[j].mean);
      if (d < bd) { bd = d; best = j; }
    }
    if (best < 0) {
      cl.push({ sum: Float32Array.from(g.feat), mean: Float32Array.from(g.feat), n: 1, sample: k });
      best = cl.length - 1;
    } else {
      const c = cl[best];
      c.n++;
      for (let i = 0; i < c.sum.length; i++) { c.sum[i] += g.feat[i]; c.mean[i] = c.sum[i] / c.n; }
    }
    g.cluster = best;
  }
  // tri par effectif décroissant, numéros réattribués
  const rank = cl.map((_, j) => j).sort((a, b) => cl[b].n - cl[a].n);
  const newIdx = new Int32Array(cl.length);
  rank.forEach((j, r) => { newIdx[j] = r; });
  for (const g of gl) g.cluster = newIdx[g.cluster];
  return rank.map(j => ({ n: cl[j].n, mean: cl[j].mean, sample: cl[j].sample }));
}

function otsu(hist, N) {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = -1, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = N - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; th = t; }
  }
  return th;
}
