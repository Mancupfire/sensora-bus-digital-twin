// Sensora Bus Digital Twin — static explorer. All numbers come from data/manifest.json and data/metrics.json.
import { loadManifest, getManifest, getMetrics, sliceData, sliceField, cloudField, bin, dequantXYZ, sourceAvailable, net, assetURL } from './data.js';
import { mapFor, rangeFor, colorOf, drawColorbar, fmt, registerLUT } from './colormap.js';
import { sliceImage, SlicePanel } from './slice2d.js';
import { lineChart, barChart, histogram, curveChart, SERIES, LABEL } from './charts.js';
import { initExplore } from './explore.js';

const $ = (s) => document.querySelector(s);
const ORDER = ['cfd', 'vanilla', 'pn', 'pi'];
const SPLITNAME = { 0: 'train', 1: 'validation (held out)', 2: 'test (held out)', 3: 'buffer (excluded from training)' };
const S = { mode: 'explore', tsub: 'results', model: 'pn', v: 'T', display: 'pred', view: '3d', orient3d: 'horizontal',
  sliceIdx: { horizontal: 2, longitudinal: 2, transverse: 6 }, layers: { cabin_shell: true, seats: true, occupants: true, hvac: true, slice: true, cloud: false },
  split: false, vec: false, probe: null, msplit: 'test', ref: null };
let M, MET, viewer = null, panels = [], token = 0, explore = null, curves = null;
const isAdv = () => S.mode === 'technical' && S.tsub === 'explorer';
window.__sensora = { S, net, state: () => ({ ...S }), ready: false };

function slicesOf(orient) { return M.slices.filter((s) => s.orientation === orient); }
function currentOrient() { return S.view === '3d' ? S.orient3d : S.view; }
function currentSlice() { const o = currentOrient(); const l = slicesOf(o); return l[Math.min(S.sliceIdx[o], l.length - 1)]; }
function setStatus(t) { $('#vp-status').textContent = t || ''; }
const refs = () => (M.reference_images || []).filter((r) => r.slice_id);
function activeRef() {
  if (!S.ref) return null; const r = refs().find((x) => x.file === S.ref); if (!r) return null;
  const sl = currentSlice(); return (S.view === r.orientation && sl.id === r.slice_id && S.v === r.demo_variable) ? r : null;
}
function applyRef(file) {
  const r = refs().find((x) => x.file === file); if (!r) { S.ref = null; return; }
  S.ref = file; S.view = r.orientation; S.v = r.demo_variable;
  S.sliceIdx[r.orientation] = slicesOf(r.orientation).findIndex((x) => x.id === r.slice_id); S.probe = null;
}

// ---------- boot
async function boot() {
  try {
    ({ manifest: M, metrics: MET } = await loadManifest());
  } catch (e) {
    $('#loading').hidden = true; const f = $('#fatal'); f.hidden = false;
    f.textContent = `Could not load the demo assets (${e.message}). If you opened index.html straight from disk, the browser blocks local fetches: serve the folder with "python3 serve.py" and open the printed URL.`;
    return;
  }
  $('#loading').hidden = true;
  document.querySelectorAll('[data-bind]').forEach((el) => {
    const k = el.dataset.bind; el.textContent = k === 'n_points' ? Number(1245236).toLocaleString('en-US') : (M[k] ?? '');
  });
  if (!sourceAvailable(S.model)) S.model = ORDER.find((m) => m !== 'cfd' && sourceAvailable(m)) || 'cfd';
  for (const r of (M.reference_images || [])) if (r.legend_lut) registerLUT(`ref:${r.file}`, r.legend_lut);
  if (M.public_profile) $('#build-profile').textContent = ` · ${M.public_profile.label}`;
  explore = initExplore({ M, MET, S });
  window.__sensora.explore = explore;
  readHash();
  bindUI();
  buildResults();
  buildImages();
  buildAbout();
  setMode(S.mode, S.tsub);
  window.addEventListener('hashchange', () => { readHash(); setMode(S.mode, S.tsub); });
  window.__sensora.ready = true;
}

