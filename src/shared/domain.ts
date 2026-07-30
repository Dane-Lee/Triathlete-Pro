export type Role = 'athlete' | 'coach';
export type Discipline = 'swim' | 'bike' | 'run';
export type SessionType = 'training' | 'competition' | 'test';
export type ConfidenceLevel = 'estimated-default' | 'partially-calibrated' | 'fully-calibrated';
export type EvidenceMaturity = 'research-provisional' | 'externally-validated';
export type ReadinessState = 'ready' | 'caution' | 'overload';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface AthleteProfile {
  id: string;
  userId: string;
  name: string;
  email: string;
  dateOfBirth: string;
  gender: 'male' | 'female' | 'unspecified';
  specialtyDiscipline: 'sprint' | 'olympic' | 'half' | 'full';
  bodyMassKg?: number;
  swimCriticalVelocityMps?: number;
  bikeFunctionalThresholdPowerWatts?: number;
  runCriticalVelocityMps?: number;
  restingHeartRateBpm?: number;
  maxHeartRateBpm?: number;
  hrvBaselineRmssdMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CoachAssignment {
  id: string;
  coachUserId: string;
  athleteId: string;
  status: 'active' | 'paused';
  createdAt: string;
}

export interface TrainingSessionInput {
  athleteId: string;
  date: string;
  discipline: Discipline;
  sessionType: SessionType;
  distanceMeters: number;
  durationSeconds: number;
  perceivedExertion: number;
  averageHeartRateBpm?: number;
  maxHeartRateBpm?: number;
  swimPaceSecondsPer100m?: number;
  runPaceSecondsPerKm?: number;
  bikePowerWatts?: number;
  cadence?: number;
  brickParentId?: string;
  notes?: string;
}

export interface TrainingSession extends TrainingSessionInput {
  id: string;
  normalizedLoad: number;
  aerobicLoad: number;
  anaerobicLoad: number;
  confidenceLevel: ConfidenceLevel;
  calculationTrace: CalculationTrace;
  createdAt: string;
  updatedAt: string;
}

export interface LoadMetric {
  id: string;
  sessionId: string;
  athleteId: string;
  date: string;
  discipline: Discipline;
  normalizedLoad: number;
  aerobicLoad: number;
  anaerobicLoad: number;
  intensityFactor: number;
  sourceCoefficientVersion: string;
  confidenceLevel: ConfidenceLevel;
  calculationTrace: CalculationTrace;
  createdAt: string;
}

export interface ReadinessSnapshot {
  id: string;
  athleteId: string;
  date: string;
  swim: DisciplineReadiness;
  bike: DisciplineReadiness;
  run: DisciplineReadiness;
  overallScore: number;
  overallState: ReadinessState;
  limitingDiscipline: Discipline;
  recommendation: string;
  sourceCoefficientVersion: string;
  confidenceLevel: ConfidenceLevel;
  warnings: string[];
  calculationTrace: CalculationTrace;
  createdAt: string;
}

export interface DisciplineReadiness {
  discipline: Discipline;
  acuteLoad: number;
  chronicLoad: number;
  fatigueIndex: number;
  adaptationIndex: number;
  carryoverPenalty: number;
  readinessScore: number;
  state: ReadinessState;
}

export interface CalibrationTest {
  id: string;
  athleteId: string;
  testType: 'swim_energy' | 'recovery_constants' | 'fatigue_multipliers' | 'readiness_thresholds';
  testDate: string;
  protocolData: unknown;
  measurements: unknown[];
  results: unknown;
  isValid: boolean;
  confidenceLevel: ConfidenceLevel;
  createdAt: string;
}

export interface CoefficientSet {
  id: string;
  athleteId?: string;
  version: string;
  name: string;
  confidenceLevel: ConfidenceLevel;
  active: boolean;
  constants: ModelConstants;
  reviewedAt?: string;
  createdAt: string;
}

export interface ModelConstants {
  bodyMassKgDefault: number;
  swimCriticalVelocityMpsDefault: number;
  bikeFtpWattsDefault: number;
  runCriticalVelocityMpsDefault: number;
  restingHeartRateBpmDefault: number;
  maxHeartRateBpmDefault: number;
  costOfTransport: {
    swimJPerKgM: number;
    runJPerKgM: number;
  };
  cycling: {
    grossEfficiency: number;
  };
  carryover: {
    bikeToRunCostMultiplier: number;
    swimToBikeCostMultiplier: number;
    swimToRunCostMultiplier: number;
    halfLifeHours: number;
  };
  readiness: {
    acuteDays: number;
    chronicDays: number;
    readyMin: number;
    cautionMin: number;
  };
}

export interface CalculationTrace {
  formulaVersion: string;
  evidenceMaturity?: EvidenceMaturity;
  sourceCoefficientVersion: string;
  confidenceLevel: ConfidenceLevel;
  inputs: Record<string, number | string | boolean | null>;
  steps: CalculationStep[];
  warnings: string[];
}

export interface CalculationStep {
  label: string;
  value: number | string | boolean;
  unit?: string;
  note?: string;
}

export interface SessionCalculationResult {
  normalizedLoad: number;
  aerobicLoad: number;
  anaerobicLoad: number;
  intensityFactor: number;
  confidenceLevel: ConfidenceLevel;
  warnings: string[];
  calculationTrace: CalculationTrace;
}

export interface AuthSession {
  token: string;
  user: User;
  athlete?: AthleteProfile;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  role: Role;
}
