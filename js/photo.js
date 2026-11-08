// Dessin du coloriage tiré d'une photo : traits gris entre les couleurs, numéro au
// plus large de chaque zone. On garde la position de chaque chiffre dessiné pour
// étiqueter les symboles sans les relire.
const INK = [118, 118, 126];
const FONT = '"Nunito", "Arial", sans-serif';

export async function drawColoring(q) {
  try { await document.fonts.load(`700 20px ${FONT}`); } catch { /* police de secours */ }
  const { OW, OH, out, zones, colors } = q;
  const line = document.createElement('canvas');
  line.width = OW; line.height = OH;
  const ctx = line.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(OW, OH);
  const d = img.data;
  for (let y = 0, i = 0; y < OH; y++) for (let x = 0; x < OW; x++, i++) {
    const v = out[i];
    // trait de 2 px : un pixel de chaque côté de chaque frontière, cadre compris
    const edge = x === 0 || y === 0 || x === OW - 1 || y === OH - 1 ||
      out[i - 1] !== v || out[i + 1] !== v || out[i - OW] !== v || out[i + OW] !== v;
    const c = edge ? INK : [255, 255, 255];
    d[4 * i] = c[0]; d[4 * i + 1] = c[1]; d[4 * i + 2] = c[2]; d[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const boxes = []; // [x0, y0, x1, y1, caractère]
  ctx.fillStyle = `rgb(${INK})`;
  ctx.textBaseline = 'alphabetic';
  for (let z = 0; z < zones.length / 4; z++) {
    const cx = zones[4 * z], cy = zones[4 * z + 1], r = zones[4 * z + 2] - 3, text = String(zones[4 * z + 3] + 1);
    const size = Math.max(9, Math.min(26, Math.floor(r / (text.length === 1 ? 0.5 : 0.75))));
    ctx.font = `700 ${size}px ${FONT}`;
    const m = ctx.measureText(text);
    const x0 = cx - m.width / 2, base = cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    ctx.fillText(text, x0, base);
    let x = x0;
    for (const ch of text) {
      const w = ctx.measureText(ch).width;
      boxes.push([x - 1, base - m.actualBoundingBoxAscent - 1, x + w + 1, base + m.actualBoundingBoxDescent + 1, ch]);
      x += w;
    }
  }

  // aperçu en couleurs, réduit
  const k = Math.min(1, 900 / OW);
  const prev = document.createElement('canvas');
  prev.width = Math.round(OW * k); prev.height = Math.round(OH * k);
  const pd = prev.getContext('2d');
  const pimg = pd.createImageData(prev.width, prev.height);
  for (let y = 0; y < prev.height; y++) for (let x = 0; x < prev.width; x++) {
    const c = colors[out[Math.floor(y / k) * OW + Math.floor(x / k)]], i = 4 * (y * prev.width + x);
    pimg.data[i] = c[0]; pimg.data[i + 1] = c[1]; pimg.data[i + 2] = c[2]; pimg.data[i + 3] = 255;
  }
  pd.putImageData(pimg, 0, 0);

  const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  return { canvas: line, preview: prev, boxes, zones: zones.length / 4, palette: colors.map((c, j) => ({ sym: String(j + 1), color: hex(c) })) };
}

// Étiquette de chaque groupe de symboles : vote des chiffres réellement dessinés
export function truthLabels(res, boxes) {
  const g = res.glyphs, votes = res.clusters.map(() => new Map());
  // grille grossière pour retrouver vite la case qui contient un symbole
  const cell = 32, cols = Math.ceil(res.W / cell), grid = new Map();
  boxes.forEach((b, j) => {
    for (let gy = Math.floor(b[1] / cell); gy <= Math.floor(b[3] / cell); gy++)
      for (let gx = Math.floor(b[0] / cell); gx <= Math.floor(b[2] / cell); gx++) {
        const key = gy * cols + gx;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(j);
      }
  });
  for (let k = 0; k < g.n; k++) {
    const cx = (g.bbox[4 * k] + g.bbox[4 * k + 2]) / 2, cy = (g.bbox[4 * k + 1] + g.bbox[4 * k + 3]) / 2;
    const hit = (grid.get(Math.floor(cy / cell) * cols + Math.floor(cx / cell)) || [])
      .map(j => boxes[j]).find(b => cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]);
    if (!hit) continue;
    const v = votes[g.cluster[k]];
    v.set(hit[4], (v.get(hit[4]) || 0) + 1);
  }
  return votes.map(v => [...v].sort((a, b) => b[1] - a[1])[0]?.[0] || '');
}
