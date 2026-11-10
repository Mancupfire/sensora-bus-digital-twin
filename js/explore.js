// "Explore" — the default, non-specialist view: a large 3D bus, a coloured slice of the stored CFD field,
// simple controls, a location readout, and an optional panel comparing the AI predictions.
// Every value comes from data/ (stored CFD values or stored model predictions); nothing is computed live
// except colours, arrows and the nearest-cell lookup.
import { sliceData, sliceField, rawBin, bin, dequantXYZ, sourceAvailable, hasAsset } from './data.js';
import { colorOf, drawColorbar, fmt, mapFor } from './colormap.js';
import { sliceImage, SlicePanel } from './slice2d.js';

const $ = (s) => document.querySelector(s);
const MODELS = ['vanilla', 'pn', 'pi'];
const SOURCES = ['cfd', ...MODELS];
const VAR = {
  T: { name: 'Temperature', unit: '°C', lo: 'Cooler', hi: 'Warmer', d: 1 },
  speed: { name: 'Airflow speed', unit: 'm/s', lo: 'Slower', hi: 'Faster', d: 2 },
};
const FLOOR_Z = 0.38; // front-section cabin floor in the CFD frame (raised rear floor is higher)
const DEFAULT_POS = { horizontal: 1.4, longitudinal: -0.1, transverse: 4.25 };
// screen-space nudges for labels so they sit outside the body: [dx, dy] added to the outward direction
const LABEL_BIAS = { driver: [-0.3, -1], front_door: [-0.2, 1], middle_door: [0, 1], rear: [1, -0.3], air_vents: [0.2, -1] };

