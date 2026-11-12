// MagicColor : bibliothèque, préparation d'un coloriage, coloriage.
import * as db from './db.js';
import { Sheet } from './sheet.js';
import { autoLabels, sortSymbols } from './glyphs.js';
import { regionSymbols, clusterHeights } from './model.js';
import { VERSION } from './analyze.js';
import { drawColoring, truthLabels } from './photo.js';
import { PAINTS, recipe } from './paints.js';

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const deco = (id, cls) => `<svg class="deco ${cls}" aria-hidden="true"><use href="#deco-${id}"/></svg>`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lumOf = h => { const [r, g, b] = hexRgb(h); return r * 0.299 + g * 0.587 + b * 0.114; };
// caractères des symboles de la palette : « 12 » apporte 1 et 2
const alphabet = pal => [...new Set(pal.map(p => p.sym).join(''))];
const plural = (n, one, many) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

const MAX_PIXELS = 3_600_000; // au delà, l'image est réduite : mémoire des téléphones
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];
const SOFT = ['#f7a8c4', '#c8b6f2', '#a8d4f5', '#fde7a1', '#fcc9a8', '#b8e6c8', '#f4b6b6', '#9fd8d0',
  '#e3c4f0', '#ffd6e8', '#c9e4ff', '#d9f2b4', '#ffcfa3', '#b7b3e8', '#f2e1c7', '#a6c8e8'];
const PRESETS = ['#1f1a1c', '#4a3b35', '#7a5c48', '#a87f62', '#d8b89a', '#f3e1cf',
  '#e2504c', '#f08a5d', '#f6c453', '#fbe38e', '#9fcf6a', '#4f8a3f',
  '#3c6e47', '#8fd3c7', '#5aa9e6', '#a8d4f5', '#3a5ba0', '#c8b6f2',
  '#8b6fc9', '#f7a8c4', '#e86ea0', '#ffffff', '#bfbfbf', '#7a7a7a'];

let routeTok = 0;
let pending = null;      // image choisie, en attente de préparation
let cleanup = [];        // à faire en quittant l'écran
const cache = new Map(); // id → { canvas, res, key } : évite de réanalyser

// --- Analyse --------------------------------------------------------------------
let worker;
function analyseCanvas(canvas, settings, kind = 'analyse') {
  worker ||= new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  return new Promise((ok, ko) => {
    const id = Math.random();
    const done = () => { worker.removeEventListener('message', on); worker.removeEventListener('error', fail); };
    const on = e => {
      if (e.data.id !== id) return;
      done();
      e.data.error ? ko(new Error(e.data.error)) : ok(e.data.res);
    };
    const fail = e => { done(); worker = null; ko(new Error(e.message || 'Analyse impossible sur ce navigateur')); };
    worker.addEventListener('message', on);
    worker.addEventListener('error', fail);
    worker.postMessage({ id, kind, rgba: d.data.buffer, w: canvas.width, h: canvas.height, opts: settings }, [d.data.buffer]);
  });
}

async function blobToCanvas(blob) {
  let src;
  try { src = await createImageBitmap(blob); } catch {
    src = new Image();
    src.src = URL.createObjectURL(blob);
    try { await src.decode(); } catch { throw new Error('Cette image ne peut pas être lue.'); }
    finally { URL.revokeObjectURL(src.src); }
  }
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  if (!w0 || !h0) throw new Error('Cette image est vide.');
  const k = Math.min(1, Math.sqrt(MAX_PIXELS / (w0 * h0)));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  if (src.close) src.close();
  return c;
}

// Analyse d'une ancienne version : les numéros de zones ne correspondent plus
async function migrate(doc, res) {
  if (doc.algo === VERSION) return;
  const hadFills = Object.keys(doc.fills).length > 0;
  doc.labels = autoLabels(res.clusters, clusterHeights(res), alphabet(doc.palette)).labels;
  doc.overrides = [];
  doc.fills = {};
  doc.completed = false;
  doc.algo = VERSION;
  await db.put(doc);
  if (hadFills) toast('MagicColor repère mieux les zones : ce coloriage repart de zéro.');
}

async function ensureAnalysis(doc) {
  const key = JSON.stringify(doc.settings);
  const hit = cache.get(doc.id);
  if (hit && hit.key === key) { await migrate(doc, hit.res); return hit; }
  const canvas = hit ? hit.canvas : await blobToCanvas(doc.image);
  const res = await analyseCanvas(canvas, doc.settings);
  const entry = { canvas, res, key };
  cache.set(doc.id, entry);
  await migrate(doc, res);
  return entry;
}

const canvasBlob = (c, type = 'image/png', q) => new Promise(ok => c.toBlob(ok, type, q));
async function smallThumb(canvas) {
  const k = Math.min(1, 360 / canvas.width);
  const t = document.createElement('canvas');
  t.width = Math.round(canvas.width * k); t.height = Math.round(canvas.height * k);
  t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
  return canvasBlob(t, 'image/jpeg', 0.85);
}

// --- Petits éléments d'interface -------------------------------------------------------
let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" class="toast-btn">${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  if (action) $('.toast-btn', t).onclick = () => { hideToast(); action.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 5000 : 2600);
}
function hideToast() { const t = $('#toast'); t.classList.remove('show'); t.hidden = true; }

function dialog(html, cls = '') {
  const d = document.createElement('dialog');
  d.className = 'dlg ' + cls;
  d.innerHTML = html;
  document.body.append(d);
  d.addEventListener('close', () => setTimeout(() => d.remove(), 300));
  d.addEventListener('click', e => { if (e.target === d) d.close(''); }); // toucher le fond ferme
  d.showModal();
  return d;
}

function confirmBox({ title, text, ok, danger }) {
  return new Promise(res => {
    const d = dialog(`<form method="dialog" class="dlg-body">
      <h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="dlg-actions">
        <button value="" class="btn ghost">Annuler</button>
        <button value="ok" class="btn ${danger ? 'danger' : 'primary'}">${esc(ok)}</button>
      </div></form>`);
    d.addEventListener('close', () => res(d.returnValue === 'ok'));
  });
}

