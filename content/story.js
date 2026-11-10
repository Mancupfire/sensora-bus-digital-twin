// Business / product copy of the Sensora demo (MARKETING CONTENT).
// Scene content (geometry, materials, cameras, labels, scenario facts, zones, proposed sensor positions) comes
// from the OpenUSD export (data/usd/scene.json), never from this file.  Every claim here is listed in
// reports/CLAIMS_MATRIX.md with its source and maturity (available now / planned / illustrative).
// Numbers about the simulated cabin are NOT written here: they are filled in from the exported data.

export const BRAND = {
  name: 'Sensora',
  core: 'Turning invisible cabin conditions into actionable insight.',
};

export const HERO = {
  kicker: 'Cabin insight for bus operators',
  title: 'Understand your cabin. Make better-informed HVAC decisions.',
  sub: 'See how temperature and airflow vary across a bus cabin, zone by zone.',
  tag: 'Simulation-backed demonstration',
  tagDetail: 'This demo shows one simulated scenario of a city-bus cabin (a CFD simulation) and AI reconstructions computed in advance. It is not live data from a vehicle, and no sensors are installed yet.',
  cta1: 'Explore the cabin',
  cta2: 'See the pilot approach',
  tour: 'Take the 1-minute tour',
};

// Guided tour. Each step drives the real 3D scene (camera from the USD stage, render mode, layers, selection).
// {placeholders} are filled from the exported scenario facts and the CFD zone summaries.
export const TOUR = [
  { id: 'bus', title: 'See the bus',
    text: 'A city bus on a hot, sunny day: {outdoor} °C outside, air conditioning supplying {supply} °C air, {occupants} people on board. The cabin comes from the simulation; the body around it is an illustration so the bus is easy to recognise.',
    scene: { camera: 'Default', look: 'exterior', labels: true, slice: false, sensors: false, zone: null, rotate: true } },
  { id: 'inside', title: 'Look inside',
    text: 'Take the roof off to see the seats, the people and the air vents along the ceiling. Everything inside is the simulated cabin.',
    scene: { camera: 'Inside', look: 'cutaway', labels: true, slice: false, sensors: false, zone: null } },
  { id: 'field', title: 'Temperature and airflow',
    text: 'Colours show the simulated temperature at seated head height (blue cooler, red warmer). Conditions are not the same everywhere: in this scenario the zone averages range from {zmin} °C to {zmax} °C.',
    scene: { camera: 'Inside', look: 'field', labels: false, slice: true, variable: 'T', sensors: false, zone: null } },
  { id: 'zone', title: 'Review a zone',
    text: 'Sensora summarises each zone. {zoneLabel}: {zoneT} °C on average, {zoneDT} the cabin average; air moves {zoneDS} the average. A suggested check appears for the operator to review. Nothing is changed automatically.',
    scene: { camera: 'Inside', look: 'cutaway', labels: false, slice: true, variable: 'T', sensors: false, zone: 'auto-warmest' } },
  { id: 'pilot', title: 'From demo to pilot',
    text: 'In a pilot, sensors at proposed locations (one per zone, shown in green) would measure the cabin on real trips. Alerts are reviewed by staff first; HVAC control would come only later, with separate approval.',
    scene: { camera: 'Default', look: 'xray', labels: false, slice: false, sensors: true, zone: null } },
];

export const PROBLEM = {
  title: 'The problem',
  cards: [
    { h: 'Conditions differ from seat to seat', p: 'Sun through the glass, open doors, passengers and the vent layout make some parts of a bus warmer than others, and the air does not move the same way everywhere.' },
    { h: 'One thermostat cannot see every zone', p: 'A single temperature reading, or a few, cannot describe the driver area, the doors and the rear at the same time.' },
    { h: 'Operators need zone-level information', p: 'To decide on HVAC settings and maintenance, operators need to know where the cabin differs, not just one average.' },
  ],
  evidence: 'In the simulated scenario of this demo, zone averages range from {zmin} to {zmax} °C, and average air speed from {smin} to {smax} m/s.',
};

// SENSE -> ANALYZE -> ACTION with an explicit maturity label on each step
export const FLOW = [
  { k: 'Sense', status: 'planned', statusLabel: 'Planned for the pilot',
    p: 'Sensors on board measure the cabin during real trips.',
    now: 'In this demo, a CFD simulation of one scenario stands in for measurements. No sensor readings are shown.' },
  { k: 'Analyze', status: 'now', statusLabel: 'Shown in this demo',
    p: 'Turn sparse information into a zone-by-zone picture of temperature and airflow.',
    now: 'Explore the simulated cabin, its zones, and AI reconstructions compared with the CFD reference.' },
  { k: 'Action', status: 'illustrative', statusLabel: 'Illustrative workflow',
    p: 'Suggest checks for staff to review before anything changes on the bus.',
    now: 'A demo review list shows the workflow. It stays in your browser; nothing is sent to a vehicle.' },
];

export const NOW_VS_PILOT = {
  now: ['One simulated scenario of a city-bus cabin (CFD)', 'Precomputed AI reconstructions, compared with the CFD reference',
    'Zone summaries and a click-to-inspect location readout', 'An illustrative operator review workflow'],
  pilot: ['Sensors on 3 buses, measuring on real trips', 'Monitoring dashboard for the operator',
    'Alerts and advice reviewed by staff', 'Evaluation of comfort, exposure, operations and energy'],
};