export function initExplore({ M, MET }) {
  const E = { v: 'T', look: 'exterior', started: false, orient: 'horizontal', idx: {}, probe: null, src: 'cfd',
    labels: true, arrows: false, arrowsTouched: false, compare: false,
    layers: { cabin_shell: true, seats: true, occupants: true, hvac: true, slice: true, arrows: true } };
  const sens = window.__sensora; sens.E = E; sens.exRenders = 0;
  let viewer = null, building = null, token = 0, cmpPanels = [], active = false;

  const slicesOf = (o) => M.slices.filter((s) => s.orientation === o);
  for (const o of Object.keys(DEFAULT_POS)) {
    const l = slicesOf(o); let best = 0;
    l.forEach((s, i) => { if (Math.abs(s.value - DEFAULT_POS[o]) < Math.abs(l[best].value - DEFAULT_POS[o])) best = i; });
    E.idx[o] = best;
  }
  const cur = () => { const l = slicesOf(E.orient); return l[Math.min(E.idx[E.orient], l.length - 1)]; };
  const status = (t) => { $('#ex-status').textContent = t || ''; };
  const srcLabel = (s) => (s === 'cfd' ? 'CFD simulation (reference)' : M.models[s].label);
  const short = (s) => ({ cfd: 'CFD reference', vanilla: 'Vanilla DeepONet', pn: 'PN-DeepONet', pi: 'PI-PN-DeepONet' }[s]);

  // ---------------------------------------------------------------- words for places
  function along(x) {
    if (x < 1.3) return 'front of the cabin, by the driver and the front door';
    if (x < 3.6) return 'front half of the cabin';
    if (x < 4.9) return 'middle of the cabin, by the middle door';
    if (x < 7.4) return 'rear half of the cabin';
    return 'rear of the cabin';
  }
  function side(y) { return y < -0.45 ? 'driver side (left)' : y > 0.45 ? 'door side (right)' : 'centre aisle'; }
  function heightTxt(z) { return `${Math.max(0, z - FLOOR_Z).toFixed(2)} m above the front floor`; }
  function posText(sl) {
    if (sl.orientation === 'horizontal') return `${heightTxt(sl.value)} (z = ${sl.value.toFixed(2)} m)`;
    if (sl.orientation === 'longitudinal') {
      const y = sl.value; const w = Math.abs(y) < 0.05 ? 'on the centre line' : `${Math.abs(y).toFixed(2)} m toward the ${y < 0 ? 'driver side' : 'door side'}`;
      return `${w} (y = ${y.toFixed(2)} m)`;
    }
    return `${sl.value.toFixed(2)} m from the front of the cabin: ${along(sl.value)}`;
  }
  const POS_LBL = { horizontal: 'Height', longitudinal: 'Position across the width', transverse: 'Position from front to rear' };

  // ---------------------------------------------------------------- controls
  document.querySelectorAll('[data-var]').forEach((b) => b.addEventListener('click', () => {
    E.v = b.dataset.var; if (E.v === 'speed' && !E.arrowsTouched) E.arrows = true; if (E.v === 'T' && !E.arrowsTouched) E.arrows = false;
    start(); sync(); draw();
  }));
  document.querySelectorAll('[data-look]').forEach((b) => b.addEventListener('click', () => {
    E.look = b.dataset.look; E._lookChosen = true; if (E.look === 'inside') start(); sync(); if (viewer) viewer.setLook(E.look); draw();
  }));
  $('#btn-inside').addEventListener('click', () => { E.look = 'inside'; start(); sync(); if (viewer) viewer.setLook('inside'); draw(); $('#stage3d').focus({ preventScroll: true }); });
  $('#ex-orient').addEventListener('change', (e) => { E.orient = e.target.value; E.probe = null; start(); sync(); draw(); });
  $('#ex-pos').addEventListener('input', (e) => { E.idx[E.orient] = +e.target.value; E.probe = null; start(); sync(); draw(); });
  $('#ex-labels').addEventListener('change', (e) => { E.labels = e.target.checked; placeLabels(); });
  $('#ex-arrows').addEventListener('change', (e) => { E.arrows = e.target.checked; E.arrowsTouched = true; draw(); });
  document.querySelectorAll('[data-exlayer]').forEach((c) => c.addEventListener('change', () => {
    E.layers[c.dataset.exlayer] = c.checked; if (viewer) viewer.setLayerVisible(c.dataset.exlayer, c.checked);
    if (c.dataset.exlayer === 'slice') { viewer && viewer.setLayerVisible('arrows', c.checked); }
  }));
  document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => {
    if (!viewer) return; if (b.dataset.cam === 'reset') viewer.resetCamera(); else viewer.setView(b.dataset.cam);
    sens.exCam = b.dataset.cam;
  }));
  $('#btn-compare').addEventListener('click', () => { setCompare(!E.compare); });
  $('#btn-compare-close').addEventListener('click', () => setCompare(false));
  $('#stage3d').addEventListener('keydown', (e) => {
    const sl = cur(); const g = sl.grid; if (!E.started) return;
    const c = E.probe || { q: Math.floor(g.nx / 2), r: Math.floor(g.ny / 2) };
    const d = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, 4], ArrowDown: [0, -4] }[e.key];
    if (d) { e.preventDefault(); setProbe({ q: Math.max(0, Math.min(g.nx - 1, c.q + d[0])), r: Math.max(0, Math.min(g.ny - 1, c.r + d[1])) }); }
    else if (e.key === 'Enter') { e.preventDefault(); setProbe(c); }
  });

  function start() {
    if (E.started) return; E.started = true; E.look = E.look === 'exterior' && !E._lookChosen ? 'inside' : E.look;
    $('#intro').classList.add('done'); if (viewer) { viewer.setLook(E.look); viewer.setLayerVisible('slice', E.layers.slice); }
  }
  function setCompare(on) {
    E.compare = on; $('#compare').hidden = !on; $('#btn-compare').setAttribute('aria-expanded', String(on));
    $('#btn-compare').textContent = on ? 'Hide AI comparison' : 'Compare AI predictions';
    if (!on && E.src !== 'cfd') { E.src = 'cfd'; }
    if (on) start();
    sync(); draw().then(() => { if (on) $('#compare').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); });
  }

  function sync() {
    document.querySelectorAll('[data-var]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.var === E.v)));
    document.querySelectorAll('[data-look]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.look === E.look)));
    $('#ex-orient').value = E.orient;
    const l = slicesOf(E.orient); const p = $('#ex-pos'); p.max = String(l.length - 1); p.value = String(Math.min(E.idx[E.orient], l.length - 1));
    const sl = cur(); $('#ex-pos-lbl').textContent = POS_LBL[E.orient]; $('#ex-pos-out').textContent = posText(sl);
    p.setAttribute('aria-valuetext', posText(sl));
    $('#ex-arrows').checked = E.arrows;
    $('#intro').classList.toggle('done', E.started); applyShift();
    const showing = E.src === 'cfd' ? 'CFD simulation' : `${short(E.src)} prediction`;
    $('#ex-title').textContent = E.started ? `${VAR[E.v].name} · ${showing}` : '';
    document.querySelectorAll('.cmp-src button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.src === E.src)));
  }
  function writeHash() {
    if (!active) return;
    const q = new URLSearchParams({ var: E.v, look: E.look, cut: E.orient, pos: String(E.idx[E.orient]) });
    if (E.src !== 'cfd') q.set('src', E.src); if (E.compare) q.set('compare', '1'); if (!E.started) q.set('intro', '1');
    history.replaceState(null, '', `#explore?${q}`);
  }
  function readQuery(q) {
    if (VAR[q.get('var')]) E.v = q.get('var');
    if (['inside', 'exterior'].includes(q.get('look'))) { E.look = q.get('look'); E._lookChosen = true; }
    if (slicesOf(q.get('cut') || '').length) E.orient = q.get('cut');
    if (q.has('pos')) E.idx[E.orient] = Math.max(0, Math.min(slicesOf(E.orient).length - 1, +q.get('pos') || 0));
    if (SOURCES.includes(q.get('src'))) E.src = q.get('src');
    if (q.get('compare') === '1') E.compare = true;
    if (!q.has('intro') && (q.has('look') || q.has('var'))) E.started = true;
    if (E.v === 'speed') E.arrows = true;
  }

  // ---------------------------------------------------------------- 3D scene
  async function ensureViewer() {
    if (viewer) return viewer;
    if (building) return building;
    building = (async () => {
      status('Loading the bus model…');
      const { Viewer3D } = await import('./viewer3d.js');
      const v = new Viewer3D($('#stage3d'), M, { initialView: 'oblique', background: 0x0d1a33 });
      v.layers = { ...E.layers, slice: E.started && E.layers.slice };
      v.look = E.look;
      try {
        if (M.display_mesh && hasAsset(M.display_mesh.file)) v.addDisplayMesh(await rawBin(M.display_mesh.file), M.display_mesh);
        else for (const [g, meta] of Object.entries(M.geometry)) v.addGroup(g, dequantXYZ(await bin(meta.file, Int16Array)));
      } catch (e) { building = null; v.renderer.domElement.remove(); throw new Error(`could not load the bus geometry (${e.message}). Check the connection and reload the page`); }
      v.onProbe = (p) => { if (p.kind === 'slice') setProbe({ q: p.q, r: p.r }); };
      v.onRender = placeLabels;
      viewer = v; sens.exViewer = v; buildLabels(); v.setLook(E.look); applyShift(); v.resetCamera();
      status('');
      return v;
    })();
    return building;
  }

  // ---------------------------------------------------------------- labels (HTML, projected from CFD patch anchors)
  let labelEls = [];
  function buildLabels() {
    const host = $('#labels'); host.innerHTML = ''; labelEls = [];
    for (const lm of M.landmarks || []) {
      const dot = document.createElement('span'); dot.className = 'lm-dot';
      const line = document.createElement('span'); line.className = 'lm-line';
      const txt = document.createElement('span'); txt.className = 'lm-text'; txt.textContent = lm.label; txt.dataset.lm = lm.id;
      host.append(line, dot, txt); labelEls.push({ lm, dot, line, txt });
    }
  }
  function placeLabels() {
    if (!viewer) return;
    const host = $('#labels'); host.hidden = !E.labels; if (!E.labels) return;
    const W = host.clientWidth, H = host.clientHeight; const c = viewer.project(viewer.center.toArray());
    const boxes = [];
    for (const { lm, dot, line, txt } of labelEls) {
      const a = viewer.project(lm.anchor);
      const vis = a && c && a[0] > -20 && a[0] < W + 20 && a[1] > -20 && a[1] < H + 20;
      for (const el of [dot, line, txt]) el.style.display = vis ? '' : 'none';
      if (!vis) continue;
      let dx = a[0] - c[0], dy = a[1] - c[1]; const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
      const b = LABEL_BIAS[lm.id] || [0, 0]; dx += b[0]; dy += b[1]; const n2 = Math.hypot(dx, dy) || 1; dx /= n2; dy /= n2;
      const len = 46; const tw = txt.offsetWidth, th = txt.offsetHeight;
      let tx = a[0] + dx * len - (dx < -0.3 ? tw : dx > 0.3 ? 0 : tw / 2), ty = a[1] + dy * len - th / 2;
      tx = Math.max(4, Math.min(W - tw - 4, tx)); ty = Math.max(40, Math.min(H - th - 50, ty));
      for (const bx of boxes) if (tx < bx[0] + bx[2] && tx + tw > bx[0] && ty < bx[1] + bx[3] && ty + th > bx[1]) ty = dy < 0 ? bx[1] - th - 4 : bx[1] + bx[3] + 4;
      boxes.push([tx, ty, tw, th]);
      dot.style.transform = `translate(${a[0] - 4}px, ${a[1] - 4}px)`;
      txt.style.transform = `translate(${tx}px, ${ty}px)`;
      const ex = tx + tw / 2, ey = ty + th / 2; const L = Math.hypot(ex - a[0], ey - a[1]);
      line.style.width = `${Math.max(0, L - Math.min(tw, th) / 2)}px`;
      line.style.transform = `translate(${a[0]}px, ${a[1]}px) rotate(${Math.atan2(ey - a[1], ex - a[0])}rad)`;
    }
  }

  // ---------------------------------------------------------------- drawing
  // volume-balanced range (see manifest display_volume_rule); same for CFD and all models
  function range() { const v = M.variables[E.v]; return v.display_volume || v.display; }
  function applyShift() {
    if (!viewer) return; const w = $('#stage').clientWidth;
    if (E.started) viewer.setShift(0, 0); else if (w > 900) viewer.setShift(0.11, 0); else if (w < 760) viewer.setShift(0, 0.17); else viewer.setShift(0, 0);
  }
  async function draw() {
    if (!active) return;
    const my = ++token; sync(); writeHash();
    try {
      await ensureViewer();
      if (!E.started) { viewer.setLayerVisible('slice', false); viewer.setArrows(null); viewer.setProbeMarker(null); renderLegend(); renderLocation(null); sens.exRenders++; return; }
      const sl = cur();
      if (E.src !== 'cfd' && !sourceAvailable(E.src)) throw new Error(`${short(E.src)} is unavailable; no other field is substituted`);
      status(`Loading ${VAR[E.v].name.toLowerCase()}…`);
      const sd = await sliceData(sl.id); const vals = await sliceField(sl.id, E.src, E.v);
      if (my !== token) return;
      const [lo, hi] = range();
      viewer.setSlice(sl, sliceImage(sl, sd, vals, mapFor(E.v, 'cfd'), lo, hi, { transparentNoData: true }));
      viewer.setLayerVisible('slice', E.layers.slice);
      viewer.setArrows(E.arrows ? await arrows(sl, sd) : null);
      if (my !== token) return;
      sens.exLast = { sliceId: sl.id, src: E.src, v: E.v, n: vals.length, vals };
      renderLegend(); await renderLocation(sl, sd);
      if (E.compare) await renderCompare(sl, sd);
      status('');
      sens.exRenders++;
    } catch (e) { console.warn(e); status(`Error: ${e.message}`); sens.exError = e.message; sens.exRenders++; }
  }

  async function arrows(sl, sd) {
    const g = sl.grid; const comp = { x: 'u', y: 'v', z: 'w' };
    const U = await sliceField(sl.id, E.src, comp[g.u_axis]), V = await sliceField(sl.id, E.src, comp[g.v_axis]);
    const step = Math.max(4, Math.round(0.24 / g.res)); const ref = M.variables.speed.display[1] || 0.5;
    const out = []; const ax = { x: 0, y: 1, z: 2 }; const ui = ax[g.u_axis], vi = ax[g.v_axis], ni = ax[sl.axis];
    for (let r = Math.floor(step / 2); r < g.ny; r += step) for (let q = Math.floor(step / 2); q < g.nx; q += step) {
      const k = sd.index[r * g.nx + q]; if (k === 65535) continue;
      const a = U[k], b = V[k]; const m = Math.hypot(a, b); if (m < 0.02) continue;
      const L = 0.05 + 0.15 * Math.min(1, m / ref); const da = (a / m) * L, db = (b / m) * L;
      const p0 = [0, 0, 0], p1 = [0, 0, 0];
      p0[ui] = g.u0 + q * g.res - da / 2; p0[vi] = g.v0 + r * g.res - db / 2; p0[ni] = sl.value + 0.01;
      p1[ui] = p0[ui] + da; p1[vi] = p0[vi] + db; p1[ni] = p0[ni];
      out.push(...p0, ...p1);
      for (const s of [-1, 1]) {   // arrow head
        const c = Math.cos(2.6 * s), sn = Math.sin(2.6 * s); const h = 0.35 * L;
        const hx = ((a / m) * c - (b / m) * sn) * h, hy = ((a / m) * sn + (b / m) * c) * h;
        const p2 = [...p1]; p2[ui] += hx; p2[vi] += hy; out.push(...p1, ...p2);
      }
    }
    return new Float32Array(out);
  }

  function renderLegend() {
    const L = $('#ex-legend');
    if (!E.started) { L.hidden = true; return; } L.hidden = false;
    const V = VAR[E.v]; const [lo, hi] = range(); const c = document.createElement('canvas'); drawColorbar(c, mapFor(E.v, 'cfd'));
    const showing = E.src === 'cfd' ? 'CFD simulation' : `${short(E.src)} (AI prediction)`;
    L.innerHTML = `<div class="lg-title">${V.name} <span class="muted">(${V.unit})</span></div>`;
    const bar = document.createElement('div'); bar.className = 'lg-bar'; bar.append(c);
    const ticks = document.createElement('div'); ticks.className = 'lg-ticks';
    ticks.innerHTML = `<span>${lo.toFixed(V.d)}</span><span>${((lo + hi) / 2).toFixed(V.d)}</span><span>${hi.toFixed(V.d)} ${V.unit}</span>`;
    const ends = document.createElement('div'); ends.className = 'lg-ends'; ends.innerHTML = `<span>◀ ${V.lo}</span><span>${V.hi} ▶</span>`;
    const note = document.createElement('div'); note.className = 'lg-note';
    note.textContent = `${showing}. The scale covers ${E.v === 'speed' ? '95 % of the cabin air volume (from 0)' : 'the middle 96 % of the cabin air volume'}; values beyond it use the end colours.${E.arrows ? ' Arrows: flow direction in the slice (longer = faster).' : ''}`;
    L.append(bar, ticks, ends, note);
  }

  // ---------------------------------------------------------------- location readout
  function setProbe(p) { E.probe = p; renderLocation(cur()); if (E.compare) renderCompareMarkers(); }
  async function probeAt(sl, sd, p) {
    const g = sl.grid; const k = sd.index[p.r * g.nx + p.q];
    const plane = [0, 0, 0]; const ax = { x: 0, y: 1, z: 2 };
    plane[ax[g.u_axis]] = g.u0 + p.q * g.res; plane[ax[g.v_axis]] = g.v0 + p.r * g.res; plane[ax[sl.axis]] = sl.value;
    if (k === 65535) return { nodata: true, plane };
    const xyz = [sd.xyz[3 * k], sd.xyz[3 * k + 1], sd.xyz[3 * k + 2]];
    const vals = {};
    for (const s of SOURCES) if (s === 'cfd' || sourceAvailable(s)) vals[s] = { T: (await sliceField(sl.id, s, 'T'))[k], speed: (await sliceField(sl.id, s, 'speed'))[k] };
    return { plane, xyz, gid: sd.gid[k], split: sd.split[k], vals, dist: Math.hypot(xyz[0] - plane[0], xyz[1] - plane[1], xyz[2] - plane[2]) };
  }
  async function renderLocation(sl, sd) {
    const box = $('#loc-body');
    if (!sl || !E.probe) {
      if (viewer) viewer.setProbeMarker(null);
      box.innerHTML = `<p class="muted">${E.started ? 'Click inside the coloured slice to see the temperature and airflow at that spot.' : 'Press “Explore inside”, then click the coloured slice to inspect a location.'}</p>`;
      sens.exProbe = null; return;
    }
    sd = sd || await sliceData(sl.id);
    const p = await probeAt(sl, sd, E.probe); sens.exProbe = p;
    viewer.setProbeMarker(p.plane);
    if (p.nodata) {
      box.innerHTML = `<p><b>No air at this spot.</b> This point is inside a solid (seat, person or wall) or outside the cabin, so no value is shown.</p>`;
      return;
    }
    const [x, y, z] = p.plane; const s = E.src; const v = p.vals[s];
    const where = `${along(x)} · ${side(y)} · ${heightTxt(z)}`;
    const cmpRows = E.compare ? `<table class="kv loc-cmp"><tr><th>At this location</th><th>Temperature</th><th>Airflow speed</th><th>difference from CFD</th></tr>${SOURCES.map((k) => {
      if (k !== 'cfd' && !sourceAvailable(k)) return `<tr><td>${short(k)}</td><td colspan="3">unavailable</td></tr>`;
      const d = k === 'cfd' ? '—' : `${fmtS(p.vals[k].T - p.vals.cfd.T, 1)} °C · ${fmtS(p.vals[k].speed - p.vals.cfd.speed, 2)} m/s`;
      return `<tr${k === s ? ' class="sel"' : ''}><td>${short(k)}</td><td>${p.vals[k].T.toFixed(1)} °C</td><td>${p.vals[k].speed.toFixed(2)} m/s</td><td>${d}</td></tr>`;
    }).join('')}</table>` : '';
    box.innerHTML = `<div class="loc-grid">
      <div class="loc-where"><div class="k">Where</div><div class="v">${where}</div><div class="small muted">x ${x.toFixed(2)} m · y ${y.toFixed(2)} m · z ${z.toFixed(2)} m</div></div>
      <div class="loc-val"><div class="k">Temperature</div><div class="big">${v.T.toFixed(1)} <span>°C</span></div></div>
      <div class="loc-val"><div class="k">Airflow speed</div><div class="big">${v.speed.toFixed(2)} <span>m/s</span></div></div>
      <div class="loc-src"><div class="k">Source</div><div class="v">${s === 'cfd' ? 'CFD simulation (reference values)' : `${srcLabel(s)} — AI prediction`}</div>
        <div class="small"><b>Estimated at this location</b>: value of the nearest simulated cell, ${(p.dist * 100).toFixed(1)} cm from this point (no interpolation). Precomputed; not a sensor reading.</div></div>
    </div>${cmpRows}`;
  }
  const fmtS = (x, d) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}`;

  // ---------------------------------------------------------------- AI comparison panel
  const srcBox = $('#cmp-src');
  srcBox.innerHTML = '<span class="small muted">Show on the 3D slice:</span>';
  for (const s of SOURCES) {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.src = s;
    const ok = s === 'cfd' || sourceAvailable(s); b.textContent = short(s) + (ok ? '' : ' (unavailable)');
    if (!ok) { b.disabled = true; b.title = `${short(s)}: ${M.models[s].status.replace('_', ' ')}. No other model is substituted.`; }
    b.addEventListener('click', () => { if (!ok) return; E.src = s; sync(); draw(); });
    srcBox.append(b);
  }
  function testRMSE(model, v) {
    const r = MET.rows.find((x) => x.model === model && x.split === 'test' && x.region === 'interior' && x.var === v);
    return r ? r.rmse : null;
  }
  async function renderCompare(sl, sd) {
    const grid = $('#cmp-grid'); grid.innerHTML = ''; cmpPanels = [];
    const [lo, hi] = range(); const V = VAR[E.v]; const cmap = mapFor(E.v, 'cfd');
    const sel = MET.selection || {};
    for (const s of SOURCES) {
      const card = document.createElement('article'); card.className = 'cmp-card'; card.dataset.src = s;
      const ok = s === 'cfd' || sourceAvailable(s);
      const head = document.createElement('div'); head.className = 'cmp-card-head';
      head.innerHTML = `<h3>${s === 'cfd' ? 'CFD reference' : M.models[s].label}</h3><span class="st ${s === 'cfd' ? 'ref' : M.models[s].status}">${s === 'cfd' ? 'simulation' : ok ? 'AI prediction' : 'unavailable'}</span>`;
      card.append(head);
      if (!ok) {
        const p = document.createElement('p'); p.className = 'unavail'; p.textContent = `Unavailable: no predictions were exported for this model (status: ${M.models[s].status.replace('_', ' ')}). Nothing is shown in its place.`;
        card.append(p); grid.append(card); continue;
      }
      const vals = await sliceField(sl.id, s, E.v);
      const host = document.createElement('div'); card.append(host);
      const panel = new SlicePanel(host, '', (px) => setProbe(px), { target: 700, font: 17 });
      panel.setTitle(`${short(s)} · ${V.name} · ${sl.axis} = ${sl.value.toFixed(2)} m`);
      panel.h.hidden = true;
      panel.cursor = E.probe; panel.draw(sl, sliceImage(sl, sd, vals, cmap, lo, hi)); cmpPanels.push(panel);
      const note = document.createElement('p'); note.className = 'small muted';
      const e = s === 'cfd' ? null : testRMSE(s, E.v);
      note.innerHTML = s === 'cfd' ? 'The simulation itself: the reference the networks try to reproduce.'
        : `Typical error in the hidden test regions: <b>${e === null ? '—' : e.toFixed(E.v === 'T' ? 2 : 3)} ${V.unit}</b> (RMSE).`;
      if (s === 'pi') note.innerHTML += ` Physics terms used: mass conservation (continuity) and boundary conditions; momentum and energy equations are not included.${sel.pi && sel.pi.selected_is_initial ? ' Its physics training never improved validation, so the selected PI-PN checkpoint <b>is</b> the PN network: its field is identical to PN.' : ''}`;
      card.append(note); grid.append(card);
    }
    const legend = document.createElement('p'); legend.className = 'small muted cmp-scale';
    legend.textContent = `Same colour scale for all: ${lo.toFixed(V.d)} (${V.lo.toLowerCase()}) to ${hi.toFixed(V.d)} ${V.unit} (${V.hi.toLowerCase()}); grey = solid or outside the cabin. Front of the bus on the left. Click a map to inspect that location.`;
    grid.append(legend);
    await renderArtefact();
    $('#cmp-foot').innerHTML = 'RMSE = root-mean-square error on interior cells of the held-out test blocks. Error maps, all metrics, pressure and methods: <a href="#technical/results">Technical details</a>.';
  }
  function renderCompareMarkers() { for (const p of cmpPanels) { p.cursor = E.probe; p.draw(p.slice, p.img); } }

  // The PN warm-patch artefact, measured live from the stored slices (not a hard-coded claim).
  let artefact = null;
  async function renderArtefact() {
    const box = $('#cmp-artefact');
    if (!sourceAvailable('pn')) { box.hidden = true; return; }
    if (!artefact) {
      const hs = slicesOf('horizontal'); let i = 0; hs.forEach((s, j) => { if (Math.abs(s.value - 2.0) < Math.abs(hs[i].value - 2.0)) i = j; });
      const sl = hs[i]; const sd = await sliceData(sl.id); const cfd = await sliceField(sl.id, 'cfd', 'T'), pn = await sliceField(sl.id, 'pn', 'T');
      let mx = -1e9, n = 0, held = 0;
      for (let k = 0; k < cfd.length; k++) {
        const x = sd.xyz[3 * k]; if (x < 2.4 || x > 3.3) continue;
        const e = pn[k] - cfd[k]; if (e > mx) mx = e; if (e > 2) { n++; if (sd.split[k] !== 0) held++; }
      }
      artefact = { idx: i, sl, mx, n, held };
    }
    const a = artefact;
    box.hidden = false;
    box.innerHTML = `<b>Known model error, shown as is.</b> PN-DeepONet${sourceAvailable('pi') && (MET.selection?.pi?.selected_is_initial) ? ' (and therefore PI-PN)' : ''} predicts a warm patch near the ceiling about 2.4–3.3 m from the front, at z = ${a.sl.value.toFixed(2)} m, that the CFD does not show: up to ${fmtS(a.mx, 1)} °C on this slice. ${a.held} of the ${a.n} slice cells there with an error above 2 °C lie in regions hidden from training. <button type="button" class="btn small-btn" id="btn-artefact">Show this slice with PN</button>`;
    $('#btn-artefact').addEventListener('click', () => { E.orient = 'horizontal'; E.idx.horizontal = a.idx; E.v = 'T'; E.src = 'pn'; E.probe = null; sync(); draw().then(() => $('#stage').scrollIntoView({ block: 'start' })); });
  }

  return {
    show() { active = true; if (E.compare) { $('#compare').hidden = false; $('#btn-compare').setAttribute('aria-expanded', 'true'); $('#btn-compare').textContent = 'Hide AI comparison'; } draw(); },
    hide() { active = false; },
    readQuery,
    state: () => ({ ...E }),
  };
}