function readHash() {
  const h = location.hash.replace(/^#/, ''); let [mode, q] = h.split('?');
  // legacy routes of the first version
  mode = { story: 'explore', explorer: 'technical/explorer', about: 'technical/methods' }[mode] || mode;
  const [top, sub] = mode.split('/');
  if (['explore', 'images', 'technical'].includes(top)) S.mode = top;
  if (top === 'technical') S.tsub = ['results', 'explorer', 'curves', 'methods'].includes(sub) ? sub : 'results';
  if (top === 'explore' && q && explore) explore.readQuery(new URLSearchParams(q));
  if (top !== 'technical' || S.tsub !== 'explorer') return;
  if (q) for (const [k, v] of new URLSearchParams(q)) {
    if (k === 'model' && ORDER.includes(v)) S.model = v; if (k === 'var' && M.variables[v]) S.v = v;
    if (k === 'view' && ['3d', 'horizontal', 'longitudinal', 'transverse'].includes(v)) S.view = v;
    if (k === 'display' && ['pred', 'cfd', 'abs', 'signed', 'compare'].includes(v)) S.display = v;
    if (k === 'slice') { const o = S.view === '3d' ? S.orient3d : S.view; S.sliceIdx[o] = +v || 0; }
    if (k === 'ref') { const r = refs()[+v]; if (r) applyRef(r.file); }
  }
}
function writeHash() {
  if (S.mode === 'explore') return; // the Explore view writes its own hash
  if (!isAdv()) { history.replaceState(null, '', S.mode === 'technical' ? `#technical/${S.tsub}` : `#${S.mode}`); return; }
  const o = currentOrient();
  const ri = S.ref ? refs().findIndex((r) => r.file === S.ref) : -1;
  history.replaceState(null, '', `#technical/explorer?model=${S.model}&var=${S.v}&view=${S.view}&display=${S.display}&slice=${S.sliceIdx[o]}${ri >= 0 ? `&ref=${ri}` : ''}`);
}

function setMode(mode, sub) {
  S.mode = mode; if (sub) S.tsub = sub;
  document.querySelectorAll('.mode').forEach((s) => { s.hidden = s.dataset.mode !== mode; });
  document.querySelectorAll('.mode-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  document.querySelectorAll('.tsub').forEach((s) => { s.hidden = s.dataset.sub !== S.tsub; });
  document.querySelectorAll('.sub-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sub === S.tsub)));
  writeHash();
  if (mode === 'explore') explore.show(); else explore.hide();
  if (isAdv()) { syncControls(); update(); }
  if (mode === 'technical' && S.tsub === 'curves') renderCurves();
  window.scrollTo(0, 0);
}

// ---------- UI binding
function bindUI() {
  document.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('.sub-btn').forEach((b) => b.addEventListener('click', () => setMode('technical', b.dataset.sub)));
  $('#sel-curve').addEventListener('change', renderCurves);
  const ml = $('#model-list');
  for (const m of ORDER) {
    const info = M.models[m]; const b = document.createElement('button'); b.type = 'button'; b.className = 'model-opt'; b.dataset.model = m;
    b.setAttribute('role', 'radio');
    const st = m === 'cfd' ? 'ref' : info.status;
    b.innerHTML = `<span>${info.label}</span><span class="st ${st}">${m === 'cfd' ? 'reference' : info.status.replace('_', ' ')}</span>`;
    if (!sourceAvailable(m)) { b.setAttribute('aria-disabled', 'true'); b.title = `${info.label} is ${info.status.replace('_', ' ')}; its field is not shown and no other model is substituted.`; }
    b.addEventListener('click', () => { if (!sourceAvailable(m)) return; S.model = m; S.probe = S.probe; syncControls(); update(); });
    ml.append(b);
  }
  const sr = $('#sel-ref');
  refs().forEach((r) => { const o = document.createElement('option'); o.value = r.file; o.textContent = `${r.title} (${r.plane_axis} ≈ ${r.estimated_position_m.toFixed(2)} m)`; sr.append(o); });
  sr.addEventListener('change', (e) => { if (e.target.value) applyRef(e.target.value); else S.ref = null; syncControls(); update(); });
  $('#sel-var').addEventListener('change', (e) => { S.v = e.target.value; S.ref = null; update(); });
  $('#sel-display').addEventListener('change', (e) => { S.display = e.target.value; update(); });
  document.querySelectorAll('#view-seg button').forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.view; S.probe = null; S.ref = null; syncControls(); update(); }));
  $('#sl-pos').addEventListener('input', (e) => { S.sliceIdx[currentOrient()] = +e.target.value; S.probe = null; S.ref = null; syncControls(); update(); });
  $('#sel-orient3d').addEventListener('change', (e) => { S.orient3d = e.target.value; S.probe = null; syncControls(); update(); });
  document.querySelectorAll('[data-layer]').forEach((c) => c.addEventListener('change', () => { S.layers[c.dataset.layer] = c.checked; if (viewer) viewer.setLayerVisible(c.dataset.layer, c.checked); update(); }));
  $('#chk-split').addEventListener('change', (e) => { S.split = e.target.checked; update(); });
  $('#chk-vec').addEventListener('change', (e) => { S.vec = e.target.checked; update(); });
  $('#btn-reset').addEventListener('click', () => { if (viewer) viewer.resetCamera(); S.probe = null; update(); });
  $('#btn-shot').addEventListener('click', screenshot);
  $('#sel-msplit').addEventListener('change', (e) => { S.msplit = e.target.value; renderMetrics(); renderBars(); });
}

