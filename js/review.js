// Zone summaries + the illustrative operator review workflow.
// Numbers come from scene.zones.summary (computed by export-web from the USD payloads; voxel-weighted).
// Rules come from content/story.js (REVIEW_RULES): documented demo rules, not validated thresholds.
import { REVIEW_RULES as R } from '../content/story.js';

export const SRC_NAME = { cfd: 'CFD reference (simulation)', vanilla: 'AI reconstruction: Vanilla DeepONet', pn: 'AI reconstruction: PN-DeepONet', pi: 'AI reconstruction: PI-PN-DeepONet' };

export function zoneObs(SC, zoneId, src) {
  const Z = SC && SC.zones; if (!Z || !Z.summary) return null;
  const def = Z.defs.find((d) => d.id === zoneId); const z = Z.summary.zones[zoneId]; const cab = Z.summary.cabin;
  if (!def || !z || !z[src] || !cab[src]) return null;
  const T = z[src].T, S = z[src].speed, cT = cab[src].T.mean, cS = cab[src].speed.mean;
  const dT = T.mean - cT, rS = S.mean / cS - 1;
  const checks = [];
  if (dT >= R.tempNoticeC) checks.push(R.checks.warmer); else if (dT <= -R.tempNoticeC) checks.push(R.checks.cooler);
  if (rS <= -R.speedNoticeFrac) checks.push(R.checks.slower); else if (rS >= R.speedNoticeFrac) checks.push(R.checks.faster);
  return { id: zoneId, label: def.label, rule: def.rule, n: z.n, T, S, cT, cS, dT, rS, checks, vsCfd: z[src].vs_cfd || null, heldOut: z.held_out_share };
}

// the tour's "review a zone" step: the zone whose CFD average differs most (warmer) from the cabin average
export function warmestZone(SC) {
  const Z = SC && SC.zones; if (!Z || !Z.summary) return null;
  let best = null;
  for (const d of Z.defs) { const o = zoneObs(SC, d.id, 'cfd'); if (o && (!best || o.dT > best.dT)) best = o; }
  return best;
}

export const fmtDT = (d) => (Math.abs(d) < 0.05 ? 'about the same as' : `${Math.abs(d).toFixed(1)} °C ${d > 0 ? 'warmer than' : 'cooler than'}`);
export const fmtRS = (r) => (Math.abs(r) < 0.02 ? 'at about the same speed as' : `${Math.round(Math.abs(r) * 100)} % ${r > 0 ? 'faster than' : 'slower than'}`);

export function fill(t, data) { return t.replace(/\{(\w+)\}/g, (m, k) => (data[k] !== undefined ? data[k] : m)); }

export function observationText(o) {
  return `Average ${o.T.mean.toFixed(1)} °C, ${fmtDT(o.dT)} the cabin average (${o.cT.toFixed(1)} °C). Air moves at ${o.S.mean.toFixed(2)} m/s on average, ${fmtRS(o.rS)} the cabin average (${o.cS.toFixed(2)} m/s).`;
}

// ---- demo review list (sessionStorage only)
const KEY = 'sensora.demoReviewList';
export function getList() { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; } }
export function setList(l) { try { sessionStorage.setItem(KEY, JSON.stringify(l)); } catch { /* storage unavailable: list lives in memory only */ } }
export function addToList(item) { const l = getList(); if (!l.some((x) => x.zone === item.zone && x.src === item.src)) l.push(item); setList(l); return l; }
export function removeFromList(i) { const l = getList(); l.splice(i, 1); setList(l); return l; }

export { R as RULES };
