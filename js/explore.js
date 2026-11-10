// "Explore cabin" — the 3D bus (CFD cabin + illustrative exterior from the USD export), a coloured slice of the
// stored field, zone summaries with an illustrative operator review, a location readout, and (advanced) data
// source, slice and AI-comparison controls.  The same 3D stage is also mounted in the Overview hero / tour.
// Every value comes from data/ (stored CFD values, stored model predictions, or zone statistics derived by
// export-web); nothing is computed live except colours, arrows and the nearest-cell lookup.
import { sliceData, sliceField, bin, dequantXYZ, sourceAvailable, getScene, sceneBin } from './data.js';
import { colorOf, drawColorbar, fmt, mapFor } from './colormap.js';
import { sliceImage, SlicePanel } from './slice2d.js';
import { zoneObs, observationText, SRC_NAME, RULES, getList, addToList, removeFromList, setList } from './review.js';

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
const INSIDE = ['cutaway', 'xray', 'field'];
const LOOK_ALIAS = { inside: 'cutaway' };

export function initExplore({ M, MET }) {
  const E = { v: 'T', look: 'cutaway', insideStyle: 'cutaway', orient: 'horizontal', idx: {}, probe: null, src: 'cfd',
    labels: true, arrows: false, arrowsTouched: false, compare: false, zone: null, sensors: false, ctx: 'explore', sliceOn: true,
    layers: { body: true, floor: true, cabin_shell: true, seats: true, occupants: true, hvac: true, slice: true, arrows: true, exterior: true, zone: true, sensors: true }, saved: null };
  Object.defineProperty(E, 'started', { get: () => E.look !== 'exterior' && E.sliceOn });
  const sens = window.__sensora; sens.E = E; sens.exRenders = 0;
  { const t = document.createElement('canvas'); E.noGL = !(t.getContext('webgl2') || t.getContext('webgl')); sens.exNoGL = E.noGL;
    if (E.noGL) document.querySelector('#stage').classList.add('nogl'); }
  let viewer = null, building = null, token = 0, cmpPanels = [], active = false;

  const slicesOf = (o) => M.slices.filter((s) => s.orientation === o);
  for (const o of Object.keys(DEFAULT_POS)) {
    const l = slicesOf(o); let best = 0;
    l.forEach((s, i) => { if (Math.abs(s.value - DEFAULT_POS[o]) < Math.abs(l[best].value - DEFAULT_POS[o])) best = i; });
    E.idx[o] = best;
  }
  const cur = () => { const l = slicesOf(E.orient); return l[Math.min(E.idx[E.orient], l.length - 1)]; };
  const status = (t) => { $('#ex-status').textContent = t || ''; };
  // scene description exported from the OpenUSD stage (null -> fallback to the manifest / point clouds)
  const SC = getScene(); sens.scene = SC;
  const srcLabel = (s) => (s === 'cfd' ? 'CFD simulation (reference)' : (SC && SC.results.sources[s] ? SC.results.sources[s].label : M.models[s].label));
  // a model is shown only if its stored predictions exist AND the stage lists it as available; never substituted
  const avail = (s) => s === 'cfd' || (sourceAvailable(s) && (!SC || (SC.results.sources[s] && SC.results.sources[s].available)));
  // the variant selected in usd/layers/results.usda decides which source the 3D slice shows first (default: cfd)
  if (SC && SOURCES.includes(SC.results.authored_selection) && avail(SC.results.authored_selection)) E.src = SC.results.authored_selection;
  E.defaultSrc = E.src;
  const short = (s) => ({ cfd: 'CFD reference', vanilla: 'Vanilla DeepONet', pn: 'PN-DeepONet', pi: 'PI-PN-DeepONet' }[s]);
  const srcShort = (s) => (s === 'cfd' ? 'CFD reference' : `AI reconstruction: ${short(s)}`);
  const ZONES = SC && SC.zones ? SC.zones.defs : [];
  const SENSORS = SC && SC.proposed_sensors ? SC.proposed_sensors.filter((p) => p.visible !== false) : [];
  { // zone chips come from the USD zones (/World/Zones), not from a hard-coded list
    const zl = $('#zone-list');
    if (zl) for (const z of ZONES) { const b = document.createElement('button'); b.type = 'button'; b.className = 'zchip'; b.dataset.zone = z.id; b.textContent = z.label; b.setAttribute('aria-pressed', 'false'); zl.append(b); }
    if (zl && !ZONES.length) zl.innerHTML = '<span class="small muted">Not available in this build.</span>';
  }

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
    if (E.look === 'exterior') setLook(E.insideStyle, true); sync(); draw();
  }));
  document.querySelectorAll('[data-look]').forEach((b) => b.addEventListener('click', () => {
    setLook(b.dataset.look === 'exterior' ? 'exterior' : E.insideStyle, true); sync(); draw();
  }));
  document.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => {
    E.insideStyle = b.dataset.style; setLook(E.insideStyle, false); sync(); draw();
  }));
  document.querySelectorAll('[data-zone]').forEach((b) => b.addEventListener('click', () => {
    setZone(E.zone === b.dataset.zone ? null : b.dataset.zone, true); sync(); draw();
  }));
  document.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => { if (b.disabled || !avail(b.dataset.src)) return; E.src = b.dataset.src; sync(); draw(); }));
  $('#ex-sensors').addEventListener('change', (e) => { E.sensors = e.target.checked; applySensors(); });
  $('#ex-orient').addEventListener('change', (e) => { E.orient = e.target.value; E.probe = null; ensureInside(); sync(); draw(); });
  $('#ex-pos').addEventListener('input', (e) => { E.idx[E.orient] = +e.target.value; E.probe = null; ensureInside(); sync(); draw(); });
  $('#ex-labels').addEventListener('change', (e) => { E.labels = e.target.checked; placeLabels(); });
  $('#ex-arrows').addEventListener('change', (e) => { E.arrows = e.target.checked; E.arrowsTouched = true; draw(); });
  document.querySelectorAll('[data-exlayer]').forEach((c) => c.addEventListener('change', () => {
    E.layers[c.dataset.exlayer] = c.checked; if (viewer) viewer.setLayerVisible(c.dataset.exlayer, c.checked);
    if (c.dataset.exlayer === 'slice') { viewer && viewer.setLayerVisible('arrows', c.checked); }
  }));
  document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => {
    if (!viewer) return; viewer.setAutoRotate(false);
    if (b.dataset.cam === 'reset') viewer.setView(defaultCam(), true); else viewer.setView(b.dataset.cam, true);
    sens.exCam = b.dataset.cam;
  }));
  $('#btn-reset-view').addEventListener('click', () => { if (viewer) { viewer.setAutoRotate(false); viewer.setView(defaultCam(), true); } sens.exCam = 'reset'; });
  $('#btn-compare').addEventListener('click', () => { setCompare(!E.compare); });
  $('#btn-compare-close').addEventListener('click', () => setCompare(false));
  $('#stage3d').addEventListener('keydown', (e) => {
    const sl = cur(); const g = sl.grid; if (!E.started) return;
    const c = E.probe || { q: Math.floor(g.nx / 2), r: Math.floor(g.ny / 2) };
    const d = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, 4], ArrowDown: [0, -4] }[e.key];
    if (d) { e.preventDefault(); setProbe({ q: Math.max(0, Math.min(g.nx - 1, c.q + d[0])), r: Math.max(0, Math.min(g.ny - 1, c.r + d[1])) }); }
    else if (e.key === 'Enter') { e.preventDefault(); setProbe(c); }
  });

  const defaultCam = () => (E.look === 'exterior' ? 'reset' : 'Inside');
  function ensureInside() { if (E.look === 'exterior') setLook(E.insideStyle, true); E.sliceOn = true; }
  function start() { ensureInside(); }
  function setLook(look, moveCam) {
    look = LOOK_ALIAS[look] || look; const was = E.look; E.look = look; if (INSIDE.includes(look)) E.insideStyle = look;
    if (viewer) { viewer.setLook(look); if (moveCam && (was === 'exterior') !== (look === 'exterior')) { viewer.setAutoRotate(false); viewer.setView(look === 'exterior' ? 'reset' : 'Inside', true); } }
  }
  function setZone(id, frame) {
    E.zone = ZONES.some((z) => z.id === id) ? id : null; const z = ZONES.find((d) => d.id === E.zone);
    if (viewer) {
      viewer.setZone(z ? z.bounds_min : null, z ? z.bounds_max : null);
      if (z && frame) { viewer.setAutoRotate(false); if (E.look === 'exterior') setLook(E.insideStyle, false); viewer.frameBox(z.bounds_min, z.bounds_max, true, 1.15); }
    }
    buildLabels(); renderZone();
  }
  function applySensors() { if (viewer) viewer.setSensors(E.sensors ? SENSORS.map((p) => p.position) : null); buildLabels(); const c = $('#ex-sensors'); if (c) c.checked = E.sensors; }
  function setCompare(on) {
    E.compare = on; $('#compare').hidden = !on; $('#btn-compare').setAttribute('aria-expanded', String(on));
    $('#btn-compare').textContent = on ? 'Hide AI comparison' : 'Compare AI reconstructions';
    if (!on && E.src !== E.defaultSrc) { E.src = E.defaultSrc; }
    if (on) start();
    syncSaved(); sync(); draw().then(() => { if (on) $('#compare').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); });
  }

  function sync() {
    document.querySelectorAll('[data-var]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.var === E.v)));
    document.querySelectorAll('[data-look]').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.look === 'exterior') === (E.look === 'exterior'))));
    document.querySelectorAll('[data-style]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.style === E.look)));
    $('#style-row').hidden = E.look === 'exterior';
    document.querySelectorAll('[data-zone]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.zone === E.zone)));
    document.querySelectorAll('[data-src]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.src === E.src)));
    $('#src-chip').textContent = srcShort(E.src); $('#src-chip').classList.toggle('ai', E.src !== 'cfd');
    $('#ex-orient').value = E.orient;
    const l = slicesOf(E.orient); const p = $('#ex-pos'); p.max = String(l.length - 1); p.value = String(Math.min(E.idx[E.orient], l.length - 1));
    const sl = cur(); $('#ex-pos-lbl').textContent = POS_LBL[E.orient]; $('#ex-pos-out').textContent = posText(sl);
    p.setAttribute('aria-valuetext', posText(sl));
    $('#ex-arrows').checked = E.arrows;
    applyShift();
    $('#ex-title').textContent = E.started ? `${VAR[E.v].name} · ${srcShort(E.src)}` : '';
    document.querySelectorAll('.cmp-src button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.cmpsrc === E.src)));
  }
  function writeHash() {
    if (!active || E.ctx !== 'explore') return;
    const q = new URLSearchParams({ var: E.v, look: E.look, cut: E.orient, pos: String(E.idx[E.orient]) });
    if (E.src !== E.defaultSrc) q.set('src', E.src); if (E.compare) q.set('compare', '1');
    if (E.saved) q.set('saved', E.saved); if (E.zone) q.set('zone', E.zone); if (E.sensors) q.set('sensors', '1');
    history.replaceState(null, '', `#explore?${q}`);
  }
  function readQuery(q) {
    if (VAR[q.get('var')]) E.v = q.get('var');
    const lk = LOOK_ALIAS[q.get('look')] || q.get('look');
    if (lk === 'exterior' || INSIDE.includes(lk)) { E.look = lk; if (INSIDE.includes(lk)) E.insideStyle = lk; E._queryLook = true; }
    if (ZONES.some((z) => z.id === q.get('zone'))) E.zone = q.get('zone');
    if (q.get('sensors') === '1') { E.sensors = true; E._querySensors = true; }
    if (slicesOf(q.get('cut') || '').length) E.orient = q.get('cut');
    if (q.has('pos')) E.idx[E.orient] = Math.max(0, Math.min(slicesOf(E.orient).length - 1, +q.get('pos') || 0));
    if (SOURCES.includes(q.get('src'))) E.src = q.get('src');
    if (q.get('compare') === '1') E.compare = true;
    if (q.get('saved') && SC && SC.probes.some((p) => p.id === q.get('saved'))) E.saved = q.get('saved');
    if (E.v === 'speed') E.arrows = true;
  }

  // ---------------------------------------------------------------- 3D scene
  async function ensureViewer() {
    if (viewer) return viewer;
    if (building) return building;
    building = (async () => {
      status('Loading the bus model…');
      const t = document.createElement('canvas');
      if (!(t.getContext('webgl2') || t.getContext('webgl'))) {
        E.noGL = true; sens.exNoGL = true; $('#stage').classList.add('nogl');
        throw new Error('the 3D view needs WebGL, which is turned off or unavailable in this browser. The slice maps under "Compare AI predictions" and the Technical details still work');
      }
      const { Viewer3D } = await import('./viewer3d.js');
      const v = new Viewer3D($('#stage3d'), M, { initialView: 'oblique', background: 0x0c1830 });
      v.layers = { ...E.layers, slice: E.started && E.layers.slice };
      v.look = E.look;
      try {
        if (SC) {
          v.setCameras(SC.cameras, SC.default_camera);
          v.addSceneGeometry(await sceneBin(SC.geometry.file), SC);
          // USD visibility sets the DEFAULT of each toggle: a group hidden in the presentation layer starts unchecked
          for (const layer of ['body', 'seats', 'occupants', 'hvac', 'exterior']) {
            const ms = v.meshes.filter((m) => m.userData.layer === layer);
            if (ms.length && ms.every((m) => m.userData.usdHidden)) {
              ms.forEach((m) => { m.userData.usdHidden = false; }); E.layers[layer] = false; v.layers[layer] = false;
              const c = document.querySelector(`[data-exlayer="${layer}"]`); if (c) c.checked = false;
            }
          }
        } else for (const [g, meta] of Object.entries(M.geometry)) v.addGroup(g, dequantXYZ(await bin(meta.file, Int16Array)));
      } catch (e) { building = null; v.renderer.domElement.remove(); throw new Error(`could not load the bus geometry (${e.message}). Check the connection and reload the page`); }
      v.onProbe = (p) => { if (p.kind === 'slice') { E.saved = null; syncSaved(); setProbe({ q: p.q, r: p.r }); } };
      v.onRender = placeLabels;
      v.onUserStop = () => { sens.autoRotateStoppedByUser = true; };
      viewer = v; sens.exViewer = v; v.setLook(E.look); applyShift();
      v.setView(E.ctx === 'overview' || E.look === 'exterior' ? 'reset' : 'Inside', false);
      if (E.zone) setZone(E.zone, false); applySensors(); buildLabels();
      status('');
      return v;
    })();
    return building;
  }

  // ---------------------------------------------------------------- labels (HTML, projected from CFD patch anchors)
  let labelEls = [];
  function buildLabels() {
    const host = $('#labels'); host.innerHTML = ''; labelEls = [];
    const items = (SC ? SC.labels.filter((l) => l.visible) : (M.landmarks || [])).map((l) => ({ ...l }));
    const z = ZONES.find((d) => d.id === E.zone);
    if (z) items.push({ id: `zone_${z.id}`, label: z.label, anchor: [(z.bounds_min[0] + z.bounds_max[0]) / 2, 0, z.bounds_max[2]], cls: 'zone' });
    if (E.sensors) for (const p of SENSORS) items.push({ id: `sensor_${p.id}`, label: 'Proposed sensor location', anchor: p.position, cls: 'sensor' });
    for (const lm of items) {
      const dot = document.createElement('span'); dot.className = 'lm-dot';
      const line = document.createElement('span'); line.className = 'lm-line';
      const txt = document.createElement('span'); txt.className = `lm-text${lm.cls ? ` ${lm.cls}` : ''}`; txt.textContent = lm.label; txt.dataset.lm = lm.id;
      host.append(line, dot, txt); labelEls.push({ lm, dot, line, txt });
    }
  }
  function placeLabels() {
    if (!viewer) return;
    const host = $('#labels'); const any = E.labels || E.zone || E.sensors; host.hidden = !any; if (!any) return;
    const W = host.clientWidth, H = host.clientHeight; const c = viewer.project(viewer.center.toArray());
    const boxes = [];
    for (const { lm, dot, line, txt } of labelEls) {
      const a = (E.labels || lm.cls) ? viewer.project(lm.anchor) : null;
      const vis = !!a && c && a[0] > -20 && a[0] < W + 20 && a[1] > -20 && a[1] < H + 20;
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
    viewer.distScale = E.ctx === 'overview' && w > 900 ? 1.42 : 1;
    if (E.ctx !== 'overview' || w <= 900) viewer.setShift(0, 0); else viewer.setShift(0.15, 0.02);
  }
  async function draw() {
    if (!active) return;
    const my = ++token; sync(); writeHash();
    if (E.noGL) { renderZone(); status('3D view unavailable: WebGL is turned off in this browser. Use “Compare AI predictions” for slice maps.'); if (E.compare && E.started) { const sl = cur(); await renderCompare(sl, await sliceData(sl.id)); } sens.exRenders++; return; }
    try {
      await ensureViewer();
      renderZone();
      if (!E.started) { viewer.setLayerVisible('slice', false); viewer.setArrows(null); viewer.setProbeMarker(null); renderLegend(); renderLocation(null); status(''); sens.exRenders++; return; }
      const sl = cur();
      if (E.src !== 'cfd' && !avail(E.src)) throw new Error(`${short(E.src)} is unavailable; no other field is substituted`);
      status(`Loading ${VAR[E.v].name.toLowerCase()}…`);
      const sd = await sliceData(sl.id); const vals = await sliceField(sl.id, E.src, E.v);
      if (my !== token) return;
      const [lo, hi] = range();
      viewer.setSlice(sl, sliceImage(sl, sd, vals, mapFor(E.v, 'cfd'), lo, hi, { transparentNoData: true }));
      viewer.setLayerVisible('slice', E.layers.slice);
      viewer.setArrows(E.arrows ? await arrows(sl, sd) : null);
      if (my !== token) return;
      sens.exLast = { sliceId: sl.id, src: E.src, v: E.v, n: vals.length, vals };
      renderLegend(); if (E.saved && SC) renderSaved(); else await renderLocation(sl, sd);
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
    const showing = srcShort(E.src);
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
  function setProbe(p) { E.probe = p; E.saved = null; syncSaved(); renderLocation(cur()); if (E.compare) renderCompareMarkers(); }
  async function probeAt(sl, sd, p) {
    const g = sl.grid; const k = sd.index[p.r * g.nx + p.q];
    const plane = [0, 0, 0]; const ax = { x: 0, y: 1, z: 2 };
    plane[ax[g.u_axis]] = g.u0 + p.q * g.res; plane[ax[g.v_axis]] = g.v0 + p.r * g.res; plane[ax[sl.axis]] = sl.value;
    if (k === 65535) return { nodata: true, plane };
    const xyz = [sd.xyz[3 * k], sd.xyz[3 * k + 1], sd.xyz[3 * k + 2]];
    const vals = {};
    for (const s of SOURCES) if (s === 'cfd' || avail(s)) vals[s] = { T: (await sliceField(sl.id, s, 'T'))[k], speed: (await sliceField(sl.id, s, 'speed'))[k] };
    return { plane, xyz, gid: sd.gid[k], split: sd.split[k], vals, dist: Math.hypot(xyz[0] - plane[0], xyz[1] - plane[1], xyz[2] - plane[2]) };
  }
  async function renderLocation(sl, sd) {
    const box = $('#loc-body');
    if (!sl || !E.probe) {
      if (viewer) viewer.setProbeMarker(null);
      if (E.noGL) { box.innerHTML = '<p class="muted">The 3D view is unavailable in this browser. Open “Compare AI predictions” and click a slice map to inspect a location.</p>'; sens.exProbe = null; return; }
      box.innerHTML = `<p class="muted">${E.started ? 'Click inside the coloured slice to see the temperature and airflow at that spot.' : 'Choose “Look inside”, then click the coloured slice to inspect a location.'}</p>`;
      sens.exProbe = null; return;
    }
    sd = sd || await sliceData(sl.id);
    const p = await probeAt(sl, sd, E.probe); sens.exProbe = p;
    if (viewer) viewer.setProbeMarker(p.plane);
    if (p.nodata) {
      box.innerHTML = `<p><b>No air at this spot.</b> This point is inside a solid (seat, person or wall) or outside the cabin, so no value is shown.</p>`;
      return;
    }
    const [x, y, z] = p.plane; const s = E.src; const v = p.vals[s];
    const where = `${along(x)} · ${side(y)} · ${heightTxt(z)}`;
    const cmpRows = E.compare ? `<table class="kv loc-cmp"><tr><th>At this location</th><th>Temperature</th><th>Airflow speed</th><th>difference from CFD</th></tr>${SOURCES.map((k) => {
      if (k !== 'cfd' && !avail(k)) return `<tr><td>${short(k)}</td><td colspan="3">unavailable</td></tr>`;
      const d = k === 'cfd' ? '—' : `${fmtS(p.vals[k].T - p.vals.cfd.T, 1)} °C · ${fmtS(p.vals[k].speed - p.vals.cfd.speed, 2)} m/s`;
      return `<tr${k === s ? ' class="sel"' : ''}><td>${short(k)}</td><td>${p.vals[k].T.toFixed(1)} °C</td><td>${p.vals[k].speed.toFixed(2)} m/s</td><td>${d}</td></tr>`;
    }).join('')}</table>` : '';
    box.innerHTML = `<div class="loc-grid">
      <div class="loc-where"><div class="k">Where</div><div class="v">${where}</div><div class="small muted">x ${x.toFixed(2)} m · y ${y.toFixed(2)} m · z ${z.toFixed(2)} m</div></div>
      <div class="loc-val"><div class="k">Temperature</div><div class="big">${v.T.toFixed(1)} <span>°C</span></div></div>
      <div class="loc-val"><div class="k">Airflow speed</div><div class="big">${v.speed.toFixed(2)} <span>m/s</span></div></div>
      <div class="loc-src"><div class="k">Source</div><div class="v">${SRC_NAME[s]}</div>
        <div class="small"><b>Estimated at this location</b>: value of the nearest simulated cell, ${(p.dist * 100).toFixed(1)} cm from this point (no interpolation). Precomputed; not a sensor reading.</div></div>
    </div>${cmpRows}`;
  }
  const fmtS = (x, d) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}`;

  // ---------------------------------------------------------------- scenario card + saved locations (from the stage)
  if (SC) {
    const sc = SC.scenario;
    for (const el of document.querySelectorAll('[data-scn]')) { const v = sc[el.dataset.scn]; if (v !== null && v !== undefined) el.textContent = String(Math.round(v * 10) / 10); }
    const sol = document.querySelector('[data-scn-li="solarLoadIncluded"]'); if (sol) sol.hidden = !sc.solarLoadIncluded;
    const probes = SC.probes.filter((p) => p.visible !== false);
    if (probes.length) {
      $('#saved-wrap').hidden = false;
      for (const p of probes) {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.probe = p.id; b.textContent = p.label; b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => { E.saved = p.id; E.probe = null; ensureInside(); syncSaved(); draw(); });
        $('#saved-list').append(b);
      }
    }
  }
  function syncSaved() { document.querySelectorAll('#saved-list button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.probe === E.saved))); }
  function renderSaved() {
    const p = SC.probes.find((x) => x.id === E.saved); const box = $('#loc-body'); sens.exSaved = p;
    if (viewer) viewer.setProbeMarker(p.position);
    const [x, y, z] = p.position;
    const head = `<div class="loc-where"><div class="k">Saved location</div><div class="v">${p.label}</div><div class="small muted">${along(x)} · ${side(y)} · ${heightTxt(z)} · x ${x.toFixed(2)} m · y ${y.toFixed(2)} m · z ${z.toFixed(2)} m</div></div>`;
    if (!p.valid) { box.innerHTML = `<div class="loc-grid">${head}<div class="loc-src"><div class="k">Value</div><div class="v">Unavailable</div><div class="small">${p.reason || 'no simulated air cell near this point'}. No value is shown.</div></div></div>`; return; }
    const s = E.src; const v = p.values[s];
    const cmpRows = E.compare ? `<table class="kv loc-cmp"><tr><th>At this location</th><th>Temperature</th><th>Airflow speed</th><th>difference from CFD</th></tr>${SOURCES.map((k) => {
      if (!p.values[k] || !avail(k)) return `<tr><td>${short(k)}</td><td colspan="3">unavailable</td></tr>`;
      const d = k === 'cfd' ? '—' : `${fmtS(p.values[k].T - p.values.cfd.T, 1)} °C · ${fmtS(p.values[k].speed - p.values.cfd.speed, 2)} m/s`;
      return `<tr${k === s ? ' class="sel"' : ''}><td>${short(k)}</td><td>${p.values[k].T.toFixed(1)} °C</td><td>${p.values[k].speed.toFixed(2)} m/s</td><td>${d}</td></tr>`;
    }).join('')}</table>` : '';
    box.innerHTML = `<div class="loc-grid">${head}
      <div class="loc-val"><div class="k">Temperature</div><div class="big">${v ? v.T.toFixed(1) : '—'} <span>°C</span></div></div>
      <div class="loc-val"><div class="k">Airflow speed</div><div class="big">${v ? v.speed.toFixed(2) : '—'} <span>m/s</span></div></div>
      <div class="loc-src"><div class="k">Source</div><div class="v">${SRC_NAME[s]}</div>
        <div class="small"><b>Estimated at this location</b>: value of the nearest simulated cell, ${(p.distance_m * 100).toFixed(1)} cm from this point (no interpolation). Precomputed; not a sensor reading.</div></div>
    </div>${cmpRows}`;
  }

  // ---------------------------------------------------------------- AI comparison panel
  const srcBox = $('#cmp-src');
  srcBox.innerHTML = '<span class="small muted">Show on the 3D slice:</span>';
  for (const s of SOURCES) {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.cmpsrc = s;
    const ok = s === 'cfd' || avail(s); b.textContent = short(s) + (ok ? '' : ' (unavailable)');
    if (!ok) { b.disabled = true; b.title = `${short(s)}: ${M.models[s].status.replace('_', ' ')}. No other model is substituted.`; }
    b.addEventListener('click', () => { if (!ok) return; E.src = s; sync(); draw(); });
    srcBox.append(b);
  }
  // advanced source selector (same semantics as the comparison panel's)
  for (const b of document.querySelectorAll('#adv-src [data-src]')) {
    const s = b.dataset.src; const ok = s === 'cfd' || avail(s);
    if (!ok) { b.disabled = true; b.textContent += ' (unavailable)'; b.title = `${short(s)}: ${M.models[s].status.replace('_', ' ')}. No other model is substituted.`; }
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
      const ok = s === 'cfd' || avail(s);
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
    if (!avail('pn')) { box.hidden = true; return; }
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
    box.innerHTML = `<b>Known model error, shown as is.</b> PN-DeepONet${avail('pi') && (MET.selection?.pi?.selected_is_initial) ? ' (and therefore PI-PN)' : ''} predicts a warm patch near the ceiling about 2.4–3.3 m from the front, at z = ${a.sl.value.toFixed(2)} m, that the CFD does not show: up to ${fmtS(a.mx, 1)} °C on this slice. ${a.held} of the ${a.n} slice cells there with an error above 2 °C lie in regions hidden from training. <button type="button" class="btn small-btn" id="btn-artefact">Show this slice with PN</button>`;
    $('#btn-artefact').addEventListener('click', () => { E.orient = 'horizontal'; E.idx.horizontal = a.idx; E.v = 'T'; E.src = 'pn'; E.probe = null; ensureInside(); sync(); draw().then(() => $('#stage').scrollIntoView({ block: 'start' })); });
  }

  // ---------------------------------------------------------------- zone review (illustrative operator workflow)
  function renderZone() {
    const box = $('#zone-body'); if (!box) return;
    const list = getList(); renderList(list);
    if (!ZONES.length) { box.innerHTML = '<p class="muted">Zone summaries are not available in this build.</p>'; return; }
    if (!E.zone) { box.innerHTML = '<p class="muted">Choose a zone (Driver area, Front, Middle or Rear) to see its summary and a suggested check.</p>'; sens.exZone = null; return; }
    const o = zoneObs(SC, E.zone, E.src); sens.exZone = o;
    if (!o) { box.innerHTML = `<p class="muted">No zone summary for ${srcShort(E.src)}.</p>`; return; }
    const ai = E.src !== 'cfd';
    const checks = o.checks.length ? o.checks : [RULES.checks.none];
    const inList = list.some((x) => x.zone === o.id && x.src === E.src);
    box.innerHTML = `<div class="zr-head"><h3>${o.label}</h3><span class="pill illus">${RULES.status}</span></div>
      <p class="zr-src">Data: <b>${SRC_NAME[E.src]}</b>${ai ? '' : ' · one simulated scenario'}</p>
      <div class="zr-grid">
        <div><div class="k">Observation</div><p>${observationText(o)}</p>
          <p class="small muted">80 % of this zone lies between ${o.T.p10.toFixed(1)} and ${o.T.p90.toFixed(1)} °C. Summary over ${o.n.toLocaleString('en-US')} samples (one per 8 cm cube of cabin air).</p>
          ${ai && o.vsCfd ? `<p class="callout small">AI reconstruction: compare with the CFD reference before acting. In this zone it differs from the CFD by ${o.vsCfd.T.mean_abs_diff.toFixed(2)} °C and ${o.vsCfd.speed.mean_abs_diff.toFixed(2)} m/s on average (absolute difference).</p>` : ''}</div>
        <div><div class="k">Suggested check</div><ul class="checks">${checks.map((c) => `<li>${c}</li>`).join('')}</ul>
          <details class="small"><summary>How these suggestions are made</summary><p>${RULES.explain} Zone limits: ${o.rule}.</p></details></div>
      </div>
      <div class="zr-actions"><button type="button" class="btn" id="btn-add-review" ${inList ? 'disabled' : ''}>${inList ? 'Added to demo review list' : 'Add to demo review list'}</button>
        <span class="small muted">${RULES.listNote}</span></div>`;
    $('#btn-add-review').addEventListener('click', () => {
      addToList({ zone: o.id, label: o.label, src: E.src, srcName: SRC_NAME[E.src], obs: observationText(o), checks, at: new Date().toISOString().slice(11, 16) });
      renderZone();
    });
  }
  function renderList(list) {
    const host = $('#review-list'); if (!host) return;
    host.hidden = !list.length;
    host.innerHTML = list.length ? `<div class="rl-head"><b>Demo review list</b> <span class="small muted">(${list.length}; this browser tab only)</span> <button type="button" class="btn ghost small-btn" id="rl-clear">Clear</button></div>
      <ol>${list.map((x, i) => `<li><b>${x.label}</b> · <span class="muted">${x.srcName}</span><br>${x.checks.join(' ')} <button type="button" class="btn ghost small-btn" data-rl="${i}" aria-label="Remove ${x.label} from the review list">Remove</button></li>`).join('')}</ol>` : '';
    host.querySelectorAll('[data-rl]').forEach((b) => b.addEventListener('click', () => { removeFromList(+b.dataset.rl); renderZone(); }));
    const c = host.querySelector('#rl-clear'); if (c) c.addEventListener('click', () => { setList([]); renderZone(); });
  }

  return {
    show(ctx = 'explore', opts = {}) {
      const from = E.ctx; active = true; E.ctx = ctx; applyShift();
      if (opts.noDraw) return Promise.resolve();   // the caller (Overview) applies a preset, which draws
      // arriving from the Overview without an explicit view in the URL: open the cabin with the field visible
      if (ctx === 'explore' && from === 'overview' && !E._queryLook) {
        E.insideStyle = 'cutaway'; E.look = 'cutaway'; E.sliceOn = true; E.labels = true; E.sensors = !!E._querySensors; E.src = E.defaultSrc;
        const lc = $('#ex-labels'); if (lc) lc.checked = true;
        if (viewer) { viewer.setLook(E.look); viewer.setAutoRotate(false); applySensors(); setZone(E.zone, false); viewer.setView('Inside', true); }
      }
      E._queryLook = false; E._querySensors = false;
      if (ctx === 'explore' && E.compare) { $('#compare').hidden = false; $('#btn-compare').setAttribute('aria-expanded', 'true'); $('#btn-compare').textContent = 'Hide AI comparison'; }
      if (viewer && ctx === 'explore') viewer.setAutoRotate(false);
      return draw();
    },
    hide() { active = false; if (viewer) viewer.setAutoRotate(false); },
    readQuery,
    state: () => ({ ...E, started: E.started }),
    mount(slot) { const st = $('#stage'); if (st.parentElement !== slot) slot.append(st); applyShift(); if (viewer) { viewer.resize(); placeLabels(); } },
    // drive the scene from the guided tour (camera from the USD stage, mode, layers, selection)
    async preset(p) {
      E.v = p.variable || E.v; E.sliceOn = !!p.slice; E.labels = p.labels !== false; E.sensors = !!p.sensors; E.probe = null; E.saved = null;
      if (E.src !== E.defaultSrc) E.src = E.defaultSrc;
      E.look = LOOK_ALIAS[p.look] || p.look; if (INSIDE.includes(E.look)) E.insideStyle = E.look;
      const lc = $('#ex-labels'); if (lc) lc.checked = E.labels;
      if (!E.noGL) {
        try { await ensureViewer(); } catch (e) { console.warn(e); status(`Error: ${e.message}`); sens.exError = e.message; sens.exRenders++; return; }
        viewer.setLook(E.look); applySensors();
        viewer.setAutoRotate(!!p.rotate && !sens.autoRotateStoppedByUser);
        if (p.zone) { setZone(p.zone, false); const z = ZONES.find((d) => d.id === p.zone); viewer.setView(p.camera || 'Inside', true); if (z) setTimeout(() => viewer.frameBox(z.bounds_min, z.bounds_max, true, E.ctx === "overview" ? 2.3 : 1.3), 950); }
        else { setZone(null, false); viewer.setView(p.camera === 'Default' ? 'reset' : (p.camera || 'reset'), true); }
      } else { E.zone = p.zone || null; }
      return draw();
    },
    setShiftContext(ctx) { E.ctx = ctx; applyShift(); },
    viewer: () => viewer,
    zones: ZONES,
  };
}
