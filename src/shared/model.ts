import {
  AthleteProfile,
  CalculationStep,
  CalculationTrace,
  CoefficientSet,
  ConfidenceLevel,
  Discipline,
  DisciplineReadiness,
  ModelConstants,
  ReadinessSnapshot,
  ReadinessState,
  SessionCalculationResult,
  TrainingSession,
  TrainingSessionInput,
} from './domain';

export const FORMULA_VERSION = 'tri-model-0.1.0-audit-reviewed';

export const defaultModelConstants: ModelConstants = {
  bodyMassKgDefault: 70,
  swimCriticalVelocityMpsDefault: 1.25,
  bikeFtpWattsDefault: 220,
  runCriticalVelocityMpsDefault: 3.8,
  restingHeartRateBpmDefault: 55,
  maxHeartRateBpmDefault: 185,
  costOfTransport: {
    swimJPerKgM: 12.5,
    runJPerKgM: 4.6,
  },
  cycling: {
    grossEfficiency: 0.23,
  },
  carryover: {
    bikeToRunCostMultiplier: 1.1,
    swimToBikeCostMultiplier: 1.02,
    swimToRunCostMultiplier: 1.02,
    halfLifeHours: 8,
  },
  readiness: {
    acuteDays: 7,
    chronicDays: 42,
    readyMin: 70,
    cautionMin: 45,
  },
};

