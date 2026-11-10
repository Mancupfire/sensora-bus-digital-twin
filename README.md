# Sensora · Explore the Bus Cabin

Static demo: temperature and airflow inside **one** simulated bus cabin (steady RANS CFD, STAR-CCM+),
plus precomputed predictions of three neural surrogates (Vanilla DeepONet, PN-DeepONet, PI-PN-DeepONet).

* Live page: https://mancupfire.github.io/sensora-bus-digital-twin/
* No backend, no live inference: every value is precomputed and stored under `data/` (quantised, subsampled).
* Not included: raw CFD tables, model checkpoints, the supplied CAD view and solver renders.
* One scenario only: the demo does not predict other HVAC settings.

Built from the Sensora Bus Digital Twin project, asset version 20261110141614. Data and predictions belong to the
project's data owner; do not reuse without permission.
