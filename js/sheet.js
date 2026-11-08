// Feuille de coloriage : peinture des zones sur canvas, calque de surbrillance,
// zoom à deux doigts, déplacement, toucher et molette. Mouvement en transform seulement.
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Sheet {
  constructor(stage, res, image, { onTap, prefer }) {
    this.stage = stage;
    this.res = res;
    this.onTap = onTap;
    this.prefer = prefer || (() => false);
    const { W, H } = res;
    this.el = document.createElement('div');
    this.el.className = 'sheet';
    this.el.style.width = W + 'px';
    this.el.style.height = H + 'px';
    this.canvas = document.createElement('canvas');
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'sheet-overlay';
    for (const c of [this.canvas, this.overlay]) { c.width = W; c.height = H; this.el.append(c); }
    stage.append(this.el);
    this.ctx = this.canvas.getContext('2d');
    this.octx = this.overlay.getContext('2d');
    const ictx = image.getContext('2d', { willReadFrequently: true });
    this.orig = ictx.getImageData(0, 0, W, H).data;
    this.img = new ImageData(new Uint8ClampedArray(this.orig), W, H);
    this.oimg = null;
    this.s = 1; this.tx = 0; this.ty = 0;
    this.bind();
    this.ro = new ResizeObserver(() => { if (!this.userMoved) this.fit(false); });
    this.ro.observe(stage);
  }

  destroy() {
    this.ro.disconnect();
    cancelAnimationFrame(this.anim);
    this.el.remove();
  }

  // --- Peinture -------------------------------------------------------------
  paintRegion(r, rgb) {
    const { offsets, pixels, shade } = this.res, d = this.img.data, o = this.orig;
    for (let k = offsets[r], e = offsets[r + 1]; k < e; k++) {
      const i = pixels[k], p = i * 4;
      if (rgb) {
        const s = shade[i];
        d[p] = rgb[0] * s / 255; d[p + 1] = rgb[1] * s / 255; d[p + 2] = rgb[2] * s / 255; d[p + 3] = 255;
      } else {
        d[p] = o[p]; d[p + 1] = o[p + 1]; d[p + 2] = o[p + 2]; d[p + 3] = o[p + 3];
      }
    }
  }

  fill(r, rgb) {
    this.paintRegion(r, rgb);
    const b = this.res.bbox, x = b[4 * r], y = b[4 * r + 1];
    this.ctx.putImageData(this.img, 0, 0, x, y, b[4 * r + 2] - x + 1, b[4 * r + 3] - y + 1);
    if (this.oimg) this.unhighlight(r);
  }

  // remplissages en lot : un seul envoi vers le canvas
  fillAll(entries) {
    this.img.data.set(this.orig);
    for (const [r, rgb] of entries) this.paintRegion(r, rgb);
    this.ctx.putImageData(this.img, 0, 0);
  }

  // zones à repérer : rayures discrètes de la couleur choisie
  highlight(regions, rgb) {
    const { W, H, offsets, pixels } = this.res;
    if (!this.oimg) this.oimg = new ImageData(W, H);
    const d = this.oimg.data;
    d.fill(0);
    const light = rgb && rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11 > 215;
    const [cr, cg, cb] = !rgb ? [0, 0, 0] : light ? [184, 160, 230] : rgb;
    for (const r of regions) {
      for (let k = offsets[r], e = offsets[r + 1]; k < e; k++) {
        const i = pixels[k], x = i % W, y = (i - x) / W;
        const p = i * 4;
        if ((x + y) % 9 < 4) { d[p] = cr; d[p + 1] = cg; d[p + 2] = cb; d[p + 3] = 150; }
        else { d[p] = cr; d[p + 1] = cg; d[p + 2] = cb; d[p + 3] = 45; }
      }
    }
    this.octx.putImageData(this.oimg, 0, 0);
    this.overlay.classList.toggle('on', regions.length > 0);
  }

  unhighlight(r) {
    const { offsets, pixels, bbox } = this.res, d = this.oimg.data;
    for (let k = offsets[r], e = offsets[r + 1]; k < e; k++) d[pixels[k] * 4 + 3] = 0;
    const x = bbox[4 * r], y = bbox[4 * r + 1];
    this.octx.putImageData(this.oimg, 0, 0, x, y, bbox[4 * r + 2] - x + 1, bbox[4 * r + 3] - y + 1);
  }

  // --- Vue : zoom et déplacement --------------------------------------------
  get bounds() { return this.stage.getBoundingClientRect(); }
  fitScale() {
    const b = this.bounds;
    return Math.min(b.width / this.res.W, b.height / this.res.H) * 0.94;
  }
  get maxScale() { return Math.max(this.fitScale() * 14, 3); }

  apply() {
    this.el.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.s})`;
    this.stage.dispatchEvent(new CustomEvent('viewchange'));
  }

  clamp() {
    const b = this.bounds, w = this.res.W * this.s, h = this.res.H * this.s;
    const mx = b.width * 0.35, my = b.height * 0.35;
    this.tx = Math.min(Math.max(this.tx, Math.min(0, b.width - w) - mx), Math.max(0, b.width - w) + mx);
    this.ty = Math.min(Math.max(this.ty, Math.min(0, b.height - h) - my), Math.max(0, b.height - h) + my);
  }

  fit(animate = true) {
    const b = this.bounds, s = this.fitScale();
    this.userMoved = false;
    this.animateTo(s, (b.width - this.res.W * s) / 2, (b.height - this.res.H * s) / 2, animate);
  }

  zoomAt(factor, cx, cy) {
    const s = Math.min(this.maxScale, Math.max(this.fitScale() * 0.7, this.s * factor));
    const ix = (cx - this.tx) / this.s, iy = (cy - this.ty) / this.s;
    this.s = s; this.tx = cx - ix * s; this.ty = cy - iy * s;
    this.userMoved = true;
    this.clamp(); this.apply();
  }

  zoomBy(factor) {
    const b = this.bounds;
    const from = { s: this.s, tx: this.tx, ty: this.ty };
    this.zoomAt(factor, b.width / 2, b.height / 2);
    const to = { s: this.s, tx: this.tx, ty: this.ty };
    Object.assign(this, from);
    this.animateTo(to.s, to.tx, to.ty, true);
  }

  // centre une zone et zoome pour qu'elle soit bien visible
  focus(r) {
    const b = this.bounds, bb = this.res.bbox;
    const w = bb[4 * r + 2] - bb[4 * r] + 1, h = bb[4 * r + 3] - bb[4 * r + 1] + 1;
    const s = Math.min(this.maxScale, Math.max(this.fitScale(), Math.min(b.width, b.height) * 0.3 / Math.max(w, h, 4)));
    const cx = bb[4 * r] + w / 2, cy = bb[4 * r + 1] + h / 2;
    this.userMoved = true;
    this.animateTo(s, b.width / 2 - cx * s, b.height / 2 - cy * s, true);
  }

  animateTo(s, tx, ty, animate) {
    cancelAnimationFrame(this.anim);
    if (!animate || reduceMotion()) { this.s = s; this.tx = tx; this.ty = ty; this.apply(); return; }
    // échelle interpolée en logarithme, point central de l'image en linéaire
    const b = this.bounds, hw = b.width / 2, hh = b.height / 2;
    const s0 = this.s, c0 = [(hw - this.tx) / s0, (hh - this.ty) / s0], c1 = [(hw - tx) / s, (hh - ty) / s];
    const t0 = performance.now(), D = 380;
    const step = now => {
      const t = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - t, 3);
      this.s = s0 * Math.pow(s / s0, e);
      this.tx = hw - (c0[0] + (c1[0] - c0[0]) * e) * this.s;
      this.ty = hh - (c0[1] + (c1[1] - c0[1]) * e) * this.s;
      this.apply();
      if (t < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  // --- Gestes ---------------------------------------------------------------
  bind() {
    const st = this.stage, pts = new Map();
    let start = null, pinch = null, multi = false;
    const local = e => { const b = this.bounds; return [e.clientX - b.left, e.clientY - b.top]; };

    st.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      cancelAnimationFrame(this.anim);
      try { st.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
      pts.set(e.pointerId, local(e));
      if (pts.size === 1) { start = { p: local(e), tx: this.tx, ty: this.ty, t: performance.now(), moved: false }; multi = false; }
      if (pts.size === 2) {
        multi = true;
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], s: this.s, tx: this.tx, ty: this.ty };
      }
    });
    st.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, local(e));
      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const s = Math.min(this.maxScale, Math.max(this.fitScale() * 0.7, pinch.s * d / pinch.d));
        const ix = (pinch.m[0] - pinch.tx) / pinch.s, iy = (pinch.m[1] - pinch.ty) / pinch.s;
        this.s = s; this.tx = m[0] - ix * s; this.ty = m[1] - iy * s;
        this.userMoved = true;
        this.clamp(); this.apply();
      } else if (start && pts.size === 1) {
        const p = local(e), dx = p[0] - start.p[0], dy = p[1] - start.p[1];
        if (!start.moved && Math.hypot(dx, dy) > 8) start.moved = true;
        if (start.moved) {
          this.tx = start.tx + dx; this.ty = start.ty + dy;
          this.userMoved = true;
          this.clamp(); this.apply();
        }
      }
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size === 1) {
        // fin du pincement : le doigt restant reprend le déplacement sans sauter
        const p = [...pts.values()][0];
        start = { p, tx: this.tx, ty: this.ty, t: 0, moved: true };
        pinch = null;
        return;
      }
      if (pts.size === 0) {
        if (e.type === 'pointerup' && start && !start.moved && !multi && performance.now() - start.t < 600) {
          const [x, y] = local(e);
          this.tap((x - this.tx) / this.s, (y - this.ty) / this.s);
        }
        start = null; pinch = null;
      }
    };
    st.addEventListener('pointerup', up);
    st.addEventListener('pointercancel', up);
    st.addEventListener('wheel', e => {
      e.preventDefault();
      const [x, y] = local(e);
      if (e.ctrlKey || !e.deltaX) this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), x, y);
      else { this.tx -= e.deltaX; this.ty -= e.deltaY; this.userMoved = true; this.clamp(); this.apply(); }
    }, { passive: false });
    // Safari iOS : pas de zoom de la page entière
    for (const ev of ['gesturestart', 'gesturechange']) st.addEventListener(ev, e => e.preventDefault());
  }

  // toucher : la zone sous le doigt ; sur un trait, une zone voisine encore à
  // colorier dans la couleur choisie, sinon la plus proche
  tap(fx, fy) {
    const { W, H, regionOf } = this.res;
    const x = Math.floor(fx), y = Math.floor(fy);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    let r = regionOf[y * W + x];
    if (r < 0) {
      const R = Math.min(40, Math.ceil(14 / this.s));
      let bd = Infinity, pd = Infinity, pr = -1;
      const seen = new Map();
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx, d = dx * dx + dy * dy;
          if (xx < 0 || xx >= W || d > R * R) continue;
          const q = regionOf[yy * W + xx];
          if (q < 0) continue;
          if (d < bd) { bd = d; r = q; }
          if (!seen.has(q)) seen.set(q, this.prefer(q));
          if (seen.get(q) && d < pd) { pd = d; pr = q; }
        }
      }
      if (pr >= 0) r = pr;
    }
    if (r >= 0) this.onTap(r);
  }

  toBlob(type = 'image/png', quality) {
    return new Promise(ok => this.canvas.toBlob(ok, type, quality));
  }

  thumbBlob(maxW = 360) {
    const k = Math.min(1, maxW / this.res.W);
    const c = document.createElement('canvas');
    c.width = Math.round(this.res.W * k); c.height = Math.round(this.res.H * k);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(this.canvas, 0, 0, c.width, c.height);
    return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85));
  }
}
