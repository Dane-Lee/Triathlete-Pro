import { describe, expect, it } from 'vitest';
import { buildTriathlonReadinessDraft, TRIATHLON_CATEGORY_BANDING } from './ecosystemEnvelope';
import type { DisciplineReadiness, ReadinessSnapshot } from './domain';

const discipline = (over: Partial<DisciplineReadiness> = {}): DisciplineReadiness => ({
  discipline: 'swim',
  acuteLoad: 120,
  chronicLoad: 100,
  fatigueIndex: 0.4,
  adaptationIndex: 0.6,
  carryoverPenalty: 2,
  readinessScore: 78,
  state: 'ready',
  ...over,
});

const snapshot = (over: Partial<ReadinessSnapshot> = {}): ReadinessSnapshot => ({
  id: 'snap-1',
  athleteId: 'ath-1',
  date: '2026-07-10',
  swim: discipline({ discipline: 'swim' }),
  bike: discipline({ discipline: 'bike', readinessScore: 65, state: 'caution' }),
  run: discipline({ discipline: 'run', readinessScore: 55, state: 'caution' }),
  overallScore: 66.4,
  overallState: 'caution',
  limitingDiscipline: 'run',
  recommendation: 'Prioritize run recovery before the next brick.',
  sourceCoefficientVersion: 'coeff-v3',
  confidenceLevel: 'partially-calibrated',
  warnings: ['run chronic load rising fast'],
  calculationTrace: {
    formulaVersion: 'model-v1',
    sourceCoefficientVersion: 'coeff-v3',
    confidenceLevel: 'partially-calibrated',
    inputs: {},
    steps: [],
    warnings: [],
  },
  createdAt: '2026-07-10T08:00:00.000Z',
  ...over,
});

describe('buildTriathlonReadinessDraft', () => {
  it('maps overallState to the contract category and mirrors it per system', () => {
    const draft = buildTriathlonReadinessDraft(snapshot(), 'America/New_York');

    expect(draft.globalReadinessCategory).toBe('yellow');
    expect(draft.systemReadinessCategory).toEqual({
      neurological: 'yellow',
      muscular: 'yellow',
      cardiovascular: 'yellow',
    });
    expect(draft.categoryBanding).toBe(TRIATHLON_CATEGORY_BANDING);
  });

  it('maps ready and overload to green and red', () => {
    expect(
      buildTriathlonReadinessDraft(snapshot({ overallState: 'ready' })).globalReadinessCategory
    ).toBe('green');
    expect(
      buildTriathlonReadinessDraft(snapshot({ overallState: 'overload' })).globalReadinessCategory
    ).toBe('red');
  });

  it('rounds and clamps the composite score to 0-100', () => {
    expect(buildTriathlonReadinessDraft(snapshot({ overallScore: 66.4 })).compositeScore0to100).toBe(66);
    expect(buildTriathlonReadinessDraft(snapshot({ overallScore: 137 })).compositeScore0to100).toBe(100);
    expect(buildTriathlonReadinessDraft(snapshot({ overallScore: -4 })).compositeScore0to100).toBe(0);
  });

  it('maps confidence levels onto the contract scale', () => {
    expect(
      buildTriathlonReadinessDraft(snapshot({ confidenceLevel: 'estimated-default' })).dataQuality
        ?.confidenceLevel
    ).toBe('LOW');
    expect(
      buildTriathlonReadinessDraft(snapshot({ confidenceLevel: 'fully-calibrated' })).dataQuality
        ?.confidenceLevel
    ).toBe('HIGH');
  });

  it('carries the native per-discipline model in extensions', () => {
    const draft = buildTriathlonReadinessDraft(snapshot());
    const extensions = draft.extensions as {
      disciplines: Record<string, { readinessScore: number; state: string }>;
      limitingDiscipline: string;
      engineVersion: string;
    };

    expect(extensions.limitingDiscipline).toBe('run');
    expect(extensions.engineVersion).toBe('coeff-v3');
    expect(extensions.disciplines.run.readinessScore).toBe(55);
    expect(extensions.disciplines.bike.state).toBe('caution');
  });

  it('uses the snapshot date and creation timestamp verbatim', () => {
    const draft = buildTriathlonReadinessDraft(snapshot(), 'UTC');
    expect(draft.snapshotDate).toBe('2026-07-10');
    expect(draft.createdAt).toBe('2026-07-10T08:00:00.000Z');
    expect(draft.timeZone).toBe('UTC');
  });
});
