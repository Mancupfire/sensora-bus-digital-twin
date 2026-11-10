// Small canvas charts (no external libs). Colours: CFD = white, models = categorical palette.
import { fmt } from './colormap.js';
export const SERIES = { cfd: '#e6eef8', vanilla: '#a78bfa', pn: '#22d3ee', pi: '#fb923c',
  baseline_idw8_train: '#94a3b8', baseline_train_mean: '#64748b' };
export const LABEL = { cfd: 'CFD', vanilla: 'Vanilla', pn: 'PN', pi: 'PI-PN', baseline_idw8_train: 'IDW-8 (train pts)', baseline_train_mean: 'Train mean' };

function frame(c) {
  const ctx = c.getContext('2d'); const W = c.width, H = c.height; ctx.clearRect(0, 0, W, H);
  ctx.font = '13px Inter, system-ui, sans-serif'; ctx.fillStyle = '#93a6bf'; ctx.strokeStyle = 'rgba(147,166,191,.35)';
  return { ctx, W, H, m: { l: 58, r: 12, t: 28, b: 32 } };
}
function niceTicks(lo, hi, n = 4) { const s = (hi - lo) / n || 1; return Array.from({ length: n + 1 }, (_, i) => lo + i * s); }

export function lineChart(c, xs, series, xlabel, ylabel) {
  const { ctx, W, H, m } = frame(c);
  const all = series.flatMap((s) => s.y.filter((v) => v !== null && Number.isFinite(v)));
  if (!xs.length || !all.length) { ctx.fillText('Probe a slice to see a profile.', m.l, H / 2); return; }
  let lo = Math.min(...all), hi = Math.max(...all); if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const X = (x) => m.l + ((x - x0) / (x1 - x0 || 1)) * (W - m.l - m.r), Y = (y) => H - m.b - ((y - lo) / (hi - lo)) * (H - m.t - m.b);
  for (const t of niceTicks(lo, hi)) { ctx.beginPath(); ctx.moveTo(m.l, Y(t)); ctx.lineTo(W - m.r, Y(t)); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(fmt(t), m.l - 4, Y(t) + 4); }
  ctx.textAlign = 'center'; ctx.fillText(xlabel, (W + m.l) / 2, H - 6);
  ctx.textAlign = 'left'; ctx.fillText(ylabel, m.l, 17);
  let lx = m.l + 120;
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.5; ctx.beginPath(); let pen = false;
    s.y.forEach((v, i) => { if (v === null || !Number.isFinite(v)) { pen = false; return; } if (!pen) { ctx.moveTo(X(xs[i]), Y(v)); pen = true; } else ctx.lineTo(X(xs[i]), Y(v)); });
    ctx.stroke(); ctx.fillStyle = s.color; ctx.fillText(s.label, lx, 17); lx += ctx.measureText(s.label).width + 14;
  }
  ctx.lineWidth = 1;
}

export function barChart(c, groups, keys, values, ylabel) { // values[g][k]
  const { ctx, W, H, m } = frame(c);
  const all = groups.flatMap((g) => keys.map((k) => values[g]?.[k])).filter((v) => Number.isFinite(v));
  if (!all.length) { ctx.fillText('No metrics.', m.l, H / 2); return; }
  const hi = Math.max(...all) * 1.1; const Y = (y) => H - m.b - (y / hi) * (H - m.t - m.b);
  for (const t of niceTicks(0, hi)) { ctx.strokeStyle = 'rgba(147,166,191,.25)'; ctx.beginPath(); ctx.moveTo(m.l, Y(t)); ctx.lineTo(W - m.r, Y(t)); ctx.stroke(); ctx.fillStyle = '#93a6bf'; ctx.textAlign = 'right'; ctx.fillText(fmt(t, 2), m.l - 4, Y(t) + 4); }
  const gw = (W - m.l - m.r) / groups.length, bw = Math.min(16, (gw - 8) / keys.length);
  groups.forEach((g, gi) => {
    keys.forEach((k, ki) => {
      const v = values[g]?.[k]; if (!Number.isFinite(v)) return;
      const x = m.l + gi * gw + (gw - bw * keys.length) / 2 + ki * bw;
      ctx.fillStyle = SERIES[k] || '#888'; ctx.fillRect(x, Y(v), bw - 2, H - m.b - Y(v));
    });
    ctx.fillStyle = '#93a6bf'; ctx.textAlign = 'center'; ctx.fillText(g, m.l + gi * gw + gw / 2, H - 8);
  });
  ctx.textAlign = 'left'; ctx.fillText(ylabel, m.l, 17); let lx = m.l + 150;
  for (const k of keys) { ctx.fillStyle = SERIES[k]; ctx.fillText(LABEL[k], lx, 17); lx += ctx.measureText(LABEL[k]).width + 10; }
}

