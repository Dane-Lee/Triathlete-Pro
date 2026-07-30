import { describe, expect, it } from 'vitest';
import {
  AthleteProfile,
  CoefficientSet,
  TrainingSession,
  TrainingSessionInput,
} from './domain';
import {
  calculateReadiness,
  calculateSessionLoad,
  defaultCoefficientSet,
  linearRegression,
} from './model';

const athlete: AthleteProfile = {
  id: 'athlete-1',
  userId: 'user-1',
  name: 'Test Athlete',
  email: 'athlete@test.local',
  dateOfBirth: '1990-01-01',
  gender: 'unspecified',
  specialtyDiscipline: 'olympic',
  bodyMassKg: 72,
  swimCriticalVelocityMps: 1.3,
  bikeFunctionalThresholdPowerWatts: 260,
  runCriticalVelocityMps: 4,
  restingHeartRateBpm: 48,
  maxHeartRateBpm: 188,
  hrvBaselineRmssdMs: 62,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const coefficientSet: CoefficientSet = {
  ...defaultCoefficientSet('2026-01-01T00:00:00.000Z'),
  id: 'coeff-1',
  version: 'test-coeff-v1',
  confidenceLevel: 'fully-calibrated',
};

const asSession = (id: string, input: TrainingSessionInput, prior: TrainingSession[] = []): TrainingSession => {
  const result = calculateSessionLoad(input, athlete, coefficientSet, prior);
  return {
    id,
    ...input,
    normalizedLoad: result.normalizedLoad,
    aerobicLoad: result.aerobicLoad,
    anaerobicLoad: result.anaerobicLoad,
    confidenceLevel: result.confidenceLevel,
    calculationTrace: result.calculationTrace,
    createdAt: `${input.date}T00:00:00.000Z`,
    updatedAt: `${input.date}T00:00:00.000Z`,
  };
};

describe('triathlon calculation model', () => {
  it('uses explicit run pace units and produces deterministic load output', () => {
    const result = calculateSessionLoad({
      athleteId: athlete.id,
      date: '2026-05-01',
      discipline: 'run',
      sessionType: 'training',
      distanceMeters: 5000,
      durationSeconds: 1250,
      runPaceSecondsPerKm: 250,
      perceivedExertion: 6,
    }, athlete, coefficientSet);

    expect(result.intensityFactor).toBe(1);
    expect(result.calculationTrace.formulaVersion).toContain('research-provisional');
    expect(result.calculationTrace.evidenceMaturity).toBe('research-provisional');
    expect(result.warnings.join(' ')).toContain('does not constitute external validation');
    expect(result.normalizedLoad).toBe(6.9);
    expect(result.calculationTrace.steps).toContainEqual(expect.objectContaining({
      label: 'run speed',
      value: 4,
      unit: 'm/s',
    }));
  });

  it('makes bike-to-run carryover increase load and add a readiness penalty', () => {
    const bike = asSession('bike-1', {
      athleteId: athlete.id,
      date: '2026-05-10',
      discipline: 'bike',
      sessionType: 'training',
      distanceMeters: 90000,
      durationSeconds: 10800,
      bikePowerWatts: 260,
      perceivedExertion: 8,
    });
    const runInput: TrainingSessionInput = {
      athleteId: athlete.id,
      date: '2026-05-10',
      discipline: 'run',
      sessionType: 'training',
      distanceMeters: 10000,
      durationSeconds: 2400,
      runPaceSecondsPerKm: 240,
      perceivedExertion: 7,
    };

    const freshRun = calculateSessionLoad(runInput, athlete, coefficientSet);
    const brickRun = asSession('run-1', runInput, [bike]);
    const readiness = calculateReadiness(athlete.id, '2026-05-11', [bike, brickRun], coefficientSet);

    expect(brickRun.normalizedLoad).toBeGreaterThan(freshRun.normalizedLoad);
    expect(brickRun.calculationTrace.warnings.join(' ')).toContain('Fatigue carryover increased');
    expect(readiness.run.carryoverPenalty).toBeGreaterThan(0);
    expect(readiness.run.readinessScore).toBeLessThan(82);
  });

  it('separates estimated, partial, and fully calibrated confidence states', () => {
    const sparseAthlete = {
      ...athlete,
      bodyMassKg: undefined,
      runCriticalVelocityMps: undefined,
    };
    const estimated = calculateSessionLoad({
      athleteId: athlete.id,
      date: '2026-05-02',
      discipline: 'run',
      sessionType: 'training',
      distanceMeters: 5000,
      durationSeconds: 1500,
      perceivedExertion: 5,
    }, sparseAthlete, defaultCoefficientSet('2026-01-01T00:00:00.000Z'));
    const partial = calculateSessionLoad({
      athleteId: athlete.id,
      date: '2026-05-03',
      discipline: 'run',
      sessionType: 'training',
      distanceMeters: 5000,
      durationSeconds: 1500,
      perceivedExertion: 5,
    }, sparseAthlete, coefficientSet);
    const complete = calculateSessionLoad({
      athleteId: athlete.id,
      date: '2026-05-04',
      discipline: 'bike',
      sessionType: 'training',
      distanceMeters: 30000,
      durationSeconds: 3600,
      bikePowerWatts: 210,
      perceivedExertion: 5,
    }, athlete, coefficientSet);

    expect(estimated.confidenceLevel).toBe('estimated-default');
    expect(partial.confidenceLevel).toBe('partially-calibrated');
    expect(complete.confidenceLevel).toBe('fully-calibrated');
    expect(complete.calculationTrace.evidenceMaturity).toBe('research-provisional');
  });

  it('fits calibration regression only when enough paired measurements are present', () => {
    expect(linearRegression([1, 2, 3, 4], [2, 4, 6, 8])).toEqual({
      slope: 2,
      intercept: 0,
      rSquared: 1,
      standardError: 0,
      isValid: true,
    });
    expect(() => linearRegression([1, 2], [2, 4])).toThrow('at least three');
  });
});