function pickColor(current, label) {
  return new Promise(res => {
    const d = dialog(`<form method="dialog" class="dlg-body picker">
      <h2>Couleur ${esc(label)}</h2>
      <div class="pick-grid" role="radiogroup" aria-label="Couleurs proposées">
        ${PRESETS.map(c => `<button type="button" role="radio" class="pick" data-c="${c}" style="--c:${c}" aria-label="${c}" aria-checked="${c === current}"></button>`).join('')}
      </div>
      <label class="custom">
        <span class="custom-prev" style="--c:${current}"></span>
        <span>Couleur personnalisée</span>
        <input type="color" value="${current}">
      </label>
      <div class="dlg-actions">
        <button value="" class="btn ghost">Annuler</button>
        <button value="ok" class="btn primary">Choisir</button>
      </div></form>`, 'sheet-dlg');
    let val = current;
    const set = c => {
      val = c;
      d.querySelectorAll('.pick').forEach(b => b.setAttribute('aria-checked', b.dataset.c === c));
      $('.custom-prev', d).style.setProperty('--c', c);
      $('input[type=color]', d).value = c;
    };
    d.querySelectorAll('.pick').forEach(b => b.onclick = () => set(b.dataset.c));
    $('input[type=color]', d).oninput = e => set(e.target.value);
    d.addEventListener('close', () => res(d.returnValue === 'ok' ? val : null));
  });
}

function loader(text) {
  return `<div class="loader" role="status">
    <svg class="loader-mascot" aria-hidden="true"><use href="#mascot"/></svg>
    <p>${esc(text)}</p></div>`;
}

function errorBox(title, text) {
  return `<div class="state">
    <svg class="state-art" aria-hidden="true"><use href="#mascot"/></svg>
    <h2>${esc(title)}</h2><p>${esc(text)}</p>
    <a class="btn primary" href="#/">Retour à mes coloriages</a></div>`;
}

// --- Import ---------------------------------------------------------------------
function pickFile(photo = false) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  input.onchange = () => input.files[0] && importFile(input.files[0], photo);
  input.click();
}

// photo = true : la photo devient un coloriage numéroté (écran #/photo)
function importFile(file, photo = false) {
  const okType = ACCEPT.includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name || '');
  if (!okType) { toast('Choisis une image PNG, JPG ou WebP.'); return; }
  const name = (file.name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  pending = { blob: file, photo, name: name || (photo ? 'Ma photo' : 'Mon coloriage') };
  location.hash = photo ? '#/photo' : '#/new';
}

// --- Photo → coloriage ------------------------------------------------------------
const PHOTO_COLORS = [8, 12, 16, 24];
const PHOTO_WORK = 600; // côté long de travail : décide la finesse des zones
const PHOTO_SCALE = 3;  // agrandissement du dessin final, pour loger les numéros

async function viewPhoto() {
  const tok = routeTok;
  const P = pending;
  P.results ||= new Map();
  P.colors ||= 12;
  document.title = 'Transformer une photo, MagicColor';
  app.innerHTML = `<main class="screen setup">
    <header class="topbar">
      <a class="icon-btn" href="#/" aria-label="Retour">${icon('back')}</a>
      <h1>Transformer une photo</h1>
    </header>
    <div class="setup-wrap">
      <section class="setup-preview">
        <div class="preview-frame" id="pframe">${loader('Je prépare la photo…')}</div>
        <p class="preview-stats" id="pstats"></p>
      </section>
      <div class="setup-form">
        <section class="block">
          <h2 id="nc">Nombre de couleurs</h2>
          <p class="hint">Plus de couleurs donne plus de détails, avec des zones plus petites.</p>
          <div class="seg seg-big" role="radiogroup" aria-labelledby="nc">
            ${PHOTO_COLORS.map(n => `<button type="button" role="radio" data-n="${n}" aria-checked="${n === P.colors}">${n}</button>`).join('')}
          </div>
        </section>
      </div>
      <footer class="setup-foot">
        <button class="btn primary big" id="go" disabled>Continuer</button>
      </footer>
    </div>
  </main>`;

  const frame = $('#pframe'), stats = $('#pstats'), go = $('#go');
  let small;
  try {
    const full = await blobToCanvas(P.blob);
    const k = Math.min(1, PHOTO_WORK / Math.max(full.width, full.height));
    small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(full.width * k)); small.height = Math.max(1, Math.round(full.height * k));
    const c = small.getContext('2d', { willReadFrequently: true });
    c.imageSmoothingQuality = 'high';
    c.drawImage(full, 0, 0, small.width, small.height);
  } catch (err) {
    if (tok === routeTok) $('.setup-wrap').innerHTML = errorBox('Cette photo ne s’ouvre pas', err.message || 'Essaie avec une autre photo.');
    return;
  }
  if (small.width < 40 || small.height < 40) {
    $('.setup-wrap').innerHTML = errorBox('Cette photo est trop petite', 'Choisis une photo d’au moins 40 pixels de côté.');
    return;
  }

  const show = async n => {
    P.colors = n;
    document.querySelectorAll('.seg-big button').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.n) === n)));
    go.disabled = true;
    let r = P.results.get(n);
    if (!r) {
      frame.innerHTML = loader('Je mélange les couleurs…');
      stats.textContent = '';
      try {
        r = await drawColoring(await analyseCanvas(small, { colors: n, scale: PHOTO_SCALE }, 'photo'));
      } catch (err) {
        if (tok === routeTok && P.colors === n) frame.innerHTML = errorBox('La transformation a échoué', err.message || 'Essaie avec une autre photo.');
        return;
      }
      P.results.set(n, r);
    }
    if (tok !== routeTok || P.colors !== n) return;
    r.preview.setAttribute('role', 'img');
    r.preview.setAttribute('aria-label', 'Aperçu du coloriage terminé');
    frame.replaceChildren(r.preview);
    stats.textContent = `${plural(r.zones, 'zone', 'zones')} à colorier, ${plural(r.palette.length, 'couleur', 'couleurs')}.`;
    go.disabled = false;
  };
  document.querySelectorAll('.seg-big button').forEach(b => b.onclick = () => show(Number(b.dataset.n)));
  go.onclick = () => {
    P.gen = P.results.get(P.colors);
    if (P.gen) location.hash = '#/new';
  };
  show(P.colors);
}

