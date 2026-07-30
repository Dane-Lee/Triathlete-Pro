/**
 * ReadinessSnapshot → ecosystem ReadinessSnapshotUpsert adapter (milestone
 * ttp-adopt-shared-contracts).
 *
 * The triathlon model is DISCIPLINE-based (swim/bike/run readiness), not
 * physiological-system-based, while the ecosystem contract requires the
 * green/yellow/orange/red categories per internal system as the common
 * denominator from every producer. The honest additive mapping, declared in
 * `categoryBanding` on every snapshot so consumers can audit it:
 *
 * - global category from overallState (ready→green, caution→yellow,
 *   overload→red; orange unused by this model)
 * - per-system categories mirror the global category (no system-level signal
 *   exists in this model yet)
 * - the native per-discipline detail rides in `extensions.disciplines`
 */
import type { ConfidenceLevel, DisciplineReadiness, ReadinessSnapshot } from './domain';
import { InternalSystem, ReadinessCategory, SportContext } from '../ecosystem-contracts/enums';
import type { ReadinessSnapshotUpsertPayload } from '../ecosystem-contracts/payloads/readiness';

export const TRIATHLON_CATEGORY_BANDING =
  'global(overallState): ready=green, caution=yellow, overload=red (orange unused); ' +
  'perSystem: mirrors global (triathlon model is discipline-based, not system-based); ' +
  'native per-discipline readiness in extensions.disciplines; compositeScore0to100 = overallScore';

const STATE_TO_CATEGORY: Record<ReadinessSnapshot['overallState'], ReadinessCategory> = {
  ready: ReadinessCategory.Green,
  caution: ReadinessCategory.Yellow,
  overload: ReadinessCategory.Red,
};

const CONFIDENCE_TO_LEVEL: Record<ConfidenceLevel, 'LOW' | 'MEDIUM' | 'HIGH'> = {
  'estimated-default': 'LOW',
  'partially-calibrated': 'MEDIUM',
  'fully-calibrated': 'HIGH',
};

const disciplineSummary = (readiness: DisciplineReadiness) => ({
  readinessScore: readiness.readinessScore,
  state: readiness.state,
  acuteLoad: readiness.acuteLoad,
  chronicLoad: readiness.chronicLoad,
  fatigueIndex: readiness.fatigueIndex,
  carryoverPenalty: readiness.carryoverPenalty,
});

export type TriathlonReadinessDraft = Omit<ReadinessSnapshotUpsertPayload, 'sharedAthleteId'>;

/**
 * Builds the contract payload minus sharedAthleteId (stamped by the outbox
 * drain once the canonical link is resolved).
 */
export function buildTriathlonReadinessDraft(
  snapshot: ReadinessSnapshot,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
): TriathlonReadinessDraft {
  const category = STATE_TO_CATEGORY[snapshot.overallState] ?? ReadinessCategory.Yellow;
  const composite = Math.max(0, Math.min(100, Math.round(snapshot.overallScore)));

  return {
    snapshotDate: snapshot.date,
    timeZone,
    sport: SportContext.Other,
    systemReadinessCategory: {
      [InternalSystem.Neurological]: category,
      [InternalSystem.Muscular]: category,
      [InternalSystem.Cardiovascular]: category,
    },
    globalReadinessCategory: category,
    compositeScore0to100: composite,
    categoryBanding: TRIATHLON_CATEGORY_BANDING,
    dataQuality: {
      trainingLoadComplete: snapshot.confidenceLevel !== 'estimated-default',
      confidenceLevel: CONFIDENCE_TO_LEVEL[snapshot.confidenceLevel] ?? 'LOW',
    },
    extensions: {
      model: 'triathlon-discipline-based',
      engineVersion: snapshot.sourceCoefficientVersion,
      formulaVersion: snapshot.calculationTrace.formulaVersion,
      evidenceMaturity: snapshot.calculationTrace.evidenceMaturity ?? 'research-provisional',
      limitingDiscipline: snapshot.limitingDiscipline,
      recommendation: snapshot.recommendation,
      warnings: snapshot.warnings,
      disciplines: {
        swim: disciplineSummary(snapshot.swim),
        bike: disciplineSummary(snapshot.bike),
        run: disciplineSummary(snapshot.run),
      },
    },
    createdAt: snapshot.createdAt,
  };
}