function syncControls() {
  document.querySelectorAll('.model-opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.model === S.model)));
  $('#sel-var').value = S.v;
  const isCfd = S.model === 'cfd';
  [...$('#sel-display').options].forEach((o) => { o.disabled = isCfd && ['abs', 'signed', 'compare', 'pred'].includes(o.value); });
  if (isCfd) S.display = 'cfd';
  else if (S.display === 'cfd' && !S._userCfd) { /* keep user choice */ }
  $('#sel-display').value = S.display;
  document.querySelectorAll('#view-seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.view === S.view)));
  const o = currentOrient(); const l = slicesOf(o); const sl = $('#sl-pos');
  sl.max = String(l.length - 1); sl.value = String(Math.min(S.sliceIdx[o], l.length - 1));
  const cs = currentSlice(); $('#sl-pos-out').textContent = `${o} · ${cs.axis} = ${cs.value.toFixed(2)} m${(cs.matches_reference_renders || []).length ? ' · matches a solver render' : ''}`;
  sl.setAttribute('aria-valuetext', `${cs.axis} = ${cs.value.toFixed(2)} metres`);
  $('#sel-ref').value = S.ref || '';
  $('#sel-orient3d').value = S.orient3d; $('#sel-orient3d').disabled = S.view !== '3d';
  const pi = M.models.pi; let note = '';
  if (S.model === 'pi' && pi.selected_is_initial) note = 'PI selection kept its PN parent (no validation improvement), so PI fields are identical to PN. The PI training record is shown in Data & Methods.';
  if (S.model === 'pi' && !pi.selected_is_initial) note = 'PI here means continuity plus boundary constraints only. Momentum and energy residuals are off.';
  $('#model-note').textContent = note;
}

// ---------- field helpers
async function sliceValues(sl, src, v, display) {
  const cfd = await sliceField(sl.id, 'cfd', v);
  if (display === 'cfd' || src === 'cfd') return cfd;
  if (!sourceAvailable(src)) throw new Error(`${src} not available`);
  const pr = await sliceField(sl.id, src, v);
  if (display === 'pred') return pr;
  const out = new Float32Array(pr.length);
  for (let i = 0; i < pr.length; i++) out[i] = display === 'abs' ? Math.abs(pr[i] - cfd[i]) : pr[i] - cfd[i];
  return out;
}
async function cloudValues(src, v, display) {
  const cfd = await cloudField('cfd', v);
  if (display === 'cfd' || src === 'cfd') return cfd;
  const pr = await cloudField(src, v);
  if (display === 'pred') return pr;
  const out = new Float32Array(pr.length);
  for (let i = 0; i < pr.length; i++) out[i] = display === 'abs' ? Math.abs(pr[i] - cfd[i]) : pr[i] - cfd[i];
  return out;
}
function panelSpecs() {
  if (S.display === 'compare' && S.model !== 'cfd') return [['cfd', 'CFD reference'], ['pred', `${M.models[S.model].label}`], ['abs', `|${LABEL[S.model]} − CFD|`]];
  const t = { pred: M.models[S.model].label, cfd: 'CFD reference', abs: `|${LABEL[S.model]} − CFD|`, signed: `${LABEL[S.model]} − CFD (signed)` }[S.display];
  return [[S.display, t]];
}

// ---------- main update
async function update() {
  if (!isAdv()) return;
  const my = ++token; writeHash(); syncControls();
  const tr = (x) => { const t = window.__sensora.trace || (window.__sensora.trace = []); t.push(`${my}:${x}`); if (t.length > 60) t.shift(); };
  tr(`start ${S.view}`);
  const sl = currentSlice(); const specs = panelSpecs();
  const vlab = `${M.variables[S.v].label} [${M.variables[S.v].unit}]`;
  $('#vp-title').textContent = `${S.view === '3d' ? '3D' : S.view} · ${vlab} · ${sl.axis} = ${sl.value.toFixed(2)} m`;
  setStatus('Loading…');
  try {
    const sd = await sliceData(sl.id);
    const imgs = [];
    const ar = activeRef();
    for (const [disp] of specs) {
      const vals = await sliceValues(sl, S.model, S.v, disp);
      let [lo, hi] = rangeFor(M, S.v, disp); let cmap = mapFor(S.v, disp);
      if (ar && (disp === 'pred' || disp === 'cfd')) { cmap = `ref:${ar.file}`; if (ar.comparable_range) [lo, hi] = ar.legend_range; }
      imgs.push({ disp, vals, cmap, lo, hi });
    }
    renderRefPanel(ar);
    if (my !== token) return;
    window.__sensora.last = { sliceId: sl.id, model: S.model, v: S.v, display: S.display, imgs: imgs.map((i) => ({ disp: i.disp, vals: i.vals })) };
    tr('fields');
    if (S.view === '3d') await render3D(sl, sd, imgs, specs, my); else await render2D(sl, sd, imgs, specs);
    tr('drawn');
    if (my !== token) { tr('stale'); return; }
    renderLegend(imgs, specs); await renderProbe(); tr('probe'); renderMetrics(); renderBars(); await renderCharts(sl, sd); tr('charts');
    setStatus(S.model === 'cfd' ? 'CFD reference values' : 'Precomputed model predictions');
    window.__sensora.renders = (window.__sensora.renders || 0) + 1;
  } catch (e) { console.warn(e); setStatus(`Error: ${e.message}`); window.__sensora.lastError = e.message; }
}

function renderRefPanel(ar) {
  const p = $('#ref-panel');
  if (!ar || S.view === '3d') { p.hidden = true; return; }
  p.hidden = false; const img = $('#ref-img');
  const url = assetURL(ar.file); if (img.dataset.src !== url) { img.src = url; img.dataset.src = url; }
  img.alt = `STAR-CCM+ render: ${ar.title}`;
  $('#ref-cap').innerHTML = `<b>Solver render (STAR-CCM+, provided)</b>: ${ar.title}. Legend ${ar.legend_range[0]}–${ar.legend_range[1]} (${ar.render_variable}).<br>`
    + `Plane <b>estimated</b> at ${ar.plane_axis} ≈ ${ar.estimated_position_m.toFixed(3)} m by colour matching (r = ${ar.pearson_r.toFixed(2)}; plausible ${ar.plausible_range_m[0]}–${ar.plausible_range_m[1]} m${ar.identifiable ? '' : '; <b>not identifiable from this image</b>, plane taken from the companion render'}). `
    + (ar.comparable_range ? 'The slices below use this render\'s own colour bar and range.' : `<span class="warn">${ar.p_piezo_note}</span>`)
    + ' Camera framing, solids and JPEG compression differ, so compare patterns rather than pixels.';
}

async function render2D(sl, sd, imgs, specs) {
  $('#vp3d').hidden = true; const host = $('#vp2d'); host.hidden = false;
  host.classList.toggle('compare', specs.length > 1); host.innerHTML = ''; panels = [];
  let arrows = null;
  if (S.vec) {
    const src = S.display === 'cfd' || S.model === 'cfd' ? 'cfd' : S.model;
    const g = sl.grid; const comp = { x: 'u', y: 'v', z: 'w' };
    const U = await sliceField(sl.id, src, comp[g.u_axis]), V = await sliceField(sl.id, src, comp[g.v_axis]);
    arrows = { sd, U, V, scale: 1.0 };
  }
  specs.forEach(([, title], i) => {
    const p = new SlicePanel(host, title, (px) => { S.probe = { kind: 'slice', ...px }; update(); });
    const im = imgs[i]; const c = sliceImage(sl, sd, im.vals, im.cmap, im.lo, im.hi, { markSplit: S.split });
    p.cursor = S.probe && S.probe.kind === 'slice' ? S.probe : null;
    p.setTitle(`${title} — ${sl.orientation} ${sl.axis} = ${sl.value.toFixed(2)} m`);
    p.draw(sl, c, { arrows }); panels.push(p);
  });
}

let geomLoaded = false, cloudLoaded = false;
async function render3D(sl, sd, imgs, specs, my) {
  $('#vp2d').hidden = true; const host = $('#vp3d'); host.hidden = false;
  if (!viewer) {
    const { Viewer3D } = await import('./viewer3d.js');
    viewer = new Viewer3D(host, M); viewer.onProbe = (p) => { S.probe = p; update(); };
    for (const [k, on] of Object.entries(S.layers)) viewer.layers[k] = on;
  }
  if (!geomLoaded) {
    geomLoaded = true;
    for (const [g, meta] of Object.entries(M.geometry)) viewer.addGroup(g, dequantXYZ(await bin(meta.file, Int16Array)));
  }
  if (S.layers.cloud && !cloudLoaded) {
    cloudLoaded = true; setStatus('Loading 3D field cloud…');
    viewer.setCloud(dequantXYZ(await bin('cloud/xyz.bin', Int16Array)), await bin('cloud/split.bin', Uint8Array));
  }
  const texs = imgs.map((im) => sliceImage(sl, sd, im.vals, im.cmap, im.lo, im.hi, { transparentNoData: true, markSplit: S.split }));
  viewer.setSlice(sl, texs[0]);
  let cloudRGBs = null;
  if (S.layers.cloud && viewer.cloud) {
    cloudRGBs = [];
    for (const [disp] of specs) {
      const vals = await cloudValues(S.model, S.v, disp); const [lo, hi] = rangeFor(M, S.v, disp); const cm = mapFor(S.v, disp);
      const rgb = new Uint8Array(vals.length * 3); for (let i = 0; i < vals.length; i++) colorOf(cm, lo, hi, vals[i], rgb, 3 * i);
      cloudRGBs.push(rgb);
    }
    if (my !== token) return;
    viewer.setCloudColors(cloudRGBs[0]);
  }
  viewer.applyLayers();
  if (specs.length > 1) viewer.setCompare(specs.map(([, label], i) => ({ label, sliceTex: viewer.makeTexture(texs[i]), cloudRGB: cloudRGBs ? cloudRGBs[i] : null })));
  else viewer.setCompare(null);
  viewer.resize();
}

function renderLegend(imgs, specs) {
  const L = $('#legend'); L.innerHTML = '';
  imgs.forEach((im, i) => {
    const wrap = document.createElement('span'); const c = document.createElement('canvas'); drawColorbar(c, im.cmap);
    const u = M.variables[S.v].unit; const kind = { pred: '', cfd: '', abs: '|error| ', signed: 'error ' }[im.disp];
    wrap.innerHTML = `<b>${specs[i][1]}</b> `; wrap.append(`${kind}≤${fmt(im.lo)} `, c, ` ≥${fmt(im.hi)} ${u}`);
    L.append(wrap);
  });
  const nd = document.createElement('span'); nd.innerHTML = '<span class="nd"></span> no data (solid or outside the cabin: nearest exported sample is a boundary face)'; L.append(nd);
  const ar = activeRef();
  const cl = document.createElement('span'); cl.className = 'muted'; cl.textContent = ar ? `Colours: the solver render's own colour bar${ar.comparable_range ? ` and range ${ar.legend_range[0]}–${ar.legend_range[1]}` : ' (own p_working range: p_piezo differs)'}; values beyond it are clamped. Same for every model.` : `Same fixed range for every model (${M.variables[S.v].display_rule || 'fixed'}); values beyond it are clamped.`; L.append(cl);
  if (S.split) { const s = document.createElement('span'); s.innerHTML = 'Hatched cells: <span style="color:#22d3ee">validation</span> / <span style="color:#fb923c">test</span> blocks'; L.append(s); }
  if (S.vec) { const s = document.createElement('span'); s.textContent = 'Arrows: in-plane velocity of the steady field (flow visualisation, not transient CFD)'; L.append(s); }
  if (S.view === '3d') { const s = document.createElement('span'); s.textContent = 'Geometry: decimated boundary face centres from the CFD export (point cloud, not a mesh)'; L.append(s); }
}

// ---------- probe
async function probeCell() {
  if (!S.probe) return null;
  if (S.probe.kind === 'cloud') {
    const xyz = dequantXYZ(await bin('cloud/xyz.bin', Int16Array)); const split = await bin('cloud/split.bin', Uint8Array); const gid = await bin('cloud/gid.bin', Uint32Array);
    const i = S.probe.index; const vals = {};
    for (const v of Object.keys(M.variables)) { vals[v] = {}; for (const s of ORDER) if (sourceAvailable(s)) vals[v][s] = (await cloudField(s, v))[i]; }
    return { where: '3D field-cloud point', xyz: [xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]], gid: gid[i], split: split[i], vals, method: 'exact stored value at an exported CFD cell centre (16-bit quantised)' };
  }
  const sl = currentSlice(); const sd = await sliceData(sl.id); const g = sl.grid;
  const k = sd.index[S.probe.r * g.nx + S.probe.q];
  const plane = { [g.u_axis]: g.u0 + S.probe.q * g.res, [g.v_axis]: g.v0 + S.probe.r * g.res, [sl.axis]: sl.value };
  if (k === 65535) return { nodata: true, plane };
  const vals = {};
  for (const v of Object.keys(M.variables)) { vals[v] = {}; for (const s of ORDER) if (sourceAvailable(s)) vals[v][s] = (await sliceField(sl.id, s, v))[k]; }
  const xyz = [sd.xyz[3 * k], sd.xyz[3 * k + 1], sd.xyz[3 * k + 2]];
  const d = Math.hypot(xyz[0] - plane.x, xyz[1] - plane.y, xyz[2] - plane.z);
  return { where: `slice pixel (${plane.x.toFixed(3)}, ${plane.y.toFixed(3)}, ${plane.z.toFixed(3)}) m`, xyz, gid: sd.gid[k], split: sd.split[k], vals, dist: d,
    method: `nearest exported CFD cell centre, ${(d * 100).toFixed(1)} cm from the pixel centre; no interpolation; stored values are 16-bit quantised` };
}
async function renderProbe() {
  const box = $('#probe'); const p = await probeCell(); window.__sensora.probe = p;
  if (!p) { box.innerHTML = ''; return; }
  if (p.nodata) { box.innerHTML = `<p class="small">No data at (${fmt(p.plane.x)}, ${fmt(p.plane.y)}, ${fmt(p.plane.z)}) m. The nearest exported sample is a boundary face (a solid or the outside). No value is invented there.</p>`; return; }
  const u = (v) => M.variables[v].unit;
  let h = `<table class="kv"><tr><td>Location</td><td>${p.where}</td></tr><tr><td>CFD cell xyz</td><td>${p.xyz.map((a) => a.toFixed(3)).join(', ')} m</td></tr>`;
  h += `<tr><td>Cell id</td><td>#${p.gid}</td></tr><tr><td>Split</td><td>${SPLITNAME[p.split]}</td></tr><tr><td>Method</td><td style="white-space:normal">${p.method}</td></tr></table>`;
  h += `<table class="kv" style="margin-top:8px"><tr><th>${M.variables[S.v].label}</th><th>value [${u(S.v)}]</th><th>model − CFD</th></tr>`;
  for (const s of ORDER) if (p.vals[S.v][s] !== undefined) { const e = s === 'cfd' ? '' : fmt(p.vals[S.v][s] - p.vals[S.v].cfd); h += `<tr><td style="color:${SERIES[s]}">${LABEL[s]}</td><td>${fmt(p.vals[S.v][s], 4)}</td><td>${e}</td></tr>`; }
  h += '</table>';
  if (S.model !== 'cfd') {
    h += `<table class="kv" style="margin-top:8px"><tr><th>${LABEL[S.model]} vs CFD</th><th>CFD</th><th>model</th><th>error</th></tr>`;
    for (const v of ['T', 'speed', 'p', 'u', 'v', 'w']) h += `<tr><td>${v} [${u(v)}]</td><td>${fmt(p.vals[v].cfd, 4)}</td><td>${fmt(p.vals[v][S.model], 4)}</td><td>${fmt(p.vals[v][S.model] - p.vals[v].cfd)}</td></tr>`;
    h += '</table>';
  }
  box.innerHTML = h;
}

// ---------- metrics
function metricRows(split, region = 'interior') { return MET.rows.filter((r) => r.split === split && r.region === region); }
function renderMetrics() {
  const rows = metricRows(S.msplit); const u = M.variables[S.v] ? M.variables[S.v].unit : '';
  const models = ['vanilla', 'pn', 'pi', 'baseline_idw8_train', 'baseline_train_mean'];
  let h = `<p class="small muted">${S.msplit === 'full_domain_fit' ? 'Full-domain fit includes training points, so it is NOT a test score.' : S.msplit === 'test' ? 'Held-out spatial blocks, scored once after checkpoints were frozen.' : S.msplit === 'val' ? 'Validation blocks were used to select checkpoints.' : 'Training points (fit).'} Interior cells, pointwise averages (not volume-weighted).</p>`;
  h += `<table class="kv"><tr><th>${S.v} [${u}]</th><th>RMSE</th><th>MAE</th><th>bias</th><th>P95</th></tr>`;
  for (const m of models) {
    const r = rows.find((x) => x.model === m && x.var === S.v); if (!r) continue;
    h += `<tr><td style="color:${SERIES[m]}">${LABEL[m]}</td><td>${fmt(r.rmse)}</td><td>${fmt(r.mae)}</td><td>${fmt(r.bias)}</td><td>${fmt(r.p95_abs)}</td></tr>`;
  }
  const n = rows.find((x) => x.var === S.v); h += `</table><p class="small muted">n = ${n ? n.n_points.toLocaleString('en-US') : '—'} cells. Source: metrics.json (run ${MET.run_id}).</p>`;
  for (const m of ['vanilla', 'pn', 'pi']) if (MET.runtime[m]) h += `<p class="small muted">${LABEL[m]}: full-domain inference ${MET.runtime[m].full_domain_inference_s}s for ${MET.runtime[m].points.toLocaleString('en-US')} points, peak ${MET.runtime[m].peak_vram_MB} MB (${MET.runtime[m].device}).</p>`;
  $('#metrics-box').innerHTML = h;
}
function renderBars() {
  const rows = metricRows(S.msplit); const vars = ['T', 'speed', 'p', 'u', 'v', 'w']; const keys = ['vanilla', 'pn', 'pi', 'baseline_idw8_train'];
  const val = {};
  for (const v of vars) {
    const base = rows.find((r) => r.model === 'baseline_train_mean' && r.var === v);
    val[v] = {}; for (const k of keys) { const r = rows.find((x) => x.model === k && x.var === v); if (r && base) val[v][k] = r.rmse / base.rmse; }
  }
  $('#ch-bars-cap').textContent = `RMSE ÷ RMSE of the train-mean predictor (${S.msplit === 'full_domain_fit' ? 'full-domain fit' : S.msplit}, interior; lower is better)`;
  barChart($('#ch-bars'), vars, keys.filter((k) => rows.some((r) => r.model === k)), val, 'relative RMSE');
}
async function renderCharts(sl, sd) {
  const g = sl.grid;
  if (S.probe && S.probe.kind === 'slice') {
    const xs = [], ser = []; for (let q = 0; q < g.nx; q++) xs.push(g.u0 + q * g.res);
    for (const s of ORDER) {
      if (!sourceAvailable(s)) continue; const f = await sliceField(sl.id, s, S.v); const y = [];
      for (let q = 0; q < g.nx; q++) { const k = sd.index[S.probe.r * g.nx + q]; y.push(k === 65535 ? null : f[k]); }
      ser.push({ label: LABEL[s], color: SERIES[s], y, width: s === 'cfd' || s === S.model ? 2.2 : 1 });
    }
    $('#ch-prof-cap').textContent = `${M.variables[S.v].label} along ${g.u_axis} through the probe (${g.v_axis} = ${(g.v0 + S.probe.r * g.res).toFixed(2)} m); gaps = no data`;
    lineChart($('#ch-prof'), xs, ser, `${g.u_axis} [m]`, `${S.v} [${M.variables[S.v].unit}]`);
  } else { $('#ch-prof-cap').textContent = 'Profile through probe'; lineChart($('#ch-prof'), [], [], '', ''); }
  if (S.model !== 'cfd') {
    const cfd = await sliceField(sl.id, 'cfd', S.v), pr = await sliceField(sl.id, S.model, S.v);
    const e = new Float32Array(pr.length); for (let i = 0; i < e.length; i++) e[i] = Math.abs(pr[i] - cfd[i]);
    const [, hi] = M.variables[S.v].abs_error_display;
    $('#ch-hist-cap').textContent = `|${LABEL[S.model]} − CFD| on this slice (${pr.length.toLocaleString('en-US')} cells, all splits)`;
    histogram($('#ch-hist'), e, 0, hi, SERIES[S.model], `|error| [${M.variables[S.v].unit}]`);
  } else histogram($('#ch-hist'), null);
}

// ---------- screenshot
function screenshot() {
  let url;
  if (S.view === '3d' && viewer) url = viewer.screenshot();
  else {
    const cs = panels.map((p) => p.canvas); const W = Math.max(...cs.map((c) => c.width)); const H = cs.reduce((a, c) => a + c.height + 24, 30);
    const out = document.createElement('canvas'); out.width = W; out.height = H; const ctx = out.getContext('2d');
    ctx.fillStyle = '#081227'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#e6eef8'; ctx.font = '14px Inter, sans-serif';
    ctx.fillText(`Sensora Bus · ${$('#vp-title').textContent} · precomputed (run ${M.run_id})`, 8, 20);
    let y = 30; panels.forEach((p) => { ctx.fillText(p.h.textContent, 8, y + 14); ctx.drawImage(p.canvas, 0, y + 20); y += p.canvas.height + 24; });
    url = out.toDataURL('image/png');
  }
  const a = document.createElement('a'); a.href = url; a.download = `sensora-bus_${S.model}_${S.v}_${S.view}.png`; a.click();
}

// ---------- CFD reference images (gallery + CAD figure); hidden content when the build has none
function buildImages() {
  const all = M.reference_images || [];
  const cad = all.find((r) => r.kind === 'cad_exterior');
  if (cad) { $('#cad-img').src = assetURL(cad.file); $('#cad-cap').textContent = 'Exterior CAD view of the simulated bus, supplied with the case. Shown for context only; it is not CFD output. Branding is part of the original image.'; }
  else $('#cad-fig').hidden = true;
  const renders = all.filter((x) => x.kind !== 'cad_exterior');
  $('#images-none').hidden = all.length > 0;
  if (!all.length) $('#nav-images').title = 'Not included in this build';
  const gal = $('#ref-gallery'); const rl = refs();
  if (!rl.length) $('#sel-ref').closest('details').hidden = true;
  for (const r of renders) {
    const c = document.createElement('article'); c.className = 'ref-card glass'; const i = rl.indexOf(r);
    const est = r.slice_id ? `Section plane <b>estimated</b> at ${r.plane_axis} ≈ ${r.estimated_position_m.toFixed(2)} m by colour matching${r.identifiable ? '' : ' (not identifiable from this image alone; taken from the companion render)'}.` : 'A 3D surface view; it has no matching slice.';
    c.innerHTML = `<img alt="STAR-CCM+ render: ${r.title}" loading="lazy" src="${assetURL(r.file)}"><h3>${r.title}</h3><p class="small muted">Colour bar ${r.legend_range[0]}–${r.legend_range[1]} (${r.render_variable}). ${est} ${r.p_piezo_note ? r.p_piezo_note : ''}</p>`;
    if (i >= 0) { const b = document.createElement('a'); b.className = 'btn'; b.href = `#technical/explorer?ref=${i}`; b.textContent = 'Open the matching slice →'; c.append(b); }
    gal.append(c);
  }
}

// ---------- technical: results
async function buildResults() {
  for (const m of ['vanilla', 'pn', 'pi']) {
    const el = document.querySelector(`[data-params="${m}"]`); const s = MET.selection && MET.selection[m];
    el.textContent = s ? `${s.params.toLocaleString('en-US')} parameters · selected step ${s.selected_step}${s.selected_is_initial ? ' (= parent)' : ''}` : `status: ${M.models[m].status}`;
  }
  // metrics table: spatial TEST, interior
  const rows = metricRows('test'); const vars = ['T', 'speed', 'p', 'u', 'v', 'w'];
  const models = ['vanilla', 'pn', 'pi', 'baseline_idw8_train', 'baseline_train_mean'].filter((m) => rows.some((r) => r.model === m));
  let h = `<caption class="small muted" style="caption-side:bottom;text-align:left;padding-top:6px">Spatial held-out TEST blocks, interior cells, RMSE. Units: T °C (= K for differences), speed/u/v/w m/s, p Pa. Numbers are read live from metrics.json.</caption><tr><th>model</th>${vars.map((v) => `<th>${v}</th>`).join('')}</tr>`;
  const best = {}; for (const v of vars) { const cand = rows.filter((r) => ['vanilla', 'pn', 'pi'].includes(r.model) && r.var === v); if (cand.length) best[v] = Math.min(...cand.map((r) => r.rmse)); }
  for (const m of models) {
    const ref = m.startsWith('baseline');
    h += `<tr class="${ref ? 'ref' : ''}"><td style="color:${SERIES[m]}">${LABEL[m]}${ref ? ' (reference)' : ''}</td>` + vars.map((v) => { const r = rows.find((x) => x.model === m && x.var === v); const b = !ref && r && r.rmse === best[v]; return `<td style="${b ? 'color:#34d399;font-weight:600' : ''}">${r ? fmt(r.rmse) : '—'}</td>`; }).join('') + '</tr>';
  }
  $('#story-metrics').innerHTML = h;
  const pi = MET.selection && MET.selection.pi;
  $('#story-metrics-note').textContent = `Green marks the lowest neural-model RMSE per variable. IDW-8 interpolates from training points only, and train-mean predicts a constant; both are non-neural references. ${pi && pi.selected_is_initial ? 'PI validation never beat its PN parent, so the selected PI checkpoint IS the PN parent and its scores equal PN. ' : ''}One scenario and spatially correlated cells: these are not independent replicates, so no significance claims are made.`;
  const pz = (M.reference_images || []).find((r) => r.p_piezo_note);
  $('#ppiezo-note').textContent = pz ? `Note: the supplied "p_piezo" render is not this pressure. ${pz.p_piezo_note}` : 'Note: a supplied solver render labelled "p_piezo" does not match this exported working pressure (its median is about 1.7 Pa lower; the definition is unknown).';
  const lim = ['One CFD scenario. The models reconstruct this field; they cannot be used to predict other HVAC settings, occupancy or weather.',
    'The fixed scenario facts are shown as facts only. No slider changes the field, because no other condition was simulated.',
    'Fields are precomputed. Nothing is inferred live, the demo has no backend, and location readouts are looked up from stored values: they are not live sensors.',
    'PI uses compressible continuity and boundary constraints only. Momentum and energy residuals are off because k and ε were not exported.',
    'Solver convergence is not verified. Only the iteration count (2100) was provided.',
    'Metrics average over exported cell centres, which cluster heavily near walls. They are not volume-weighted.',
    'No comfort indices (PMV/PPD), CO₂, energy savings or setpoint recommendations are computed. The data cannot support them.',
    'The 3D bus surfaces are triangulated from the CFD boundary face centres for display only. They are not the solver mesh or the CAD model, and the exterior body below the cabin floor (chassis, wheels) is not part of the simulation.'];
  $('#limits').innerHTML = lim.map((l) => `<li>${l}</li>`).join('');
  const hs = M.slices.filter((s) => s.orientation === 'horizontal').reduce((a, b) => (Math.abs(b.value - 1.1) < Math.abs(a.value - 1.1) ? b : a));
  const sd = await sliceData(hs.id);
  drawStory($('#split-canvas'), sliceImage(hs, sd, null, null, 0, 1, { splitView: true })); $('#split-z').textContent = hs.value.toFixed(2);
}
function drawStory(canvas, img) { const ctx = canvas.getContext('2d'); canvas.width = img.width * 3; canvas.height = img.height * 3; ctx.imageSmoothingEnabled = false; ctx.drawImage(img, 0, 0, canvas.width, canvas.height); }

// ---------- technical: learning curves (validation only)
const CURVE_RUNS = { vanilla: ['Vanilla', SERIES.vanilla], pn: ['PN', SERIES.pn] };
async function renderCurves() {
  const cap = $('#curve-cap');
  try {
    if (!curves) {
      if (!M.files['learning_curves.json']) throw new Error('learning_curves.json is not in this build');
      const r = await fetch(assetURL('learning_curves.json')); if (!r.ok) throw new Error(`HTTP ${r.status}`); curves = await r.json();
    }
  } catch (e) { cap.textContent = `Error: could not load learning curves (${e.message}).`; return; }
  const key = $('#sel-curve').value; const ser = [];
  const piCols = ['#fb923c', '#fdba74', '#f97316', '#fed7aa'];
  let k = 0;
  for (const [run, c] of Object.entries(curves.runs)) {
    const isPi = run.startsWith('pi');
    const [label, color] = CURVE_RUNS[run] || [`PI candidate ${run.replace('pi_', '')}${run === curves.pi_winner ? ' (selected)' : ''}`, piCols[k++ % piCols.length]];
    const si = c.step.indexOf(c.selected_step);
    ser.push({ label, color, x: c.step, y: c[key], width: isPi ? 1.4 : 2.2, mark: si >= 0 ? si : null, dash: isPi && run !== curves.pi_winner });
  }
  curveChart($('#curve-canvas'), ser, 'training step (PI candidates: steps after the warm start from PN)', $('#sel-curve').selectedOptions[0].textContent);
  cap.textContent = `${curves.note} Rings mark the selected checkpoint of each run. Every PI candidate kept its warm start (step 0 = the selected PN), because no later PI step improved validation; the selected PI checkpoint is therefore identical to PN. Selection rule for PI: ${curves.pi_rule || '—'}.`;
}

function buildAbout() {
  const sel = MET.selection || {}; const ph = MET.physics_diagnostics || {};
  const physRows = Object.entries(ph).map(([m, d]) => `<tr><td>${LABEL[m]}</td><td>${fmt(d.continuity_train.rms)}</td><td>${fmt(d.continuity_heldout_val_test.rms)}</td></tr>`).join('');
  $('#about-body').innerHTML = `
  <h2>Methods &amp; provenance</h2>
  <p><b>Run</b> <code>${M.run_id}</code> · <b>assets</b> <code>${M.asset_version}</code> · <b>case</b> <code>${M.case_id}</code></p>
  <h3>Data source</h3>
  <p>A single steady RANS simulation of the VinBus cabin (STAR-CCM+ export). It has 1,245,236 samples: 1,041,804 interior cell centres plus 203,432 boundary face centres on 36 named patches. The 36 boundary CSV files are patches of this same case; they are not separate cases. Solver: ideal gas, Realizable k-ε two-layer, gravity, ρ_ref = 1.18 kg/m³. Only the iteration count (2100) is known, so convergence is not verified. Frame: ${M.frame}.</p>
  <h3>Task and split</h3>
  <p>The task is single-scenario <b>spatial reconstruction</b>. The interior is divided into a 17×4×4 grid of blocks of about 0.5 × 0.6 × 0.57 m. Whole blocks go to train, validation or test (seed 2026), and training points within 5 cm of a held-out block are dropped. Checkpoints were chosen on validation only. Test was evaluated once, after freezing (split hash <code>${M.split.hashes.split_sha256.slice(0, 16)}…</code>). Full-domain fit scores include training points and are labelled that way.</p>
  <h3>Models</h3>
  <ul><li><b>Vanilla DeepONet</b>: MLP branch over 512 canonically ordered boundary samples (27 channels each), ${sel.vanilla ? sel.vanilla.params.toLocaleString('en-US') : '—'} parameters.</li>
  <li><b>PN-DeepONet</b>: PointNet branch over the same samples, ${sel.pn ? sel.pn.params.toLocaleString('en-US') : '—'} parameters. The parameter counts differ, so the models are not parameter-matched.</li>
  <li><b>PI-PN-DeepONet</b>: the PN architecture warm-started from the selected PN checkpoint. Selected step ${sel.pi ? sel.pi.selected_step : '—'}${sel.pi && sel.pi.selected_is_initial ? ': the parent was kept because no PI step improved validation, so PI fields equal PN fields' : ''}.</li></ul>
  <p>All three models share the same inputs. The branch holds boundary geometry, patch role and the prescribed T, ṁ, h, T_amb, q, return vector and outlet p, with separate masks for missing values. The trunk holds normalised xyz plus exp(−d/ℓ) of the distance to each of the 36 patches, using face-centre geometry only. No CFD solution value is ever an input.</p>
  <h3>Physics scope (PI)</h3>
  <p>Enabled: steady compressible continuity div(ρu) = 0, with ρ = p_abs/(R T) from the predicted p and T; no-slip on walls; the return-grille velocity vector; inlet temperatures (18 °C supply, 34 °C mouths); and the leak working pressure of 0 Pa. Collocation uses train blocks only. Disabled: RANS momentum and energy (k and ε are not exported, so the μ_t closure is unavailable), convection and heat-flux wall BCs (no face normals or areas; the seat h is a field function), and pointwise ṁ → velocity.</p>
  <table class="metrics"><tr><th>model</th><th>continuity RMS, train blocks</th><th>continuity RMS, held-out blocks</th></tr>${physRows}</table>
  <h3>How the visuals are made</h3>
  <p>Slice pixels (${M.slice_method.pixel_m * 100} cm) show the <b>nearest exported CFD cell</b>; nothing is interpolated. A pixel is no-data when its nearest exported sample is a boundary face (a solid or the outside) or lies more than ${M.slice_method.no_data.match(/[0-9.]+ m/) ? M.slice_method.no_data.match(/[0-9.]+ m/)[0] : '0.15 m'} away. In the Error explorer, geometry is shown as decimated boundary face centres. In the main view, light surfaces are triangulated from those same face centres (one real face centre kept per 2.5–6 cm voxel, per-axis Delaunay, long edges removed); they are a display aid, not the solver mesh or CAD, and are never used for computation. Labels (driver, doors, rear, vents) are anchored at the centroids of the named CFD patches. The 3D field cloud is a voxel-balanced sample of ${M.cloud.count.toLocaleString('en-US')} interior cells. Values are stored as 16-bit quantised numbers. Colour ranges are the same for every model.</p>
  <h3>Solver renders (reference images)</h3>
  ${!(M.reference_images || []).length ? `<p>Seven images were supplied with the case (six STAR-CCM+ renders and one exterior CAD view). ${M.public_profile ? 'They are <b>not included in this public build</b> because permission to publish them has not been confirmed; the local / offline version contains them.' : ''} The comparison summarised here (frame, orientation and geometry agree with the export; the <code>p_piezo</code> render is not the exported working pressure) is documented in the project report REFERENCE_IMAGE_CHECK.md.</p>` : ''}
  <p ${!(M.reference_images || []).length ? 'hidden' : ''}>Seven images came with the case: six STAR-CCM+ renders and one exterior CAD view. They are shown verbatim, and their sha256 is in the asset manifest. The section planes are not recorded. They were estimated by inverting each render's colour bar and correlating the result with the export on candidate planes. The geometric cues (mouth dots, body cross-sections, seat profiles, jet directions) agree with the exported frame. The <code>p_piezo</code> render does not equal the exported working pressure; its median is about 1.7 Pa lower and its definition is unknown. The renders are a consistency check, not a validation.</p>
  <table class="metrics" ${refs().length ? '' : 'hidden'}><tr><th>render</th><th>estimated plane</th><th>r</th></tr>${refs().map((r) => `<tr><td>${r.title}</td><td>${r.plane_axis} ≈ ${r.estimated_position_m.toFixed(3)} m${r.identifiable ? '' : ' (from companion)'}</td><td>${r.pearson_r.toFixed(2)}</td></tr>`).join('')}</table>
  <h3>To become an operator surrogate</h3>
  <p>Many more independent CFD scenarios are needed, varying supply temperature and flow, occupancy, solar load and outdoor temperature, together with a case-level train/test split. Exporting k, ε, face areas and face normals would enable momentum, energy and wall-flux physics.</p>`;
}

boot();
