// Perceptual colour maps as 256-entry LUTs built from control points (approximations of
// inferno / mako / viridis / magma and a blue-white-red diverging map).
const CP = {
  thermal: ['#000004', '#320a5e', '#781b6c', '#bb3654', '#ec6824', '#fbb41a', '#fcffa4'],
  airflow: ['#0b0405', '#2e1e3c', '#38568f', '#357ba3', '#3aa4ae', '#68cfaf', '#def5e5'],
  viridis: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'],
  magma: ['#000004', '#2c115f', '#721f81', '#b73779', '#f1605d', '#feb078', '#fcfdbf'],
  // main view: blue = cooler, red = warmer (ColorBrewer RdYlBu, reversed); speed: dark = slower, bright = faster
  temp: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'],
  speed: ['#0d1b3e', '#1d3f73', '#21688f', '#22918f', '#47b47a', '#9bd25c', '#f2e64b'],
  cividis: ['#00204c', '#31446b', '#666970', '#958f78', '#cbba69', '#ffe945'],
  diverging: ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b'],
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const LUT = {};
for (const [k, pts] of Object.entries(CP)) {
  const c = pts.map(hex), lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (c.length - 1), j = Math.min(Math.floor(t), c.length - 2), f = t - j;
    for (let a = 0; a < 3; a++) lut[3 * i + a] = Math.round(c[j][a] + (c[j + 1][a] - c[j][a]) * f);
  }
  LUT[k] = lut;
}
export const NODATA = [29, 38, 56];
// Register a LUT sampled from a solver render's own colour bar (array of [r,g,b]).
export function registerLUT(name, colors) {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (colors.length - 1), j = Math.min(Math.floor(t), colors.length - 2), f = t - j;
    for (let a = 0; a < 3; a++) lut[3 * i + a] = Math.round(colors[j][a] + (colors[j + 1][a] - colors[j][a]) * f);
  }
  LUT[name] = lut;
}
export function mapFor(variable, display) {
  if (display === 'abs') return 'magma';
  if (display === 'signed') return 'diverging';
  if (variable === 'T') return 'temp';
  if (variable === 'speed') return 'speed';
  if (variable === 'p') return 'cividis';
  return 'diverging'; // velocity components (signed)
}
export function rangeFor(meta, variable, display) {
  const v = meta.variables[variable];
  if (display === 'abs') return v.abs_error_display;
  if (display === 'signed') return v.signed_error_display;
  if (['u', 'v', 'w'].includes(variable)) { const m = Math.max(Math.abs(v.display[0]), Math.abs(v.display[1])); return [-m, m]; }
  return v.display;
}
export function colorOf(name, lo, hi, x, out, o = 0) {
  const lut = LUT[name];
  let t = (x - lo) / (hi - lo); t = t < 0 ? 0 : t > 1 ? 1 : t;
  const i = Math.round(t * 255) * 3;
  out[o] = lut[i]; out[o + 1] = lut[i + 1]; out[o + 2] = lut[i + 2];
}
export function drawColorbar(canvas, name) {
  const ctx = canvas.getContext('2d'); const w = canvas.width = 256; canvas.height = 1;
  const img = ctx.createImageData(w, 1); const lut = LUT[name];
  for (let i = 0; i < w; i++) { img.data[4 * i] = lut[3 * i]; img.data[4 * i + 1] = lut[3 * i + 1]; img.data[4 * i + 2] = lut[3 * i + 2]; img.data[4 * i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
}
export const fmt = (x, d = 3) => (x === null || x === undefined || Number.isNaN(x)) ? '—' : Math.abs(x) >= 100 ? x.toFixed(1) : Number(x.toPrecision(d)).toString();