export function histogram(c, data, lo, hi, color, xlabel, nb = 40) {
  const { ctx, W, H, m } = frame(c);
  if (!data || !data.length) { ctx.fillText('Select a model (not CFD) to see slice errors.', m.l, H / 2); return; }
  const cnt = new Float64Array(nb);
  for (const v of data) { let b = Math.floor(((v - lo) / (hi - lo)) * nb); b = b < 0 ? 0 : b >= nb ? nb - 1 : b; cnt[b]++; }
  const mx = Math.max(...cnt); const bw = (W - m.l - m.r) / nb;
  ctx.fillStyle = color; cnt.forEach((n, i) => { const h = (n / mx) * (H - m.t - m.b); ctx.fillRect(m.l + i * bw, H - m.b - h, bw - 1, h); });
  ctx.fillStyle = '#93a6bf'; ctx.textAlign = 'left'; ctx.fillText(fmt(lo), m.l, H - 8); ctx.textAlign = 'right'; ctx.fillText(`≥ ${fmt(hi)}`, W - m.r, H - 8);
  ctx.textAlign = 'center'; ctx.fillText(xlabel, (W + m.l) / 2, H - 8); ctx.textAlign = 'left'; ctx.fillText('cells (slice)', m.l, 17);
}

// Learning curves: each series has its own x (steps). Optional `mark` index draws a ring (selected step).
export function curveChart(c, series, xlabel, ylabel) {
  const { ctx, W, H, m } = frame(c); m.t = 56;
  const xs = series.flatMap((s) => s.x), ys = series.flatMap((s) => s.y.filter((v) => v !== null && Number.isFinite(v)));
  if (!xs.length || !ys.length) { ctx.fillText('No curve data.', m.l, H / 2); return; }
  const x0 = Math.min(...xs), x1 = Math.max(...xs); let lo = Math.min(...ys), hi = Math.max(...ys);
  const logy = hi / Math.max(lo, 1e-9) > 8; const f = (v) => (logy ? Math.log10(v) : v);
  const L0 = f(lo) - 0.03 * (f(hi) - f(lo)), L1 = f(hi) + 0.03 * (f(hi) - f(lo));
  const X = (x) => m.l + ((x - x0) / (x1 - x0 || 1)) * (W - m.l - m.r), Y = (y) => H - m.b - ((f(y) - L0) / (L1 - L0)) * (H - m.t - m.b);
  const ticks = logy ? Array.from({ length: 5 }, (_, i) => 10 ** (L0 + (i / 4) * (L1 - L0))) : niceTicks(lo, hi);
  for (const t of ticks) { ctx.strokeStyle = 'rgba(147,166,191,.25)'; ctx.beginPath(); ctx.moveTo(m.l, Y(t)); ctx.lineTo(W - m.r, Y(t)); ctx.stroke(); ctx.fillStyle = '#93a6bf'; ctx.textAlign = 'right'; ctx.fillText(fmt(t, 3), m.l - 4, Y(t) + 4); }
  ctx.textAlign = 'center'; ctx.fillText(xlabel, (W + m.l) / 2, H - 6);
  ctx.textAlign = 'left'; ctx.fillText(`${ylabel}${logy ? ' (log scale)' : ''}`, m.l, 16);
  let lx = m.l, ly = 40;
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.5; ctx.setLineDash(s.dash ? [5, 4] : []); ctx.beginPath(); let pen = false;
    s.y.forEach((v, i) => { if (v === null || !Number.isFinite(v)) { pen = false; return; } const px = X(s.x[i]), py = Y(v); if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py); });
    ctx.stroke(); ctx.setLineDash([]);
    if (s.mark !== null && s.mark !== undefined && Number.isFinite(s.y[s.mark])) { ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(s.x[s.mark]), Y(s.y[s.mark]), 6, 0, 2 * Math.PI); ctx.stroke(); }
    const w = ctx.measureText(s.label).width + 30; if (lx + w > W - m.r) { lx = m.l; ly += 16; }
    ctx.fillStyle = s.color; ctx.fillRect(lx, ly - 8, 14, 3); ctx.fillText(s.label, lx + 18, ly - 2); lx += w;
  }
  ctx.lineWidth = 1;
}
