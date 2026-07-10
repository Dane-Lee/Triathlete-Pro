import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from './db';
import { defaultCoefficientSet } from '../src/shared/model';

let tempDir = '';
let db: AppDatabase;

const login = () => {
  const session = db.login('coach@local.test', 'password123');
  if (!session) throw new Error('seed coach login failed');
  return session;
};

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'triathlete-db-'));
  db = new AppDatabase(join(tempDir, 'test.sqlite'));
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('local database workflows', () => {
  it('runs migrations, seeds local accounts, and enforces coach access boundaries', () => {
    const coachSession = login();
    const athletes = db.listAthletes(coachSession.user);
    const otherCoach = db.createUser('other-coach@test.local', 'password123', 'Other Coach', 'coach');

    expect(athletes).toHaveLength(1);
    expect(() => db.listSessions(otherCoach, athletes[0].id)).toThrow('Forbidden');
  });

  it('persists sessions, load metrics, readiness snapshots, and calibration records', () => {
    const coachSession = login();
    const [athlete] = db.listAthletes(coachSession.user);

    const session = db.createSession(coachSession.user, {
      athleteId: athlete.id,
      date: '2026-05-12',
      discipline: 'bike',
      sessionType: 'training',
      distanceMeters: 30000,
      durationSeconds: 3600,
      bikePowerWatts: 190,
      perceivedExertion: 6,
    });
    const readiness = db.calculateAndStoreReadiness(coachSession.user, athlete.id, '2026-05-13');
    const calibration = db.createCalibrationTest(coachSession.user, {
      athleteId: athlete.id,
      testType: 'recovery_constants',
      testDate: '2026-05-13',
      protocolData: { units: 'seconds and mmol/L' },
      measurements: [{ t: 0, lactate: 8.1 }, { t: 600, lactate: 4.2 }],
      results: { status: 'pending review' },
      isValid: false,
      confidenceLevel: 'estimated-default',
    });

    expect(session.calculationTrace.sourceCoefficientVersion).toContain('defaults');
    expect(readiness.athleteId).toBe(athlete.id);
    expect(db.getReadiness(coachSession.user, athlete.id, '2026-05-13').id).toBe(readiness.id);
    expect(db.listCalibrationTests(coachSession.user, athlete.id)[0].id).toBe(calibration.id);
  });

  it('uses active athlete coefficient overrides and recomputes existing sessions', () => {
    const coachSession = login();
    const [athlete] = db.listAthletes(coachSession.user);
    const override = {
      ...defaultCoefficientSet('2026-05-01T00:00:00.000Z'),
      id: 'athlete-coeff-v1',
      athleteId: athlete.id,
      version: 'athlete-v1',
      name: 'Athlete reviewed override',
      confidenceLevel: 'partially-calibrated' as const,
    };

    db.insertCoefficient(override, coachSession.user.id);
    const session = db.createSession(coachSession.user, {
      athleteId: athlete.id,
      date: '2026-05-14',
      discipline: 'run',
      sessionType: 'training',
      distanceMeters: 5000,
      durationSeconds: 1450,
      runPaceSecondsPerKm: 290,
      perceivedExertion: 5,
    });
    const recomputed = db.recomputeSessions(coachSession.user, athlete.id);

    expect(session.calculationTrace.sourceCoefficientVersion).toBe('athlete-v1');
    expect(recomputed[0].calculationTrace.sourceCoefficientVersion).toBe('athlete-v1');
  });
});
