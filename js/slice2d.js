// 2D slice rendering on <canvas>: pixel = nearest CFD cell (no interpolation); no-data pixels are drawn
// in a neutral colour (or transparent for 3D textures).
import { colorOf, NODATA } from './colormap.js';

export function sliceImage(slice, sd, values, cmap, lo, hi, opts = {}) {
  const { nx, ny } = slice.grid;
  const c = document.createElement('canvas'); c.width = nx; c.height = ny;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(nx, ny); const d = img.data;
  const rgb = [0, 0, 0];
  for (let r = 0; r < ny; r++) {
    const srcRow = ny - 1 - r; // v axis up
    for (let q = 0; q < nx; q++) {
      const k = sd.index[srcRow * nx + q]; const o = 4 * (r * nx + q);
      if (k === 65535) {
        if (opts.transparentNoData) { d[o + 3] = 0; } else { d[o] = NODATA[0]; d[o + 1] = NODATA[1]; d[o + 2] = NODATA[2]; d[o + 3] = 255; }
        continue;
      }
      if (opts.splitView) {
        const s = sd.split[k];
        const col = s === 1 ? [34, 211, 238] : s === 2 ? [251, 146, 60] : s === 3 ? [40, 48, 66] : [110, 124, 148];
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255; continue;
      }
      colorOf(cmap, lo, hi, values[k], rgb);
      let a = 255;
      if (opts.markSplit && (sd.split[k] === 1 || sd.split[k] === 2)) {
        // tint held-out blocks: blend toward cyan (val) / orange (test)
        const t = sd.split[k] === 1 ? [34, 211, 238] : [251, 146, 60];
        if ((q + r) % 4 === 0) { rgb[0] = t[0]; rgb[1] = t[1]; rgb[2] = t[2]; }
      }
      d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const AX = { x: 'x [m] (rearward)', y: 'y [m] (doors at +y)', z: 'z [m] (up)' };

export class SlicePanel {
  constructor(host, title, onProbe, opts = {}) {
    this.target = opts.target || 1100; this.fpx = opts.font || 12;
    this.cell = document.createElement('div'); this.cell.className = 'cell';
    const h = document.createElement('h4'); h.textContent = title; this.h = h;
    this.canvas = document.createElement('canvas'); this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.cell.append(h, this.canvas); host.append(this.cell);
    this.onProbe = onProbe; const f = this.fpx / 12; this.m = { l: Math.round(46 * f), r: 10, t: 8, b: Math.round(34 * f) };
    this.canvas.addEventListener('click', (e) => this._click(e));
    this.canvas.addEventListener('keydown', (e) => this._key(e));
    this.cursor = null;
  }
  setTitle(t) { this.h.textContent = t; this.canvas.setAttribute('aria-label', t); }
  draw(slice, img, opts = {}) {
    this.slice = slice; this.img = img;
    const { nx, ny } = slice.grid; const s = Math.max(2, Math.floor(this.target / nx));
    const W = nx * s + this.m.l + this.m.r, H = ny * s + this.m.t + this.m.b;
    const c = this.canvas; c.width = W; c.height = H; this.s = s;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a1222'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, this.m.l, this.m.t, nx * s, ny * s);
    this._axes(ctx, slice, s);
    if (opts.arrows) this._arrows(ctx, slice, s, opts.arrows);
    if (this.cursor) this._marker(ctx);
  }
  _axes(ctx, slice, s) {
    const g = slice.grid; const { l, t } = this.m; const W = g.nx * s, H = g.ny * s;
    ctx.strokeStyle = 'rgba(200,220,240,.5)'; ctx.fillStyle = '#93a6bf'; ctx.font = `${this.fpx}px Inter, system-ui, sans-serif`; ctx.lineWidth = 1;
    ctx.strokeRect(l + .5, t + .5, W, H);
    const u1 = g.u0 + (g.nx - 1) * g.res, v1 = g.v0 + (g.ny - 1) * g.res;
    const step = (span) => (span > 4 ? 1 : 0.5);
    ctx.textAlign = 'center';
    for (let u = Math.ceil(g.u0 / step(u1 - g.u0)) * step(u1 - g.u0); u <= u1; u += step(u1 - g.u0)) {
      const X = l + ((u - g.u0) / g.res + 0.5) * s; ctx.beginPath(); ctx.moveTo(X, t + H); ctx.lineTo(X, t + H + 4); ctx.stroke(); ctx.fillText(u.toFixed(1), X, t + H + 4 + this.fpx);
    }
    ctx.fillText(AX[g.u_axis], l + W / 2, t + H + 6 + 2 * this.fpx);
    ctx.textAlign = 'right';
    for (let v = Math.ceil(g.v0 / 0.5) * 0.5; v <= v1; v += 0.5) {
      const Y = t + H - ((v - g.v0) / g.res + 0.5) * s; ctx.beginPath(); ctx.moveTo(l - 4, Y); ctx.lineTo(l, Y); ctx.stroke(); ctx.fillText(v.toFixed(1), l - 6, Y + 4);
    }
    ctx.save(); ctx.translate(this.fpx, t + H / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(AX[g.v_axis], 0, 0); ctx.restore();
  }
  _arrows(ctx, slice, s, { sd, U, V, scale }) {
    const g = slice.grid; const every = Math.max(4, Math.round(10 / (s / 2)));
    ctx.strokeStyle = 'rgba(235,245,255,.85)'; ctx.lineWidth = 1;
    for (let r = Math.floor(every / 2); r < g.ny; r += every) for (let q = Math.floor(every / 2); q < g.nx; q += every) {
      const k = sd.index[r * g.nx + q]; if (k === 65535) continue;
      const a = U[k], b = V[k]; const m = Math.hypot(a, b); if (m < 1e-3) continue;
      const L = Math.min(every * s * 0.9, (m / scale) * every * s);
      const X = this.m.l + (q + .5) * s, Y = this.m.t + (g.ny - 1 - r + .5) * s;
      const dx = (a / m) * L, dy = -(b / m) * L;
      ctx.beginPath(); ctx.moveTo(X - dx / 2, Y - dy / 2); ctx.lineTo(X + dx / 2, Y + dy / 2); ctx.stroke();
      const ang = Math.atan2(dy, dx); ctx.beginPath(); ctx.moveTo(X + dx / 2, Y + dy / 2);
      ctx.lineTo(X + dx / 2 - 4 * Math.cos(ang - .5), Y + dy / 2 - 4 * Math.sin(ang - .5)); ctx.moveTo(X + dx / 2, Y + dy / 2);
      ctx.lineTo(X + dx / 2 - 4 * Math.cos(ang + .5), Y + dy / 2 - 4 * Math.sin(ang + .5)); ctx.stroke();
    }
  }
  _marker(ctx) {
    const { q, r } = this.cursor; const s = this.s; const g = this.slice.grid;
    const X = this.m.l + (q + .5) * s, Y = this.m.t + (g.ny - 1 - r + .5) * s;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X, Y, 7, 0, 2 * Math.PI); ctx.stroke();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X, Y, 9, 0, 2 * Math.PI); ctx.stroke();
  }
  pixelToPlane(q, r) { const g = this.slice.grid; return [g.u0 + q * g.res, g.v0 + r * g.res]; }
  _click(e) {
    if (!this.slice) return;
    const rect = this.canvas.getBoundingClientRect(); const kx = this.canvas.width / rect.width;
    const X = (e.clientX - rect.left) * kx - this.m.l, Y = (e.clientY - rect.top) * kx - this.m.t;
    const g = this.slice.grid; const q = Math.floor(X / this.s), rr = Math.floor(Y / this.s);
    if (q < 0 || rr < 0 || q >= g.nx || rr >= g.ny) return;
    this.onProbe({ q, r: g.ny - 1 - rr });
  }
  _key(e) { // keyboard probing: arrows move, Enter probes centre
    if (!this.slice) return; const g = this.slice.grid;
    const c = this.cursor || { q: Math.floor(g.nx / 2), r: Math.floor(g.ny / 2) };
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (d) { e.preventDefault(); this.onProbe({ q: Math.max(0, Math.min(g.nx - 1, c.q + d[0] * 2)), r: Math.max(0, Math.min(g.ny - 1, c.r + d[1] * 2)) }); }
    else if (e.key === 'Enter') { e.preventDefault(); this.onProbe(c); }
  }
}
