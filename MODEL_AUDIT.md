# Model Audit Notes

## Implemented Corrections

- One shared calculation module lives in `src/shared/model.ts`.
- Every stored readiness calculation, including lazy GET calculation, invokes
  the same publish hook; route choice cannot create hub history gaps.
- Backend session creation and recomputation call the shared module and persist calculation traces.
- Inputs use explicit units: meters, seconds, seconds per 100 m, seconds per km, watts, kilograms.
- Athlete profile values are preferred over defaults.
- Defaults produce warnings and lower confidence where profile or calibration data is missing.
- Carryover fatigue increases cost and adds readiness penalty; it is not treated as an adaptation benefit.
- Coefficient sets are versioned and can be global or athlete-specific.

## Confidence Levels

- `estimated-default`: default constants or missing profile data are materially involved.
- `partially-calibrated`: a reviewed model is active, but some athlete-specific data is missing.
- `fully-calibrated`: active coefficients and required athlete profile fields are present for the calculation path.

These levels describe athlete-data and coefficient completeness only. They do
not describe external scientific validation. The current evidence maturity is
`research-provisional` for every coefficient set, including fully calibrated
athlete sets.

## Still Provisional

The formulas need literature review before production coaching use. Priority source areas:

- Swimming and running cost of transport.
- ACSM metabolic equations.
- Critical power and W prime models.
- Lactate recovery curve fitting.
- HRV and readiness scoring.
- Olbrecht and Mader lactate-model concepts.

The runtime formula version is therefore named
`tri-model-0.2.0-research-provisional`; the former `audit-reviewed` label was
removed because an internal code audit is not a literature review.

## Current Validation Coverage

- Pace conversion and load determinism.
- Carryover direction and readiness penalty.
- Confidence-level separation.
- Calibration regression checks.
- Local database migrations, seeded accounts, access boundaries, session persistence, readiness persistence, calibration persistence, coefficient precedence, and recomputation.