async function importExample() {
  try {
    const r = await fetch('samples/exemple.webp');
    if (!r.ok) throw new Error();
    pending = { blob: await r.blob(), name: 'Portrait mosaïque' };
    location.hash = '#/new';
  } catch { toast("L'exemple n'a pas pu être chargé."); }
}

// --- Bibliothèque ---------------------------------------------------------------
async function viewLibrary() {
  const tok = routeTok;
  document.title = 'MagicColor';
  app.innerHTML = `<main class="screen library">
    <header class="lib-head">
      ${deco('star', 'd1')}${deco('heart', 'd2')}${deco('cloud', 'd3')}${deco('flower', 'd4')}
      <svg class="lib-mascot" aria-hidden="true"><use href="#mascot"/></svg>
      <div class="lib-hello">
        <h1>Mes coloriages</h1>
        <p>Bonjour ! Quel dessin fait-on apparaître aujourd'hui ?</p>
      </div>
      <div class="lib-actions">
        <button class="btn primary big" id="photo">${icon('camera')}Transformer une photo</button>
      </div>
    </header>
    <section class="lib-list" aria-label="Bibliothèque">${loader('Ouverture du carnet…')}</section>
  </main>`;
  $('#photo').onclick = () => pickFile(true);
  enableDrop();

  let docs;
  try { docs = await db.getAll(); } catch {
    if (tok === routeTok) $('.lib-list').innerHTML = errorBox('Le carnet ne s’ouvre pas', 'Ce navigateur bloque la sauvegarde locale (navigation privée ?). Ouvre MagicColor dans une fenêtre normale.');
    return;
  }
  if (tok !== routeTok) return;
  const list = $('.lib-list');
  if (!docs.length) {
    list.innerHTML = `<div class="state empty">
      <div class="empty-art" aria-hidden="true">
        <svg class="empty-mascot"><use href="#mascot"/></svg>
        ${deco('star', 'e1')}${deco('heart', 'e2')}${deco('flower', 'e3')}
      </div>
      <h2>Ton carnet est encore tout blanc</h2>
      <p>Choisis une photo : MagicColor la transforme en coloriage numéroté, puis tu colories du bout du doigt.</p>
      <div class="state-actions">
        <button class="btn soft" id="demo">Essayer avec un exemple</button>
      </div></div>`;
    $('#demo').onclick = importExample;
    return;
  }
  docs.sort((a, b) => b.updated - a.updated);
  const urls = [];
  cleanup.push(() => urls.forEach(u => URL.revokeObjectURL(u)));
  const done = docs.filter(d => d.completed).length;
  list.innerHTML = `<p class="lib-count">${plural(docs.length, 'coloriage', 'coloriages')}${done ? `, ${plural(done, 'terminé', 'terminés')}` : ''}</p>
    <ul class="cards">${docs.map(d => {
      const url = d.thumb ? URL.createObjectURL(d.thumb) : '';
      if (url) urls.push(url);
      const p = d.progress && d.progress.total ? d.progress.done / d.progress.total : 0;
      const pct = d.completed ? 100 : Math.min(99, Math.floor(p * 100));
      return `<li class="card${d.completed ? ' is-done' : ''}">
        <a class="card-open" href="#/color/${d.id}">
          <span class="card-img">${url ? `<img src="${url}" alt="" loading="lazy">` : ''}</span>
          <span class="card-body">
            <span class="card-name">${esc(d.name)}</span>
            <span class="card-meta">
              ${d.completed ? `<span class="done-mark">${deco('star', 'mini')}Terminé</span>` : `<span>${pct} % colorié</span>`}
            </span>
            <span class="meter" aria-hidden="true"><span style="transform:scaleX(${d.completed ? 1 : p})"></span></span>
          </span>
        </a>
        <button class="icon-btn card-del" data-id="${d.id}" aria-label="Supprimer ${esc(d.name)}">${icon('trash')}</button>
      </li>`;
    }).join('')}</ul>`;
  list.querySelectorAll('.card-del').forEach(b => b.onclick = async () => {
    const d = docs.find(x => x.id === b.dataset.id);
    if (!await confirmBox({ title: 'Supprimer ce coloriage ?', text: `« ${d.name} » et sa progression seront effacés de cet appareil.`, ok: 'Supprimer', danger: true })) return;
    try { await db.remove(d.id); } catch { toast('La suppression a échoué.'); return; }
    cache.delete(d.id);
    const li = b.closest('.card');
    li.classList.add('leaving');
    setTimeout(() => { if (tok === routeTok) viewLibrary(); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260);
  });
}

function enableDrop() {
  const on = e => { e.preventDefault(); };
  const drop = e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) importFile(f, true); };
  document.addEventListener('dragover', on);
  document.addEventListener('drop', drop);
  cleanup.push(() => { document.removeEventListener('dragover', on); document.removeEventListener('drop', drop); });
}

