// Overview: hero (the real 3D bus, illustrative exterior + CFD cabin), a 5-step guided tour that drives the
// scene, and the business story (problem, Sense -> Analyze -> Action, today vs pilot).
// Copy comes from content/story.js; every number about the cabin is filled in from the exported data.
import { HERO, TOUR, PROBLEM, FLOW, NOW_VS_PILOT, BRAND } from '../content/story.js';
import { warmestZone, zoneObs, fill, fmtDT, fmtRS } from './review.js';

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function initOverview({ explore, SC }) {
  const sens = window.__sensora;
  let step = null; let active = false;
  // ---- data for the copy (scenario facts from the USD stage; zone numbers from the CFD zone summaries)
  const sc = (SC && SC.scenario) || {};
  const D = { outdoor: sc.outdoorTemperatureC ?? '—', supply: sc.supplyTemperatureC ?? '—', occupants: sc.occupantCount ?? '—' };
  const zs = SC && SC.zones && SC.zones.defs.map((d) => zoneObs(SC, d.id, 'cfd')).filter(Boolean);
  if (zs && zs.length) {
    const T = zs.map((o) => o.T.mean), S = zs.map((o) => o.S.mean);
    Object.assign(D, { zmin: Math.min(...T).toFixed(1), zmax: Math.max(...T).toFixed(1), smin: Math.min(...S).toFixed(2), smax: Math.max(...S).toFixed(2) });
    const w = warmestZone(SC);
    Object.assign(D, { zoneId: w.id, zoneLabel: w.label, zoneT: w.T.mean.toFixed(1), zoneDT: fmtDT(w.dT), zoneDS: fmtRS(w.rS) });
  }
  sens.overviewData = D;

  // ---- static copy
  $('#hero-kicker').textContent = HERO.kicker; $('#hero-title').textContent = HERO.title; $('#hero-sub').textContent = HERO.sub;
  $('#cta-explore').textContent = `${HERO.cta1} →`; $('#cta-pilot').textContent = HERO.cta2; $('#btn-tour').textContent = `▶ ${HERO.tour}`;
  $('#hero-tag').textContent = HERO.tag; $('#core-line').textContent = BRAND.core; $('#foot-core').textContent = `${BRAND.name} — ${BRAND.core}`;
  $('#ov-problem-h').textContent = PROBLEM.title;
  $('#ov-problem').innerHTML = PROBLEM.cards.map((c) => `<article class="glass card"><h3>${esc(c.h)}</h3><p>${esc(c.p)}</p></article>`).join('');
  $('#ov-evidence').innerHTML = D.zmin ? `<b>From this demo:</b> ${esc(fill(PROBLEM.evidence, D))} <span class="muted">(CFD reference, one simulated scenario.)</span>` : '';
  $('#ov-flow').innerHTML = FLOW.map((f, i) => `<article class="glass flow-step"><div class="flow-k"><span class="n">${i + 1}</span>${esc(f.k)}</div>
      <span class="pill ${f.status}">${esc(f.statusLabel)}</span><p>${esc(f.p)}</p><p class="small muted">${esc(f.now)}</p></article>${i < FLOW.length - 1 ? '<div class="flow-arrow" aria-hidden="true">→</div>' : ''}`).join('');
  $('#ov-now').innerHTML = `<div class="glass np now"><h3><span class="pill now">Available now</span> In this demo</h3><ul>${NOW_VS_PILOT.now.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div class="glass np pilot"><h3><span class="pill planned">Planned</span> In a pilot</h3><ul>${NOW_VS_PILOT.pilot.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;

  // ---- tour
  $('#tour-steps').innerHTML = TOUR.map((t, i) => `<span data-i="${i}"></span>`).join('');
  $('#btn-tour').addEventListener('click', () => go(0));
  $('#tour-back').addEventListener('click', () => go(Math.max(0, step - 1)));
  $('#tour-next').addEventListener('click', () => (step < TOUR.length - 1 ? go(step + 1) : end(true)));
  $('#tour-skip').addEventListener('click', () => end(false));
  $('#tour-card').addEventListener('keydown', (e) => { if (e.key === 'Escape') end(false); });

  function hash() { if (active) history.replaceState(null, '', step === null ? '#overview' : `#overview?step=${step + 1}`); }
  async function go(i) {
    step = i; const t = TOUR[i];
    $('#hero-card').hidden = true; $('#tour-card').hidden = false;
    document.querySelectorAll('#tour-steps span').forEach((s, k) => s.classList.toggle('on', k <= i));
    $('#tour-count').textContent = `Step ${i + 1} of ${TOUR.length}`;
    $('#tour-h').textContent = t.title;
    $('#tour-text').textContent = fill(t.text, D);
    $('#tour-back').disabled = i === 0;
    $('#tour-next').textContent = i === TOUR.length - 1 ? 'Finish' : 'Next';
    $('#tour-extra').innerHTML = i === TOUR.length - 1
      ? '<div class="cta-row"><a class="btn primary" href="#explore">Explore the cabin yourself</a><a class="btn secondary" href="#pilot">See the pilot plan</a></div>'
      : (t.id === 'zone' && D.zoneId ? `<p class="small muted">Suggested check, from documented demo rules: ${esc(zoneObs(SC, D.zoneId, 'cfd').checks.join(' ') || 'none')} Status: illustrative workflow, requires operator review.</p>` : '');
    hash(); sens.tourStep = i + 1;
    const scene = { ...t.scene }; if (scene.zone === 'auto-warmest') scene.zone = D.zoneId || null;
    await explore.preset(scene);
    sens.tourRendered = i + 1;
  }
  async function end(finished) {
    step = null; $('#tour-card').hidden = true; $('#hero-card').hidden = false; hash(); sens.tourStep = null;
    if (!finished) { await explore.preset(TOUR[0].scene); }
    $('#btn-tour').focus({ preventScroll: true });
  }

  return {
    async show(q) {
      active = true;
      explore.mount($('#ov-slot')); $('#stage').dataset.ctx = 'overview'; explore.setShiftContext('overview');
      await explore.show('overview', { noDraw: true });
      const s = q && +q.get('step');
      if (s >= 1 && s <= TOUR.length) await go(s - 1);
      else { step = null; $('#tour-card').hidden = true; $('#hero-card').hidden = false; await explore.preset(TOUR[0].scene); }
      hash();
    },
    hide() { active = false; },
  };
}