// Operator review: documented DEMO rules (not validated thresholds, not control logic).
// Applied to the selected data source; deviations are relative to the cabin average of the same source.
export const REVIEW_RULES = {
  version: 'demo-rules/1',
  tempNoticeC: 0.5,          // |zone mean - cabin mean| at or above this is called out
  speedNoticeFrac: 0.20,     // |zone mean / cabin mean - 1| at or above this is called out
  checks: {
    warmer: 'Review how cooled supply air reaches this zone (vent output and direction).',
    cooler: 'Check whether this zone is cooler than intended compared with the rest of the cabin.',
    slower: 'Review airflow distribution in this zone.',
    faster: 'Check for draughts near vents or doors in this zone.',
    none: 'No check suggested by the demo rules for this zone.',
  },
  explain: 'Demo rules: a zone is called warmer or cooler when its average differs from the cabin average by at least 0.5 °C, and its airflow slower or faster when the average air speed differs by at least 20 %. These rules only illustrate the workflow. They are not validated thresholds, comfort criteria or control logic.',
  status: 'Illustrative workflow · requires operator review',
  listNote: 'The review list stays in this browser tab. Nothing is sent to a vehicle, an HVAC system or a ticketing system.',
};

export const PILOT = {
  title: 'Pilot approach',
  intro: 'A proposed 12-month pilot on 3 buses. It is planned, not yet carried out: the steps and measures below describe what the pilot would do and how success would be judged.',
  principle: ['Monitor first', 'Human-reviewed alerts', 'HVAC control only with separate approval'],
  phases: [
    { when: 'Months 1–3', h: 'Build and test', p: 'Sensor nodes and a monitoring dashboard; check readings and fix problems.', milestone: 'Prototype ready' },
    { when: 'Months 4–6', h: 'Test on buses', p: 'Install on 3 buses; record trips and feedback.', milestone: 'Pilot dataset' },
    { when: 'Months 7–9', h: 'Test useful alerts', p: 'Create alerts and advice; test them with bus staff, who review every suggestion.', milestone: 'Alerts tested' },
    { when: 'Months 10–12', h: 'Evaluate and plan', p: 'Review results and costs; plan larger fleet tests.', milestone: 'Rollout decision' },
  ],
  measures: [
    { m: 'Sensor uptime and coverage', how: 'Share of trip time with valid readings, per zone' },
    { m: 'Zone temperature differences', how: 'Measured differences between driver, front, middle and rear zones' },
    { m: 'Staff response time', how: 'Time from an alert to a staff review or action, from the review log' },
    { m: 'Passenger feedback', how: 'Short, accessible surveys on matched trips' },
    { m: 'HVAC energy per route-km', how: 'Only if energy metering is available on the pilot buses' },
    { m: 'Air-quality exceedance time', how: 'Only once air-quality sensors and a threshold protocol are agreed' },
  ],
  measuresNote: 'These are proposed success measures. No results exist yet, so no values are shown.',
  needs: ['Three buses and permission to install removable equipment', 'Installation windows outside service hours',
    'Access to trip schedules and, if available, HVAC and energy data', 'Bus staff willing to review alerts and give feedback'],
  safeguards: [
    { h: 'Passenger privacy', p: 'Aggregated occupancy only; no personal identification.' },
    { h: 'Vehicle safety', p: 'No automatic HVAC control in the pilot; any later intervention keeps manual override.' },
    { h: 'Measurement quality', p: 'Calibration, audit trails and documented thresholds before any claim about air quality or comfort.' },
    { h: 'Service disruption', p: 'Removable equipment, installed off duty.' },
  ],
  budget: {
    title: 'Illustrative cost estimate (not a price quote)',
    total: 11628, currency: 'USD',
    items: [['Equipment and calibration', 2293], ['Cloud, visits and surveys', 2158], ['Development labour (estimated)', 5660], ['Contingency', 1517]],
    cash: 5968,
    notes: ['From the team\'s draft pilot plan for 3 buses over 12 months; includes estimated development labour.',
      'Potential cash need is about USD 5,968 if the development labour (USD 5,660) is provided in kind.',
      'An estimate for discussion only: it will change with the operator\'s requirements, and it is not an offer or a return-on-investment claim.'],
  },
  cta: { h: 'Discuss a pilot', p: 'Download the pilot outline to share with your team, or explore the cabin first.', pdf: 'downloads/sensora-pilot-outline.pdf', html: 'pilot-outline.html' },
};

export const ABOUT_DEMO = [
  ['Simulated', 'One steady CFD simulation of a city-bus cabin: 7 people, sun, 35 °C outside, 18 °C supply air.'],
  ['Precomputed', 'AI reconstructions (three neural networks) computed in advance from part of that simulation. Nothing is predicted live.'],
  ['Illustrative', 'The exterior body, wheels and mirrors are an illustration so the bus is recognisable; cabin fields come from the CFD dataset. The operator review list and the proposed sensor locations are illustrative too.'],
  ['Planned', 'Sensors on buses, monitoring, staff-reviewed alerts and their evaluation are planned for a pilot. They are not part of this demo.'],
];