// --- Préparation : nom, couleurs, reconnaissance --------------------------------
async function viewSetup(id) {
  const tok = routeTok;
  const isNew = !id;
  document.title = 'Préparer le coloriage, MagicColor';
  app.innerHTML = `<main class="screen setup">
    <header class="topbar">
      <a class="icon-btn" href="${!isNew ? `#/color/${id}` : pending && pending.photo ? '#/photo' : '#/'}" aria-label="Retour">${icon('back')}</a>
      <h1>${isNew ? 'Préparer le coloriage' : 'Couleurs et réglages'}</h1>
    </header>
    <div class="setup-wrap">${loader('Je repère les zones et les symboles…')}</div>
  </main>`;

  const S = {};
  try {
    if (isNew) {
      S.gen = pending.gen;
      const canvas = S.gen ? S.gen.canvas : await blobToCanvas(pending.blob);
      S.settings = { offset: 0, closeGaps: false };
      S.canvas = canvas;
      S.res = await analyseCanvas(canvas, S.settings);
      S.name = pending.name || 'Mon coloriage';
      S.fills = {};
      if (S.gen) genPalette(S); else autoPalette(S);
    } else {
      S.doc = await db.get(id);
      if (!S.doc) { location.hash = '#/'; return; }
      const a = await ensureAnalysis(S.doc);
      Object.assign(S, { canvas: a.canvas, res: a.res, settings: { ...S.doc.settings }, name: S.doc.name,
        palette: S.doc.palette.map(p => ({ ...p })), labels: [...S.doc.labels], overrides: new Set(S.doc.overrides || []), fills: S.doc.fills });
    }
  } catch (err) {
    if (tok === routeTok) $('.setup-wrap').innerHTML = errorBox("Impossible d'analyser cette image", err.message || 'Essaie avec une autre image.');
    return;
  }
  if (tok !== routeTok) return;
  S.heights = clusterHeights(S.res);
  S.shown = 48;
  renderSetup(S, tok);
}

function autoPalette(S) {
  S.heights = clusterHeights(S.res);
  const auto = autoLabels(S.res.clusters, S.heights);
  S.labels = auto.labels;
  S.overrides = new Set();
  S.palette = auto.symbols.map((sym, i) => ({ id: uid(), sym, color: SOFT[i % SOFT.length] }));
  if (!S.palette.length) S.palette = ['1', '2', '3'].map((sym, i) => ({ id: uid(), sym, color: SOFT[i] }));
}

// coloriage tiré d'une photo : on sait déjà quel chiffre est dessiné où
function genPalette(S) {
  S.heights = clusterHeights(S.res);
  S.labels = truthLabels(S.res, S.gen.boxes);
  S.overrides = new Set(S.labels.map((_, i) => i));
  S.palette = S.gen.palette.map(p => ({ id: uid(), ...p }));
}

function renderSetup(S, tok) {
  const wrap = $('.setup-wrap');
  wrap.innerHTML = `
    <section class="setup-preview">
      <div class="preview-frame"><canvas id="prev" aria-label="Aperçu du coloriage"></canvas></div>
      <p class="preview-stats" id="stats"></p>
    </section>
    <form class="setup-form" id="setup" novalidate>
      <section class="block">
        <h2><label for="name">Nom du coloriage</label></h2>
        <input id="name" class="field" maxlength="60" value="${esc(S.name)}" autocomplete="off">
      </section>
      <section class="block">
        <h2>Couleurs</h2>
        <p class="hint">${S.gen ? 'Les couleurs viennent de ta photo. Touche une pastille pour en changer.' : 'Associe chaque chiffre ou lettre du coloriage à sa couleur.'}</p>
        <ul class="prows" id="prows"></ul>
        <button type="button" class="btn soft add" id="add">${icon('plus')}Ajouter une couleur</button>
      </section>
      <details class="block fold" id="recog">
        <summary><h2>Symboles reconnus</h2><span class="fold-sub" id="recogSub"></span></summary>
        <p class="hint">Si une forme est mal lue, corrige son symbole ici. « Aucun » laisse la zone libre.</p>
        <ul class="chips" id="chips"></ul>
        <button type="button" class="btn soft" id="more" hidden>Afficher plus de formes</button>
      </details>
      <details class="block fold">
        <summary><h2>Contours</h2><span class="fold-sub">si des zones débordent</span></summary>
        <label class="range">
          <span>Sensibilité des traits</span>
          <input type="range" id="offset" min="-40" max="40" step="5" value="${S.settings.offset}">
          <span class="range-ends"><span>traits nets</span><span>traits pâles</span></span>
        </label>
        <label class="check">
          <input type="checkbox" id="gaps" ${S.settings.closeGaps ? 'checked' : ''}>
          <span>Fermer les petites ouvertures entre les traits</span>
        </label>
        <button type="button" class="btn soft" id="rerun">${icon('reset')}Relancer l'analyse</button>
      </details>
      <p class="form-error" id="err" role="alert"></p>
    </form>
    <footer class="setup-foot">
      <button class="btn primary big" form="setup" type="submit">${S.doc ? 'Enregistrer' : 'Commencer à colorier'}</button>
    </footer>`;

  // aperçu réduit
  const prev = $('#prev');
  const k = Math.min(1, 900 / S.canvas.width);
  prev.width = Math.round(S.canvas.width * k); prev.height = Math.round(S.canvas.height * k);
  prev.getContext('2d').drawImage(S.canvas, 0, 0, prev.width, prev.height);

  const counts = () => {
    const syms = new Set(S.palette.map(p => p.sym));
    const per = new Map();
    let known = 0;
    for (const s of regionSymbols(S.res, S.labels)) {
      if (!s || !syms.has(s)) continue;
      known++;
      per.set(s, (per.get(s) || 0) + 1);
    }
    return { per, known };
  };

  const renderStats = () => {
    const { per, known } = counts();
    $('#stats').textContent = `${plural(known, 'zone numérotée reconnue', 'zones numérotées reconnues')}, ${plural(S.palette.length, 'couleur', 'couleurs')}.`;
    $('#prows').querySelectorAll('.prow').forEach(li => {
      const p = S.palette.find(x => x.id === li.dataset.id);
      li.querySelector('.pcount').textContent = p && p.sym ? plural(per.get(p.sym) || 0, 'zone', 'zones') : '';
    });
    $('#recogSub').textContent = plural(S.res.clusters.length, 'forme', 'formes');
  };

  const renderRows = () => {
    $('#prows').innerHTML = S.palette.map(p => `<li class="prow" data-id="${p.id}">
      <input class="sym field" value="${esc(p.sym)}" maxlength="3" aria-label="Symbole" autocomplete="off" spellcheck="false">
      <button type="button" class="swatch" style="--c:${p.color}" aria-label="Changer la couleur du symbole ${esc(p.sym)}"></button>
      <span class="pcount"></span>
      <button type="button" class="icon-btn pdel" aria-label="Supprimer le symbole ${esc(p.sym)}">${icon('x')}</button>
    </li>`).join('');
    renderStats();
  };

  const relabel = () => {
    const syms = alphabet(S.palette);
    const auto = autoLabels(S.res.clusters, S.heights, syms);
    S.labels = S.labels.map((l, i) => (S.overrides.has(i) && (l === '' || syms.includes(l)) ? l : auto.labels[i]));
    renderChips();
    renderStats();
  };

  const renderChips = () => {
    const syms = sortSymbols(alphabet(S.palette));
    const g = S.res.glyphs, cl = S.res.clusters;
    const n = Math.min(S.shown, cl.length);
    $('#chips').innerHTML = cl.slice(0, n).map((c, i) => `<li class="chip">
      <canvas width="44" height="44" data-k="${i}" aria-hidden="true"></canvas>
      <span class="chip-n">${c.n} ×</span>
      <select data-k="${i}" aria-label="Symbole de la forme ${i + 1}">
        <option value="">Aucun</option>
        ${syms.map(s => `<option ${S.labels[i] === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
      </select></li>`).join('');
    $('#chips').querySelectorAll('canvas').forEach(cv => {
      const k2 = cl[cv.dataset.k].sample;
      const [x0, y0, x1, y1] = g.bbox.subarray(4 * k2, 4 * k2 + 4);
      const w = x1 - x0 + 5, h = y1 - y0 + 5, s = 40 / Math.max(w, h);
      const c = cv.getContext('2d');
      c.fillStyle = '#fff'; c.fillRect(0, 0, 44, 44);
      c.drawImage(S.canvas, x0 - 2, y0 - 2, w, h, 22 - w * s / 2, 22 - h * s / 2, w * s, h * s);
    });
    $('#more').hidden = n >= cl.length;
  };

  renderRows();
  renderChips();

  const rows = $('#prows');
  rows.addEventListener('input', e => {
    if (!e.target.classList.contains('sym')) return;
    const p = S.palette.find(x => x.id === e.target.closest('.prow').dataset.id);
    p.sym = e.target.value.trim();
  });
  rows.addEventListener('change', e => { if (e.target.classList.contains('sym')) relabel(); });
  rows.addEventListener('click', async e => {
    const li = e.target.closest('.prow');
    if (!li) return;
    const p = S.palette.find(x => x.id === li.dataset.id);
    if (e.target.closest('.swatch')) {
      const c = await pickColor(p.color, p.sym ? `du ${p.sym}` : '');
      if (c) { p.color = c; li.querySelector('.swatch').style.setProperty('--c', c); }
    } else if (e.target.closest('.pdel')) {
      const used = Object.values(S.fills || {}).some(v => v === p.id);
      if (used && !await confirmBox({ title: 'Supprimer cette couleur ?', text: 'Les zones déjà coloriées avec elle redeviendront blanches.', ok: 'Supprimer', danger: true })) return;
      S.palette = S.palette.filter(x => x !== p);
      renderRows(); relabel();
    }
  });
  $('#add').onclick = () => {
    const used = new Set(S.palette.map(p => p.sym));
    let sym = '';
    for (const c of '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(c)) { sym = c; break; }
    S.palette.push({ id: uid(), sym, color: SOFT[S.palette.length % SOFT.length] });
    renderRows(); relabel();
    const inputs = rows.querySelectorAll('.sym');
    inputs[inputs.length - 1].focus();
  };
  $('#chips').addEventListener('change', e => {
    const k = Number(e.target.dataset.k);
    S.labels[k] = e.target.value;
    S.overrides.add(k);
    renderStats();
  });
  $('#more').onclick = () => { S.shown += 96; renderChips(); };

  $('#rerun').onclick = async () => {
    const settings = { offset: Number($('#offset').value), closeGaps: $('#gaps').checked };
    const hasFills = S.fills && Object.keys(S.fills).length;
    if (hasFills && !await confirmBox({ title: "Relancer l'analyse ?", text: 'Les zones changent : le coloriage en cours repartira de zéro.', ok: 'Relancer' })) return;
    const btn = $('#rerun');
    btn.disabled = true; btn.lastChild.textContent = 'Analyse en cours…';
    try {
      S.res = await analyseCanvas(S.canvas, settings);
    } catch (err) {
      toast(err.message || "L'analyse a échoué.");
      btn.disabled = false; btn.lastChild.textContent = "Relancer l'analyse";
      return;
    }
    if (tok !== routeTok) return;
    S.settings = settings;
    S.fills = {};
    S.reset = true;
    const palette = S.palette;
    if (S.gen) genPalette(S); else autoPalette(S);
    if (S.doc || S.gen) { // on garde les couleurs déjà choisies
      S.palette = palette;
      if (!S.gen) S.labels = autoLabels(S.res.clusters, S.heights, alphabet(palette)).labels;
    }
    S.shown = 48;
    S.name = $('#name').value;
    renderSetup(S, tok);
    toast(`${plural(S.res.M, 'zone trouvée', 'zones trouvées')}.`);
  };

  $('#setup').onsubmit = async e => {
    e.preventDefault();
    const err = $('#err');
    const syms = S.palette.map(p => p.sym);
    if (!S.palette.length) { err.textContent = 'Ajoute au moins une couleur.'; return; }
    if (syms.some(s => !s)) { err.textContent = 'Chaque couleur a besoin de son symbole.'; return; }
    const dup = syms.find((s, i) => syms.indexOf(s) !== i);
    if (dup) { err.textContent = `Le symbole ${dup} est utilisé deux fois.`; return; }
    err.textContent = '';
    const btn = e.submitter || $('.setup-foot .btn');
    btn.disabled = true;
    const name = $('#name').value.trim() || 'Mon coloriage';
    const ids = new Set(S.palette.map(p => p.id));
    try {
      let doc;
      if (S.doc) {
        doc = S.doc;
        const fills = {};
        if (!S.reset) for (const [r, pid] of Object.entries(doc.fills)) if (ids.has(pid)) fills[r] = pid;
        Object.assign(doc, { name, palette: S.palette, labels: S.labels, overrides: [...S.overrides], settings: S.settings, fills, updated: Date.now() });
        if (S.reset) doc.completed = false;
      } else {
        doc = {
          id: uid(), name, created: Date.now(), updated: Date.now(),
          image: await canvasBlob(S.canvas), thumb: await smallThumb(S.canvas),
          settings: S.settings, palette: S.palette, labels: S.labels, overrides: [...S.overrides],
          fills: {}, mode: 'libre', hint: true, completed: false, progress: { done: 0, total: 0 }, algo: VERSION,
        };
      }
      await db.put(doc);
      db.persist();
      cache.set(doc.id, { canvas: S.canvas, res: S.res, key: JSON.stringify(S.settings) });
      pending = null;
      location.hash = `#/color/${doc.id}`;
    } catch {
      btn.disabled = false;
      err.textContent = "L'enregistrement a échoué. L'espace de stockage est peut-être plein.";
    }
  };
}

// --- Coloriage ------------------------------------------------------------------
async function viewColor(id) {
  const tok = routeTok;
  app.innerHTML = `<main class="screen color">${loader('Je sors tes crayons…')}</main>`;
  let doc, a;
  try {
    doc = await db.get(id);
    if (!doc) { toast('Ce coloriage est introuvable.'); location.hash = '#/'; return; }
    a = await ensureAnalysis(doc);
  } catch (err) {
    if (tok === routeTok) $('.screen').innerHTML = errorBox("Le coloriage ne s'ouvre pas", err.message || '');
    return;
  }
  if (tok !== routeTok) return;
  document.title = `${doc.name}, MagicColor`;
  document.body.classList.add('no-scroll');
  cleanup.push(() => document.body.classList.remove('no-scroll'));

  const res = a.res;
  const C = { doc, res, history: [], findIdx: 0, saveTimer: 0 };
  const palette = () => doc.palette;
  const syms = new Set(palette().map(p => p.sym));
  C.zoneSym = regionSymbols(res, doc.labels).map(s => (s && syms.has(s) ? s : null));
  C.bySym = new Map();
  C.zoneSym.forEach((s, r) => { if (s) { if (!C.bySym.has(s)) C.bySym.set(s, []); C.bySym.get(s).push(r); } });
  for (const list of C.bySym.values()) list.sort((p, q) => res.bbox[4 * p + 1] - res.bbox[4 * q + 1] || res.bbox[4 * p] - res.bbox[4 * q]);
  C.total = C.zoneSym.filter(Boolean).length;
  C.selected = palette().some(p => p.id === doc.selected) ? doc.selected : palette()[0] && palette()[0].id;

  app.innerHTML = `<main class="screen color">
    <header class="cbar">
      <a class="icon-btn" href="#/" aria-label="Retour à mes coloriages">${icon('back')}</a>
      <div class="ctitle">
        <h1>${esc(doc.name)}</h1>
        <div class="cprog"><span class="meter" aria-hidden="true"><span id="meter"></span></span><span id="pct"></span></div>
      </div>
      <button class="icon-btn" id="undo" aria-label="Annuler la dernière action" disabled>${icon('undo')}</button>
      <button class="icon-btn" id="menu" aria-label="Plus d'options">${icon('more')}</button>
    </header>
    <div class="stage" id="stage">
      <div class="zoombox">
        <button class="icon-btn" id="zin" aria-label="Zoomer">${icon('plus')}</button>
        <button class="icon-btn" id="zout" aria-label="Dézoomer">${icon('minus')}</button>
        <button class="icon-btn" id="zfit" aria-label="Voir tout le dessin">${icon('fit')}</button>
      </div>
    </div>
    <aside class="dock" aria-label="Palette">
      <div class="dock-tools">
        <div class="seg" role="radiogroup" aria-label="Mode de coloriage">
          <button role="radio" data-mode="libre" aria-checked="${doc.mode !== 'guide'}">Libre</button>
          <button role="radio" data-mode="guide" aria-checked="${doc.mode === 'guide'}">Une couleur</button>
        </div>
        <button class="btn soft small" id="find">${icon('search')}Trouver</button>
      </div>
      <p class="dock-stats" id="dstats"></p>
      <div class="swatches" id="swatches" role="radiogroup" aria-label="Couleurs"></div>
    </aside>
  </main>`;

  const stage = $('#stage');
  const sheet = new Sheet(stage, res, a.canvas, {
    onTap: r => tap(r),
    prefer: r => { const p = pal(C.selected); return !!p && C.zoneSym[r] === p.sym && !(r in doc.fills); },
  });
  C.sheet = sheet;
  cleanup.push(() => { flushSave(); sheet.destroy(); });
  const pal = id2 => palette().find(p => p.id === id2);
  const rgbOf = pid => { const p = pal(pid); return p ? hexRgb(p.color) : null; };
  sheet.fillAll(Object.entries(doc.fills).map(([r, pid]) => [Number(r), rgbOf(pid)]).filter(e => e[1]));
  sheet.fit(false);

  const remaining = sym => (C.bySym.get(sym) || []).filter(r => !(r in doc.fills));
  const doneCount = () => C.zoneSym.reduce((n, s, r) => n + (s && r in doc.fills ? 1 : 0), 0);

  function renderSwatches() {
    $('#swatches').innerHTML = palette().map(p => {
      const left = remaining(p.sym).length, known = (C.bySym.get(p.sym) || []).length;
      const fg = lumOf(p.color) > 150 ? '#3f2a3a' : '#fff';
      return `<button class="sw" role="radio" data-id="${p.id}" aria-checked="${p.id === C.selected}"
        aria-label="Couleur ${esc(p.sym)}${known ? `, ${plural(left, 'zone restante', 'zones restantes')}` : ''}">
        <span class="sw-dot" style="--c:${p.color};--fg:${fg}">${esc(p.sym)}</span>
        <span class="sw-left">${known ? (left ? left : icon('check')) : ''}</span>
      </button>`;
    }).join('');
  }

  function updateProgress() {
    const done = doneCount(), total = C.total;
    const p = total ? done / total : 0;
    $('#meter').style.transform = `scaleX(${p})`;
    $('#pct').textContent = total ? `${done === total ? 100 : Math.min(99, Math.floor(p * 100))} %` : '';
    $('#dstats').textContent = total
      ? `${plural(done, 'zone coloriée', 'zones coloriées')}, ${plural(total - done, 'restante', 'restantes')}`
      : 'Aucun symbole reconnu : colorie librement.';
    $('#undo').disabled = !C.history.length;
    doc.progress = { done, total };
    const complete = total > 0 && done === total;
    if (complete && !doc.completed) { doc.completed = true; celebrate(); }
    else if (!complete) doc.completed = false;
  }

  function applyHighlight() {
    const p = pal(C.selected);
    sheet.highlight(doc.hint !== false && p ? remaining(p.sym) : [], p ? hexRgb(p.color) : null);
  }

  function setFill(r, pid) {
    if (pid) { doc.fills[r] = pid; sheet.fill(r, rgbOf(pid)); }
    else { delete doc.fills[r]; sheet.fill(r, null); }
  }

  function changed(rehighlight) {
    if (rehighlight) applyHighlight();
    renderSwatches();
    updateProgress();
    scheduleSave();
  }

  function tap(r) {
    const sel = pal(C.selected);
    if (!sel) { toast('Choisis d’abord une couleur.'); return; }
    const sym = C.zoneSym[r];
    if (doc.mode === 'guide' && sym && sym !== sel.sym) {
      toast(`Cette zone attend le ${sym}.`);
      const b = $(`.sw[data-id="${pal(C.selected).id}"]`);
      if (b) { b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope'); }
      return;
    }
    const prev = doc.fills[r] || null;
    if (prev === sel.id) return;
    setFill(r, sel.id);
    C.history.push({ r, prev });
    if (C.history.length > 300) C.history.shift();
    if (navigator.vibrate && matchMedia('(pointer: coarse)').matches) navigator.vibrate(8);
    changed(false);
    const area = res.offsets[r + 1] - res.offsets[r];
    if (!sym && area > 0.12 * res.W * res.H) toast('Zone très grande : un contour est peut-être ouvert.', { label: 'Annuler', fn: undo });
  }

  function undo() {
    const h = C.history.pop();
    if (!h) return;
    if (h.reset) {
      doc.fills = h.reset;
      sheet.fillAll(Object.entries(doc.fills).map(([r, pid]) => [Number(r), rgbOf(pid)]).filter(e => e[1]));
    } else setFill(h.r, h.prev);
    changed(true);
  }

  // sauvegarde automatique, groupée
  function scheduleSave() {
    clearTimeout(C.saveTimer);
    C.dirty = true;
    C.saveTimer = setTimeout(flushSave, 700);
  }
  async function flushSave() {
    clearTimeout(C.saveTimer);
    if (!C.dirty) return;
    C.dirty = false;
    doc.updated = Date.now();
    doc.selected = C.selected;
    try {
      doc.thumb = await sheet.thumbBlob();
      await db.put(doc);
    } catch {
      toast('La sauvegarde a échoué. L’espace de stockage est peut-être plein.');
    }
  }
  const onHide = () => { if (document.visibilityState === 'hidden') flushSave(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flushSave);
  cleanup.push(() => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', flushSave); });

  // palette
  $('#swatches').addEventListener('click', e => {
    const b = e.target.closest('.sw');
    if (!b) return;
    C.selected = b.dataset.id;
    C.findIdx = 0;
    $('#swatches').querySelectorAll('.sw').forEach(x => x.setAttribute('aria-checked', x === b));
    applyHighlight();
    C.dirty = true; scheduleSave();
  });
  $('.seg').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    doc.mode = b.dataset.mode;
    $('.seg').querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-checked', x === b));
    toast(doc.mode === 'guide' ? 'Seules les zones de la couleur choisie se colorient.' : 'Toutes les zones se colorient avec la couleur choisie.');
    scheduleSave();
  });
  $('#find').onclick = () => {
    const p = pal(C.selected);
    if (!p) return;
    const left = remaining(p.sym);
    if (!(C.bySym.get(p.sym) || []).length) { toast(`Aucune zone reconnue pour le ${p.sym}.`); return; }
    if (!left.length) { toast(`Toutes les zones du ${p.sym} sont coloriées.`); return; }
    const r = left[C.findIdx++ % left.length];
    sheet.focus(r);
    const o = sheet.overlay;
    o.classList.remove('flash'); void o.offsetWidth; o.classList.add('flash');
  };
  $('#undo').onclick = undo;
  $('#zin').onclick = () => sheet.zoomBy(1.6);
  $('#zout').onclick = () => sheet.zoomBy(1 / 1.6);
  $('#zfit').onclick = () => sheet.fit(true);
  const keys = e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  };
  document.addEventListener('keydown', keys);
  cleanup.push(() => document.removeEventListener('keydown', keys));

  $('#menu').onclick = () => {
    const d = dialog(`<div class="dlg-body menu">
      <h2>Options</h2>
      <button class="menu-item" data-a="edit">${icon('palette')}<span>Modifier les couleurs</span></button>
      <label class="menu-item check">
        <input type="checkbox" id="hint" ${doc.hint !== false ? 'checked' : ''}>
        <span>Montrer les zones de la couleur choisie</span>
      </label>
      <button class="menu-item" data-a="export">${icon('download')}<span>Exporter en PNG</span></button>
      <button class="menu-item" data-a="print">${icon('printer')}<span>Préparer à l'impression</span></button>
      <button class="menu-item danger" data-a="reset">${icon('reset')}<span>Recommencer le coloriage</span></button>
      <div class="dlg-actions"><button class="btn ghost" data-a="close">Fermer</button></div>
    </div>`, 'sheet-dlg');
    $('#hint', d).onchange = e => { doc.hint = e.target.checked; applyHighlight(); C.dirty = true; scheduleSave(); };
    d.addEventListener('click', async e => {
      const a2 = e.target.closest('[data-a]');
      if (!a2) return;
      d.close();
      if (a2.dataset.a === 'edit') { await flushSave(); location.hash = `#/edit/${doc.id}`; }
      if (a2.dataset.a === 'export') exportPng();
      if (a2.dataset.a === 'print') { await flushSave(); location.hash = `#/print/${doc.id}`; }
      if (a2.dataset.a === 'reset') {
        if (!Object.keys(doc.fills).length) { toast('Rien à effacer pour le moment.'); return; }
        if (!await confirmBox({ title: 'Recommencer ?', text: 'Toutes les zones redeviennent blanches. Tu pourras annuler juste après.', ok: 'Recommencer', danger: true })) return;
        C.history.push({ reset: doc.fills });
        doc.fills = {};
        sheet.fillAll([]);
        changed(true);
      }
    });
  };

  async function exportPng() {
    const blob = await sheet.toBlob();
    const fname = (doc.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'coloriage') + '.png';
    const file = new File([blob], fname, { type: 'image/png' });
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: doc.name }); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = fname;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Image enregistrée.');
  }

  function celebrate() {
    flushSave();
    const colors = palette().map(p => p.color).concat(['#f7a8c4', '#c8b6f2', '#a8d4f5', '#fde7a1']);
    const bits = Array.from({ length: 34 }, (_, i) => {
      const kind = ['star', 'heart', 'flower'][i % 3];
      return `<svg class="bit" style="--x:${(Math.random() * 100).toFixed(1)}vw;--d:${(Math.random() * 0.9).toFixed(2)}s;--r:${Math.round(Math.random() * 540 - 270)}deg;--s:${(0.6 + Math.random() * 0.9).toFixed(2)};color:${colors[i % colors.length]}" aria-hidden="true"><use href="#deco-${kind}"/></svg>`;
    }).join('');
    const d = dialog(`<div class="confetti" aria-hidden="true">${bits}</div>
      <div class="dlg-body cele">
        <svg class="cele-mascot" aria-hidden="true"><use href="#mascot"/></svg>
        <h2>Bravo, le dessin est apparu !</h2>
        <p>Toutes les zones numérotées sont coloriées.</p>
        <div class="dlg-actions">
          <button class="btn ghost" data-a="look">Admirer</button>
          <button class="btn primary" data-a="export">${icon('download')}Exporter en PNG</button>
        </div>
      </div>`, 'cele-dlg');
    d.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      d.close();
      if (b.dataset.a === 'export') exportPng();
      else sheet.fit(true);
    });
  }

  renderSwatches();
  updateProgress();
  applyHighlight();
  C.dirty = false;
}

