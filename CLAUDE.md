# Triathlete Energy Tracker - Program Notes

Ecosystem role: Tier 2 - Sport-specific triathlon energy systems.

## What This Program Is

Triathlete Energy Tracker adapts the Olbrecht-style energy system workflow for triathlon. It tracks discipline-specific aerobic and anaerobic load, accounts for cross-discipline fatigue carryover, stores local athlete and coach workflows, and produces auditable calculation traces for coaching review.

This app is a coaching decision-support tool. It is not a medical diagnostic tool.

## Current Architecture

- React + TypeScript + Vite frontend
- Local Node + TypeScript API
- SQLite persistence through the local API
- Shared calculation module used by the backend for load, readiness, carryover, calibration support, and trace generation

The backend is authoritative for production calculations. Frontend calculation previews must use the same shared module or backend API contract.

## Core Data

- Users and local sessions
- Athlete profiles
- Coach-athlete assignments
- Training sessions
- Load metrics
- Readiness snapshots
- Calibration tests
- Versioned coefficient sets
- Audit logs

## Model Rules

- Units are explicit: distance meters, duration seconds, swim pace seconds per 100 m, run pace seconds per km, bike power watts, body mass kg.
- Default model values are allowed only when marked as estimated defaults in warnings and confidence output.
- Athlete profile values and active athlete coefficient overrides take precedence over global defaults.
- Carryover fatigue increases cost and fatigue. It must not improve readiness unless a separate adaptation term is explicitly modeled.
- Confidence levels are distinct: estimated default, partially calibrated, fully calibrated.
- Current formulas are provisional pending deeper review against cost-of-transport, ACSM, CP/W prime, lactate recovery, HRV/readiness, and Olbrecht/Mader lactate-model sources.

## Verification Gate

Run `npm run verify` before continuing feature work. The gate includes source audit, TypeScript checks, lint, unit tests, backend workflow tests, and production build.
