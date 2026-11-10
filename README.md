# Sensora · Cabin insight for bus operators (demo)

Simulation-backed demonstration: temperature and airflow inside **one** simulated bus cabin (steady RANS CFD,
STAR-CCM+), precomputed AI reconstructions (Vanilla DeepONet, PN-DeepONet, PI-PN-DeepONet), zone summaries,
an illustrative operator-review workflow and a planned pilot. The bus exterior is an illustration generated
around the simulated cabin; it is not manufacturer CAD.

* Live page: https://mancupfire.github.io/sensora-bus-digital-twin/
* No backend, no live inference: every value is precomputed and stored under `data/` (quantised, subsampled).
* Not included: raw CFD tables, model checkpoints, the supplied CAD view and solver renders.
* One scenario only: the demo does not predict other HVAC settings.

Built from the Sensora Bus Digital Twin project, asset version 20261110155159. Data and predictions belong to the
project's data owner; do not reuse without permission.