// --- Impression : dessin à peindre + recettes de mélange -------------------------
async function viewPrint(id) {
  const tok = routeTok;
  document.title = 'Préparer à l’impression, MagicColor';
  app.innerHTML = `<main class="screen print">
    <header class="topbar">
      <a class="icon-btn" href="#/color/${id}" aria-label="Retour">${icon('back')}</a>
      <h1>Préparer à l’impression</h1>
      <button class="btn primary" id="doprint" disabled>${icon('printer')}Imprimer</button>
    </header>
    <div class="print-wrap">${loader('Je calcule les mélanges…')}</div>
  </main>`;
  let doc;
  try { doc = await db.get(id); } catch { doc = null; }
  if (tok !== routeTok) return;
  if (!doc) { $('.print-wrap').innerHTML = errorBox('Coloriage introuvable', 'Il a peut-être été supprimé de cet appareil.'); return; }
  document.title = `${doc.name}, à imprimer`;
  await new Promise(r => setTimeout(r)); // laisse le chargement s'afficher avant le calcul
  const rows = sortSymbols(doc.palette.map(p => p.sym)).map(sym => {
    const p = doc.palette.find(x => x.sym === sym);
    return { ...p, r: recipe(p.color) };
  });
  if (tok !== routeTok) return;
  const url = URL.createObjectURL(doc.image);
  cleanup.push(() => URL.revokeObjectURL(url));
  const tubes = PAINTS.filter(t => rows.some(r => r.r.items.some(i => i.paint === t)));
  const near = dE => (dE < 4 ? 'Très proche' : dE < 8 ? 'Proche' : 'Approché');
  $('.print-wrap').innerHTML = `
    <section class="print-sheet"><img src="${url}" alt="Dessin à peindre : ${esc(doc.name)}"></section>
    <section class="print-legend">
      <h2>${esc(doc.name)} : les mélanges</h2>
      <p class="hint">Dosages indicatifs pour de la gouache ou de l’acrylique. Une part, c’est toujours la même quantité (une goutte, une noisette). Mélange, compare à la pastille, puis ajuste.</p>
      <p class="tubes"><strong>Tubes nécessaires :</strong> ${tubes.map(t => `<span class="tube"><span class="dot" style="--c:${t.hex}"></span>${esc(t.name)}</span>`).join(' ')}</p>
      <ul class="mixes">${rows.map(({ sym, color, r }) => `<li class="mix">
        <span class="mix-sym" style="--c:${color};color:${lumOf(color) > 150 ? '#2b2230' : '#fff'}">${esc(sym)}</span>
        <ul class="mix-parts">${r.items.map(i => `<li><span class="dot" style="--c:${i.paint.hex}"></span><strong>${r.items.length === 1 ? 'Tel quel' : plural(i.parts, 'part', 'parts')}</strong> ${esc(i.paint.name)}</li>`).join('')}</ul>
        <span class="mix-res"><span class="dot big" style="--c:${r.mix}" aria-hidden="true"></span>${near(r.dE)}</span>
      </li>`).join('')}</ul>
    </section>`;
  const btn = $('#doprint');
  btn.disabled = false;
  btn.onclick = () => window.print();
}

// --- Routeur --------------------------------------------------------------------
async function route() {
  routeTok++;
  const todo = cleanup; cleanup = [];
  for (const fn of todo) { try { await fn(); } catch { /* écran déjà quitté */ } }
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  const h = location.hash.slice(1) || '/';
  let m;
  if (h === '/') return viewLibrary();
  if (h === '/new') return pending ? viewSetup(null) : (location.hash = '#/');
  if (h === '/photo') return pending && pending.photo ? viewPhoto() : (location.hash = '#/');
  if ((m = h.match(/^\/color\/([\w-]+)$/))) return viewColor(m[1]);
  if ((m = h.match(/^\/edit\/([\w-]+)$/))) return viewSetup(m[1]);
  if ((m = h.match(/^\/print\/([\w-]+)$/))) return viewPrint(m[1]);
  location.hash = '#/';
}
window.addEventListener('hashchange', route);
route();

// pas de service worker sur « localhost » : en développement on veut les fichiers frais
if ('serviceWorker' in navigator && location.protocol !== 'file:' && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
