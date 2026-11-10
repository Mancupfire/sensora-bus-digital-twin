// Asset loading: base-aware relative URLs, version-busted, lazily fetched and cached in memory.
// No backend and no API: every URL resolves under ./data/ next to index.html.
const cache = new Map();
let manifest = null;
let metrics = null;
export const net = { requests: [] };

// files exported from the USD stage are versioned by their own sha256 (from data/usd/web_manifest.json): the
// scene can change while the scientific asset_version stays the same, and stale caches must not mix versions
let usdVer = {};
export function assetURL(rel) {
  const v = usdVer[rel] ? `?v=${usdVer[rel]}` : manifest ? `?v=${encodeURIComponent(manifest.asset_version)}` : `?t=${Date.now()}`;
  return new URL(`data/${rel}${v}`, document.baseURI).toString();
}

async function fetchChecked(url, kind) {
  net.requests.push(url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return kind === 'json' ? r.json() : r.arrayBuffer();
}

let scene = null;
export async function loadManifest() {
  manifest = await fetchChecked(new URL('data/manifest.json', document.baseURI) + `?t=${Date.now()}`, 'json');
  metrics = await fetchChecked(assetURL('metrics.json'), 'json');
  try {
    const wm = await fetchChecked(new URL('data/usd/web_manifest.json', document.baseURI) + `?t=${Date.now()}`, 'json');
    usdVer = Object.fromEntries(Object.entries(wm.files).map(([f, m]) => [`usd/${f}`, m.sha256.slice(0, 16)]));
  } catch (e) { console.warn('usd/web_manifest.json not loaded:', e.message); usdVer = {}; }
  // scene description exported from the OpenUSD stage (optional: the app falls back to point clouds without it)
  if (manifest.scene) {
    try { scene = await fetchChecked(assetURL(manifest.scene.file), 'json'); } catch (e) { console.warn('scene.json not loaded:', e.message); scene = null; }
  }
  return { manifest, metrics, scene };
}
export const getScene = () => scene;
// a file listed in the USD web export (data/usd/...), fetched once
export async function sceneBin(rel) {
  if (!cache.has(rel)) cache.set(rel, fetchChecked(assetURL(rel), 'bin'));
  return cache.get(rel);
}
export const getManifest = () => manifest;
export const getMetrics = () => metrics;

export async function bin(rel, Type) {
  if (!manifest.files[rel]) throw new Error(`asset not in manifest: ${rel}`);
  if (!cache.has(rel)) cache.set(rel, fetchChecked(assetURL(rel), 'bin').then((b) => new Type(b)));
  return cache.get(rel);
}

// raw ArrayBuffer (e.g. the packed display mesh)
export async function rawBin(rel) {
  if (!manifest.files[rel]) throw new Error(`asset not in manifest: ${rel}`);
  if (!cache.has(rel)) cache.set(rel, fetchChecked(assetURL(rel), 'bin'));
  return cache.get(rel);
}
export function hasAsset(rel) { return !!(manifest && manifest.files[rel]); }

export function dequant(u16, v) {
  const [lo, hi] = manifest.variables[v].quant;
  const out = new Float32Array(u16.length);
  const s = (hi - lo) / 65534;
  for (let i = 0; i < u16.length; i++) out[i] = lo + u16[i] * s;
  return out;
}

export async function sliceData(sliceId) {
  const index = await bin(`slices/${sliceId}/index.bin`, Uint16Array);
  const buf = await bin(`slices/${sliceId}/cells.bin`, Uint8Array);
  const n = buf.byteLength / 17;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const xyz = new Float32Array(n * 3), gid = new Uint32Array(n), split = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 17;
    xyz[3 * i] = dv.getFloat32(o, true); xyz[3 * i + 1] = dv.getFloat32(o + 4, true); xyz[3 * i + 2] = dv.getFloat32(o + 8, true);
    gid[i] = dv.getUint32(o + 12, true); split[i] = dv.getUint8(o + 16);
  }
  return { index, xyz, gid, split, n };
}

const fieldCache = new Map();
export async function sliceField(sliceId, src, v) {
  const key = `${sliceId}/${src}/${v}`;
  if (!fieldCache.has(key)) fieldCache.set(key, bin(`slices/${sliceId}/${src}_${v}.bin`, Uint16Array).then((q) => dequant(q, v)));
  return fieldCache.get(key);
}
export async function cloudField(src, v) {
  const key = `cloud/${src}/${v}`;
  if (!fieldCache.has(key)) fieldCache.set(key, bin(`cloud/${src}_${v}.bin`, Uint16Array).then((q) => dequant(q, v)));
  return fieldCache.get(key);
}

export function dequantXYZ(i16) {
  const { lo, hi } = manifest.bbox;
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) { const a = i % 3; out[i] = lo[a] + (i16[i] / 32767) * (hi[a] - lo[a]); }
  return out;
}

// Model availability: never substitute another model's data for an unavailable one.
export function sourceAvailable(src) {
  if (src === 'cfd') return true;
  return manifest.models[src] && manifest.models[src].status === 'available' && manifest.sources_exported.includes(src);
}
