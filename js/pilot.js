// Pilot plan page (planned work only; no results exist, so no achieved values are shown).
import { PILOT } from '../content/story.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => `USD ${n.toLocaleString('en-US')}`;

export function renderPilot(host) {
  const P = PILOT; const B = P.budget;
  host.innerHTML = `
  <p class="kicker">Planned · not yet carried out</p>
  <h1>${esc(P.title)}</h1>
  <p class="lead">${esc(P.intro)}</p>
  <div class="principle" aria-label="Pilot principle">${P.principle.map((x, i) => `<span class="pp">${esc(x)}</span>${i < P.principle.length - 1 ? '<span class="pp-arrow" aria-hidden="true">→</span>' : ''}`).join('')}</div>
  <h2>Four phases over 12 months</h2>
  <div class="phases">${P.phases.map((p, i) => `<article class="glass phase"><div class="when">${esc(p.when)}</div><h3><span class="n">${i + 1}</span>${esc(p.h)}</h3><p>${esc(p.p)}</p><p class="ms">Milestone: <b>${esc(p.milestone)}</b></p></article>`).join('')}</div>
  <h2>How success would be measured</h2>
  <div class="glass table-wrap"><table class="metrics measures"><tr><th>Proposed measure</th><th>How it would be measured</th><th>Result</th></tr>
    ${P.measures.map((m) => `<tr><td>${esc(m.m)}</td><td>${esc(m.how)}</td><td><span class="pill planned">To be measured in the pilot</span></td></tr>`).join('')}</table></div>
  <p class="note">${esc(P.measuresNote)}</p>
  <div class="two-col pilot-two">
    <div><h2>What a pilot needs from an operator</h2><ul class="ticks">${P.needs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div><h2>Safeguards</h2><dl class="safeguards">${P.safeguards.map((s) => `<dt>${esc(s.h)}</dt><dd>${esc(s.p)}</dd>`).join('')}</dl></div>
  </div>
  <details class="glass budget" id="pilot-budget"><summary><b>${esc(B.title)}</b></summary>
    <table class="metrics"><tr><th>Item</th><th>Estimate</th></tr>${B.items.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${usd(v)}</td></tr>`).join('')}
      <tr class="tot"><td>Total (estimate, incl. development labour)</td><td>${usd(B.total)}</td></tr></table>
    <ul class="small">${B.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></details>
  <div class="cta-band glass" id="pilot-cta"><div><h3>${esc(P.cta.h)}</h3><p>${esc(P.cta.p)}</p></div>
    <div class="cta-row"><a class="btn primary" href="${P.cta.pdf}" download id="pilot-pdf">Download the pilot outline (PDF)</a><a class="btn secondary" href="${P.cta.html}" target="_blank" rel="noopener">Printable version</a><a class="btn ghost" href="#explore">Explore the cabin</a></div></div>`;
}