export const defaultCoefficientSet = (now = new Date().toISOString()): CoefficientSet => ({
  id: 'global-default',
  version: 'defaults-2026-05-audit',
  name: 'Research defaults pending athlete calibration',
  confidenceLevel: 'estimated-default',
  active: true,
  constants: defaultModelConstants,
  reviewedAt: now,
  createdAt: now,
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const daysBetween = (fromIso: string, toIso: string) => {
  const from = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const to = new Date(`${toIso.slice(0, 10)}T00:00:00Z`).getTime();
  return (to - from) / 86_400_000;
};

const inferConfidence = (coefficientSet: CoefficientSet, warnings: string[]): ConfidenceLevel => {
  if (warnings.length > 0 && coefficientSet.confidenceLevel === 'fully-calibrated') {
    return 'partially-calibrated';
  }
  if (warnings.length > 0) return 'estimated-default';
  return coefficientSet.confidenceLevel;
};

const resolveNumber = (
  value: number | undefined,
  fallback: number,
  label: string,
  unit: string,
  warnings: string[],
  steps: CalculationStep[],
) => {
  if (Number.isFinite(value)) {
    steps.push({ label, value: round(value as number, 3), unit, note: 'athlete profile' });
    return value as number;
  }
  warnings.push(`Missing ${label}; used documented default ${fallback} ${unit}.`);
  steps.push({ label, value: fallback, unit, note: 'documented default' });
  return fallback;
};

const getSpeedMps = (session: TrainingSessionInput): number => {
  if (session.durationSeconds > 0) return session.distanceMeters / session.durationSeconds;
  return 0;
};

const baseIntensity = (
  session: TrainingSessionInput,
  athlete: AthleteProfile,
  constants: ModelConstants,
  warnings: string[],
  steps: CalculationStep[],
) => {
  const observedSpeed = getSpeedMps(session);
  if (session.discipline === 'swim') {
    const swimCv = resolveNumber(
      athlete.swimCriticalVelocityMps,
      constants.swimCriticalVelocityMpsDefault,
      'swim critical velocity',
      'm/s',
      warnings,
      steps,
    );
    const speed = session.swimPaceSecondsPer100m
      ? 100 / session.swimPaceSecondsPer100m
      : observedSpeed;
    if (!session.swimPaceSecondsPer100m) warnings.push('Missing swim pace; inferred swim speed from distance and duration.');
    steps.push({ label: 'swim speed', value: round(speed, 3), unit: 'm/s' });
    return clamp(speed / swimCv, 0.35, 1.8);
  }

  if (session.discipline === 'bike') {
    const ftp = resolveNumber(
      athlete.bikeFunctionalThresholdPowerWatts,
      constants.bikeFtpWattsDefault,
      'bike FTP',
      'W',
      warnings,
      steps,
    );
    if (session.bikePowerWatts) {
      steps.push({ label: 'bike power', value: session.bikePowerWatts, unit: 'W' });
      return clamp(session.bikePowerWatts / ftp, 0.25, 1.6);
    }
    warnings.push('Missing bike power; estimated bike intensity from speed and RPE.');
    const speedKph = observedSpeed * 3.6;
    steps.push({ label: 'bike speed proxy', value: round(speedKph, 1), unit: 'km/h' });
    return clamp((speedKph / 30) * (0.75 + session.perceivedExertion / 20), 0.25, 1.4);
  }

  const runCv = resolveNumber(
    athlete.runCriticalVelocityMps,
    constants.runCriticalVelocityMpsDefault,
    'run critical velocity',
    'm/s',
    warnings,
    steps,
  );
  const speed = session.runPaceSecondsPerKm
    ? 1000 / session.runPaceSecondsPerKm
    : observedSpeed;
  if (!session.runPaceSecondsPerKm) warnings.push('Missing run pace; inferred run speed from distance and duration.');
  steps.push({ label: 'run speed', value: round(speed, 3), unit: 'm/s' });
  return clamp(speed / runCv, 0.25, 1.7);
};

const energyCostJoules = (
  session: TrainingSessionInput,
  athlete: AthleteProfile,
  constants: ModelConstants,
  warnings: string[],
  steps: CalculationStep[],
) => {
  const bodyMass = resolveNumber(athlete.bodyMassKg, constants.bodyMassKgDefault, 'body mass', 'kg', warnings, steps);
  if (session.discipline === 'bike') {
    if (!session.bikePowerWatts) {
      warnings.push('Missing bike power; metabolic energy uses speed-derived proxy and should be calibrated.');
    }
    const mechanicalJoules = (session.bikePowerWatts ?? 0.5 * bodyMass * getSpeedMps(session) ** 2) * session.durationSeconds;
    const metabolicJoules = mechanicalJoules / constants.cycling.grossEfficiency;
    steps.push({ label: 'bike metabolic energy', value: round(metabolicJoules, 0), unit: 'J' });
    return metabolicJoules;
  }

  const costPerKgM = session.discipline === 'swim'
    ? constants.costOfTransport.swimJPerKgM
    : constants.costOfTransport.runJPerKgM;
  const metabolicJoules = costPerKgM * bodyMass * session.distanceMeters;
  steps.push({ label: `${session.discipline} metabolic energy`, value: round(metabolicJoules, 0), unit: 'J' });
  return metabolicJoules;
};

const anaerobicShare = (intensityFactor: number, durationSeconds: number, rpe: number) => {
  const durationMinutes = durationSeconds / 60;
  const shortSessionBias = durationMinutes <= 2 ? 0.45 : durationMinutes <= 5 ? 0.3 : durationMinutes <= 15 ? 0.18 : 0.1;
  const intensityBias = clamp((intensityFactor - 0.85) * 0.35, 0, 0.25);
  const rpeBias = clamp((rpe - 6) * 0.035, -0.08, 0.16);
  return clamp(shortSessionBias + intensityBias + rpeBias, 0.05, 0.75);
};

export const calculateCarryoverMultiplier = (
  session: TrainingSessionInput,
  priorSessions: TrainingSession[],
  constants: ModelConstants,
  steps: CalculationStep[],
) => {
  const sameOrEarlier = priorSessions.filter((prior) => prior.athleteId === session.athleteId && new Date(prior.date) <= new Date(session.date));
  let multiplier = 1;
  let penaltyLoad = 0;

  for (const prior of sameOrEarlier) {
    const elapsedDays = Math.max(0, daysBetween(prior.date, session.date));
    const elapsedHours = elapsedDays * 24;
    const decay = Math.exp(-Math.log(2) * elapsedHours / constants.carryover.halfLifeHours);
    if (decay < 0.02) continue;

    if (session.discipline === 'run' && prior.discipline === 'bike') {
      const loadScale = clamp(prior.normalizedLoad / 100, 0, 1.5);
      const add = (constants.carryover.bikeToRunCostMultiplier - 1) * decay * loadScale;
      multiplier += add;
      penaltyLoad += prior.normalizedLoad * add;
    } else if (session.discipline === 'bike' && prior.discipline === 'swim') {
      const add = (constants.carryover.swimToBikeCostMultiplier - 1) * decay * clamp(prior.normalizedLoad / 100, 0, 1);
      multiplier += add;
      penaltyLoad += prior.normalizedLoad * add;
    } else if (session.discipline === 'run' && prior.discipline === 'swim') {
      const add = (constants.carryover.swimToRunCostMultiplier - 1) * decay * clamp(prior.normalizedLoad / 100, 0, 1);
      multiplier += add;
      penaltyLoad += prior.normalizedLoad * add;
    }
  }

  steps.push({ label: 'fatigue carryover multiplier', value: round(multiplier, 3), note: 'values above 1 increase cost/load' });
  return { multiplier: clamp(multiplier, 1, 1.4), penaltyLoad: round(penaltyLoad, 2) };
};

export const calculateSessionLoad = (
  session: TrainingSessionInput,
  athlete: AthleteProfile,
  coefficientSet: CoefficientSet,
  priorSessions: TrainingSession[] = [],
): SessionCalculationResult => {
  const warnings: string[] = [];
  const steps: CalculationStep[] = [];
  const constants = coefficientSet.constants;

  const durationHours = session.durationSeconds / 3600;
  const intensityFactor = baseIntensity(session, athlete, constants, warnings, steps);
  steps.push({ label: 'intensity factor', value: round(intensityFactor, 3), unit: 'ratio' });

  const energy = energyCostJoules(session, athlete, constants, warnings, steps);
  const rpeFactor = clamp(session.perceivedExertion / 6, 0.5, 1.8);
  steps.push({ label: 'RPE factor', value: round(rpeFactor, 3), unit: 'ratio' });

  const carryover = calculateCarryoverMultiplier(session, priorSessions, constants, steps);
  if (carryover.multiplier > 1.01) {
    warnings.push('Fatigue carryover increased this session load; readiness will be penalized, not boosted.');
  }

  const energyLoad = energy / 1_000_000;
  const normalizedLoad = clamp(
    energyLoad * intensityFactor * rpeFactor * carryover.multiplier + durationHours * 15,
    0,
    450,
  );
  const anaerobicRatio = anaerobicShare(intensityFactor, session.durationSeconds, session.perceivedExertion);
  const anaerobicLoad = normalizedLoad * anaerobicRatio;
  const aerobicLoad = normalizedLoad - anaerobicLoad;

  const confidenceLevel = inferConfidence(coefficientSet, warnings);
  const trace: CalculationTrace = {
    formulaVersion: FORMULA_VERSION,
    sourceCoefficientVersion: coefficientSet.version,
    confidenceLevel,
    inputs: {
      discipline: session.discipline,
      distanceMeters: session.distanceMeters,
      durationSeconds: session.durationSeconds,
      perceivedExertion: session.perceivedExertion,
      averageHeartRateBpm: session.averageHeartRateBpm ?? null,
      swimPaceSecondsPer100m: session.swimPaceSecondsPer100m ?? null,
      runPaceSecondsPerKm: session.runPaceSecondsPerKm ?? null,
      bikePowerWatts: session.bikePowerWatts ?? null,
    },
    steps: [
      ...steps,
      { label: 'normalized load', value: round(normalizedLoad, 1), unit: 'TL' },
      { label: 'aerobic load', value: round(aerobicLoad, 1), unit: 'TL' },
      { label: 'anaerobic load', value: round(anaerobicLoad, 1), unit: 'TL' },
    ],
    warnings,
  };

  return {
    normalizedLoad: round(normalizedLoad, 1),
    aerobicLoad: round(aerobicLoad, 1),
    anaerobicLoad: round(anaerobicLoad, 1),
    intensityFactor: round(intensityFactor, 3),
    confidenceLevel,
    warnings,
    calculationTrace: trace,
  };
};

const readinessState = (score: number, constants: ModelConstants): ReadinessState => {
  if (score >= constants.readiness.readyMin) return 'ready';
  if (score >= constants.readiness.cautionMin) return 'caution';
  return 'overload';
};

const disciplineReadiness = (
  discipline: Discipline,
  sessions: TrainingSession[],
  date: string,
  constants: ModelConstants,
): DisciplineReadiness => {
  const disciplineSessions = sessions.filter((session) => session.discipline === discipline && daysBetween(session.date, date) >= 0);
  const acuteSessions = disciplineSessions.filter((session) => daysBetween(session.date, date) < constants.readiness.acuteDays);
  const chronicSessions = disciplineSessions.filter((session) => daysBetween(session.date, date) < constants.readiness.chronicDays);
  const acuteLoad = acuteSessions.reduce((sum, session) => sum + session.normalizedLoad, 0);
  const chronicLoad = chronicSessions.reduce((sum, session) => sum + session.normalizedLoad, 0);
  const chronicExpectedAcute = Math.max(1, chronicLoad / constants.readiness.chronicDays * constants.readiness.acuteDays);
  const loadRatio = acuteLoad / chronicExpectedAcute;
  const adaptationIndex = clamp((chronicLoad / constants.readiness.chronicDays) * 2.2, 0, 35);
  const carryoverPenalty = acuteSessions
    .filter((session) => session.calculationTrace.steps.some((step) => step.label === 'fatigue carryover multiplier' && Number(step.value) > 1.01))
    .reduce((sum, session) => sum + session.normalizedLoad * 0.08, 0);
  const fatigueIndex = clamp(loadRatio * 42 + carryoverPenalty, 0, 100);
  const readinessScore = clamp(82 + adaptationIndex - fatigueIndex, 0, 100);

  return {
    discipline,
    acuteLoad: round(acuteLoad, 1),
    chronicLoad: round(chronicLoad, 1),
    fatigueIndex: round(fatigueIndex, 1),
    adaptationIndex: round(adaptationIndex, 1),
    carryoverPenalty: round(carryoverPenalty, 1),
    readinessScore: round(readinessScore, 1),
    state: readinessState(readinessScore, constants),
  };
};

export const calculateReadiness = (
  athleteId: string,
  date: string,
  sessions: TrainingSession[],
  coefficientSet: CoefficientSet,
): Omit<ReadinessSnapshot, 'id' | 'createdAt'> => {
  const constants = coefficientSet.constants;
  const athleteSessions = sessions.filter((session) => session.athleteId === athleteId && daysBetween(session.date, date) >= 0);
  const swim = disciplineReadiness('swim', athleteSessions, date, constants);
  const bike = disciplineReadiness('bike', athleteSessions, date, constants);
  const run = disciplineReadiness('run', athleteSessions, date, constants);
  const weights: Record<Discipline, number> = { swim: 0.2, bike: 0.4, run: 0.4 };
  const overallScore = round(swim.readinessScore * weights.swim + bike.readinessScore * weights.bike + run.readinessScore * weights.run, 1);
  const ranked = [swim, bike, run].sort((a, b) => a.readinessScore - b.readinessScore);
  const limitingDiscipline = ranked[0].discipline;
  const overallState = readinessState(Math.min(overallScore, ranked[0].readinessScore + 8), constants);
  const confidenceLevel = coefficientSet.confidenceLevel;
  const warnings = confidenceLevel === 'estimated-default'
    ? ['Readiness is based on defaults and should be treated as an estimate until athlete calibration is complete.']
    : [];
  const recommendation = overallState === 'ready'
    ? `Ready for planned training. Watch ${limitingDiscipline} because it is currently the limiting discipline.`
    : overallState === 'caution'
      ? `Use caution. Reduce intensity or volume for ${limitingDiscipline} until fatigue normalizes.`
      : `Overload risk is elevated. Prioritize recovery before hard ${limitingDiscipline} work.`;
  const calculationTrace: CalculationTrace = {
    formulaVersion: FORMULA_VERSION,
    sourceCoefficientVersion: coefficientSet.version,
    confidenceLevel,
    inputs: { athleteId, date, sessionCount: athleteSessions.length },
    steps: [
      { label: 'swim readiness', value: swim.readinessScore, unit: 'score' },
      { label: 'bike readiness', value: bike.readinessScore, unit: 'score' },
      { label: 'run readiness', value: run.readinessScore, unit: 'score' },
      { label: 'weighted overall readiness', value: overallScore, unit: 'score' },
    ],
    warnings,
  };

  return {
    athleteId,
    date,
    swim,
    bike,
    run,
    overallScore,
    overallState,
    limitingDiscipline,
    recommendation,
    sourceCoefficientVersion: coefficientSet.version,
    confidenceLevel,
    warnings,
    calculationTrace,
  };
};

export const linearRegression = (x: number[], y: number[]) => {
  if (x.length !== y.length || x.length < 3) {
    throw new Error('Regression requires at least three paired measurements.');
  }
  const n = x.length;
  const sumX = x.reduce((sum, value) => sum + value, 0);
  const sumY = y.reduce((sum, value) => sum + value, 0);
  const sumXY = x.reduce((sum, value, index) => sum + value * y[index], 0);
  const sumXX = x.reduce((sum, value) => sum + value ** 2, 0);
  const denominator = n * sumXX - sumX ** 2;
  if (denominator === 0) throw new Error('Regression input has no x variance.');
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  const ssTotal = y.reduce((sum, value) => sum + (value - meanY) ** 2, 0);
  const ssResidual = y.reduce((sum, value, index) => sum + (value - (slope * x[index] + intercept)) ** 2, 0);
  const rSquared = ssTotal === 0 ? 1 : 1 - ssResidual / ssTotal;
  const standardError = Math.sqrt(ssResidual / Math.max(1, n - 2));

  return {
    slope: round(slope, 4),
    intercept: round(intercept, 4),
    rSquared: round(rSquared, 4),
    standardError: round(standardError, 4),
    isValid: rSquared >= 0.9,
  };
};
