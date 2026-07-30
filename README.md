# Triathlete Energy Tracker

Local prototype for adapting the Olbrecht-style energy tracking workflow to triathlon. The app uses a React + TypeScript frontend, a local Node API, SQLite persistence, and one shared calculation module for auditable session load and readiness outputs.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the API:

```bash
npm run server:dev
```

Start the frontend in a second terminal:

```bash
npm run dev
```

Default API settings live in `.env.example`. The local API creates starter accounts on first run:

- `coach@local.test` / `password123`
- `athlete@local.test` / `password123`

## Verification

Run the full gate before feature work continues:

```bash
npm run verify
```

The gate checks source hygiene, TypeScript, lint, model tests, database workflow tests, and production build.

## Model Status

Current formulas are research provisional. Outputs include formula version,
source coefficient version, athlete-data confidence, evidence maturity,
warnings, and calculation trace. Defaults are marked as estimated until
athlete-specific profile values and calibration-derived coefficients are
reviewed and activated. Even a fully calibrated athlete coefficient set is not
presented as externally validated.

See `EVIDENCE_REGISTER.md` for the source review and production-calibration
acceptance criteria.
