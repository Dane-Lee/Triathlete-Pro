import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncValue } from 'node:sqlite';
import {
  AthleteProfile,
  CalibrationTest,
  CoachAssignment,
  CoefficientSet,
  ConfidenceLevel,
  Discipline,
  ReadinessSnapshot,
  Role,
  TrainingSession,
  TrainingSessionInput,
  User,
} from '../src/shared/domain';
import { calculateReadiness, calculateSessionLoad, defaultCoefficientSet } from '../src/shared/model';

type Row = Record<string, unknown>;
type DatabaseSyncConstructor = typeof DatabaseSyncValue;
type DatabaseSyncInstance = InstanceType<DatabaseSyncConstructor>;

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as { DatabaseSync: DatabaseSyncConstructor };

const nowIso = () => new Date().toISOString();
const asString = (value: unknown) => String(value ?? '');
const asNumber = (value: unknown) => (value === null || value === undefined ? undefined : Number(value));
const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || !value) return fallback;
  return JSON.parse(value) as T;
};

export class AppDatabase {
  private db: DatabaseSyncInstance;

  constructor(path: string) {
    const resolved = resolve(path);
    mkdirSync(dirname(resolved), { recursive: true });
    this.db = new DatabaseSync(resolved);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
    this.seed();
  }

  close() {
    this.db.close();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        role TEXT CHECK(role IN ('athlete','coach')) NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS athletes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        date_of_birth TEXT NOT NULL,
        gender TEXT NOT NULL,
        specialty_discipline TEXT NOT NULL,
        body_mass_kg REAL,
        swim_critical_velocity_mps REAL,
        bike_ftp_watts REAL,
        run_critical_velocity_mps REAL,
        resting_hr_bpm INTEGER,
        max_hr_bpm INTEGER,
        hrv_baseline_rmssd_ms REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS coach_assignments (
        id TEXT PRIMARY KEY,
        coach_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
        status TEXT CHECK(status IN ('active','paused')) NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(coach_user_id, athlete_id)
      );

      CREATE TABLE IF NOT EXISTS coefficient_sets (
        id TEXT PRIMARY KEY,
        athlete_id TEXT REFERENCES athletes(id) ON DELETE CASCADE,
        version TEXT NOT NULL,
        name TEXT NOT NULL,
        confidence_level TEXT NOT NULL,
        active INTEGER NOT NULL,
        constants_json TEXT NOT NULL,
        reviewed_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS training_sessions (
        id TEXT PRIMARY KEY,
        athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        discipline TEXT CHECK(discipline IN ('swim','bike','run')) NOT NULL,
        session_type TEXT NOT NULL,
        distance_meters REAL NOT NULL,
        duration_seconds REAL NOT NULL,
        perceived_exertion REAL NOT NULL,
        average_hr_bpm REAL,
        max_hr_bpm REAL,
        swim_pace_seconds_per_100m REAL,
        run_pace_seconds_per_km REAL,
        bike_power_watts REAL,
        cadence REAL,
        brick_parent_id TEXT,
        notes TEXT,
        normalized_load REAL NOT NULL,
        aerobic_load REAL NOT NULL,
        anaerobic_load REAL NOT NULL,
        confidence_level TEXT NOT NULL,
        calculation_trace_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS load_metrics (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
        athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        discipline TEXT NOT NULL,
        normalized_load REAL NOT NULL,
        aerobic_load REAL NOT NULL,
        anaerobic_load REAL NOT NULL,
        intensity_factor REAL NOT NULL,
        source_coefficient_version TEXT NOT NULL,
        confidence_level TEXT NOT NULL,
        calculation_trace_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS readiness_snapshots (
        id TEXT PRIMARY KEY,
        athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(athlete_id, date)
      );

      CREATE TABLE IF NOT EXISTS calibration_tests (
        id TEXT PRIMARY KEY,
        athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
        test_type TEXT NOT NULL,
        test_date TEXT NOT NULL,
        protocol_data_json TEXT NOT NULL,
        measurements_json TEXT NOT NULL,
        results_json TEXT NOT NULL,
        is_valid INTEGER NOT NULL,
        confidence_level TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ecosystem_athlete_links (
        athlete_id TEXT PRIMARY KEY,
        shared_athlete_id TEXT NOT NULL,
        match_method TEXT NOT NULL DEFAULT 'auto-resolve',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ecosystem_outbox (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        payload_type TEXT NOT NULL,
        athlete_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_ecosystem_outbox_pending
        ON ecosystem_outbox (status, created_at);
    `);
  }

  private seed() {
    const count = Number(this.db.prepare('SELECT COUNT(*) AS count FROM users').get()?.count ?? 0);
    if (count > 0) return;

    const coach = this.createUser('coach@local.test', 'password123', 'Local Coach', 'coach');
    const athleteUser = this.createUser('athlete@local.test', 'password123', 'Local Athlete', 'athlete');
    const athlete = this.createAthlete({
      userId: athleteUser.id,
      name: 'Local Athlete',
      email: 'athlete@local.test',
      dateOfBirth: '1990-01-01',
      gender: 'unspecified',
      specialtyDiscipline: 'olympic',
      bodyMassKg: 70,
      swimCriticalVelocityMps: 1.25,
      bikeFunctionalThresholdPowerWatts: 220,
      runCriticalVelocityMps: 3.8,
      restingHeartRateBpm: 55,
      maxHeartRateBpm: 185,
    });
    this.createCoachAssignment(coach.id, athlete.id, coach.id);
    this.insertCoefficient(defaultCoefficientSet(), coach.id);
    this.audit(coach.id, 'seed:local_starter_data', 'system', undefined, { coach: coach.email, athlete: athlete.email });
  }

  private hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
    const hash = scryptSync(password, salt, 64).toString('hex');
    return { hash, salt };
  }

  private verifyPassword(password: string, hash: string, salt: string) {
    const candidate = scryptSync(password, salt, 64);
    const stored = Buffer.from(hash, 'hex');
    return stored.length === candidate.length && timingSafeEqual(stored, candidate);
  }

  createUser(email: string, password: string, name: string, role: Role): User {
    const id = randomUUID();
    const createdAt = nowIso();
    const { hash, salt } = this.hashPassword(password);
    this.db.prepare(`
      INSERT INTO users (id, email, name, role, password_hash, password_salt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, email.toLowerCase(), name, role, hash, salt, createdAt);
    return { id, email: email.toLowerCase(), name, role };
  }

  login(email: string, password: string) {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!row) return undefined;
    if (!this.verifyPassword(password, asString(row.password_hash), asString(row.password_salt))) return undefined;
    const user = this.userFromRow(row);
    const token = randomBytes(32).toString('hex');
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
    this.db.prepare('INSERT INTO auth_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(token, user.id, expiresAt, createdAt);
    this.audit(user.id, 'auth:login', 'user', user.id, {});
    return { token, user, athlete: user.role === 'athlete' ? this.getAthleteByUserId(user.id) : undefined };
  }

  userForToken(token: string | undefined): User | undefined {
    if (!token) return undefined;
    const row = this.db.prepare(`
      SELECT users.* FROM auth_sessions
      JOIN users ON users.id = auth_sessions.user_id
      WHERE auth_sessions.token = ? AND auth_sessions.expires_at > ?
    `).get(token, nowIso());
    return row ? this.userFromRow(row) : undefined;
  }

  logout(token: string) {
    this.db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
  }

  listAthletes(user: User): AthleteProfile[] {
    if (user.role === 'athlete') {
      const athlete = this.getAthleteByUserId(user.id);
      return athlete ? [athlete] : [];
    }
    return this.db.prepare(`
      SELECT athletes.* FROM athletes
      JOIN coach_assignments ON coach_assignments.athlete_id = athletes.id
      WHERE coach_assignments.coach_user_id = ? AND coach_assignments.status = 'active'
      ORDER BY athletes.name
    `).all(user.id).map((row) => this.athleteFromRow(row));
  }

  canAccessAthlete(user: User, athleteId: string) {
    if (user.role === 'athlete') {
      const athlete = this.getAthleteByUserId(user.id);
      return athlete?.id === athleteId;
    }
    const row = this.db.prepare(`
      SELECT id FROM coach_assignments
      WHERE coach_user_id = ? AND athlete_id = ? AND status = 'active'
    `).get(user.id, athleteId);
    return Boolean(row);
  }

  createAthlete(input: Omit<AthleteProfile, 'id' | 'createdAt' | 'updatedAt'>): AthleteProfile {
    const id = randomUUID();
    const createdAt = nowIso();
    this.db.prepare(`
      INSERT INTO athletes (
        id, user_id, name, email, date_of_birth, gender, specialty_discipline,
        body_mass_kg, swim_critical_velocity_mps, bike_ftp_watts, run_critical_velocity_mps,
        resting_hr_bpm, max_hr_bpm, hrv_baseline_rmssd_ms, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.userId,
      input.name,
      input.email,
      input.dateOfBirth,
      input.gender,
      input.specialtyDiscipline,
      input.bodyMassKg ?? null,
      input.swimCriticalVelocityMps ?? null,
      input.bikeFunctionalThresholdPowerWatts ?? null,
      input.runCriticalVelocityMps ?? null,
      input.restingHeartRateBpm ?? null,
      input.maxHeartRateBpm ?? null,
      input.hrvBaselineRmssdMs ?? null,
      createdAt,
      createdAt,
    );
    return this.getAthlete(id) as AthleteProfile;
  }

  getAthlete(id: string): AthleteProfile | undefined {
    const row = this.db.prepare('SELECT * FROM athletes WHERE id = ?').get(id);
    return row ? this.athleteFromRow(row) : undefined;
  }

  getAthleteByUserId(userId: string): AthleteProfile | undefined {
    const row = this.db.prepare('SELECT * FROM athletes WHERE user_id = ?').get(userId);
    return row ? this.athleteFromRow(row) : undefined;
  }

  updateAthlete(id: string, patch: Partial<AthleteProfile>, actorUserId: string): AthleteProfile {
    const current = this.getAthlete(id);
    if (!current) throw new Error('Athlete not found.');
    const next = { ...current, ...patch, id, userId: current.userId, updatedAt: nowIso() };
    this.db.prepare(`
      UPDATE athletes SET
        name = ?, email = ?, date_of_birth = ?, gender = ?, specialty_discipline = ?,
        body_mass_kg = ?, swim_critical_velocity_mps = ?, bike_ftp_watts = ?,
        run_critical_velocity_mps = ?, resting_hr_bpm = ?, max_hr_bpm = ?,
        hrv_baseline_rmssd_ms = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.name,
      next.email,
      next.dateOfBirth,
      next.gender,
      next.specialtyDiscipline,
      next.bodyMassKg ?? null,
      next.swimCriticalVelocityMps ?? null,
      next.bikeFunctionalThresholdPowerWatts ?? null,
      next.runCriticalVelocityMps ?? null,
      next.restingHeartRateBpm ?? null,
      next.maxHeartRateBpm ?? null,
      next.hrvBaselineRmssdMs ?? null,
      next.updatedAt,
      id,
    );
    this.audit(actorUserId, 'athlete:update', 'athlete', id, patch);
    return this.getAthlete(id) as AthleteProfile;
  }

  listCoachAssignments(user: User): CoachAssignment[] {
    if (user.role !== 'coach') return [];
    return this.db.prepare('SELECT * FROM coach_assignments WHERE coach_user_id = ? ORDER BY created_at DESC')
      .all(user.id)
      .map((row) => this.assignmentFromRow(row));
  }

  createCoachAssignment(coachUserId: string, athleteId: string, actorUserId: string): CoachAssignment {
    const id = randomUUID();
    const createdAt = nowIso();
    this.db.prepare(`
      INSERT OR REPLACE INTO coach_assignments (id, coach_user_id, athlete_id, status, created_at)
      VALUES (?, ?, ?, 'active', ?)
    `).run(id, coachUserId, athleteId, createdAt);
    this.audit(actorUserId, 'coach_assignment:create', 'coach_assignment', id, { coachUserId, athleteId });
    return this.assignmentFromRow(this.db.prepare('SELECT * FROM coach_assignments WHERE id = ?').get(id) as Row);
  }

  activeCoefficientSet(athleteId?: string): CoefficientSet {
    const athleteSpecific = athleteId
      ? this.db.prepare('SELECT * FROM coefficient_sets WHERE athlete_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1').get(athleteId)
      : undefined;
    const row = athleteSpecific ?? this.db.prepare('SELECT * FROM coefficient_sets WHERE athlete_id IS NULL AND active = 1 ORDER BY created_at DESC LIMIT 1').get();
    if (!row) {
      const fallback = defaultCoefficientSet();
      this.insertCoefficient(fallback);
      return fallback;
    }
    return this.coefficientFromRow(row);
  }

  listCoefficients(athleteId?: string): CoefficientSet[] {
    const rows = athleteId
      ? this.db.prepare('SELECT * FROM coefficient_sets WHERE athlete_id = ? OR athlete_id IS NULL ORDER BY created_at DESC').all(athleteId)
      : this.db.prepare('SELECT * FROM coefficient_sets ORDER BY created_at DESC').all();
    return rows.map((row) => this.coefficientFromRow(row));
  }

  insertCoefficient(input: CoefficientSet, actorUserId?: string): CoefficientSet {
    if (input.active) {
      if (input.athleteId) {
        this.db.prepare('UPDATE coefficient_sets SET active = 0 WHERE athlete_id = ?').run(input.athleteId);
      } else {
        this.db.prepare('UPDATE coefficient_sets SET active = 0 WHERE athlete_id IS NULL').run();
      }
    }
    const id = input.id || randomUUID();
    this.db.prepare(`
      INSERT INTO coefficient_sets (
        id, athlete_id, version, name, confidence_level, active, constants_json, reviewed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.athleteId ?? null,
      input.version,
      input.name,
      input.confidenceLevel,
      input.active ? 1 : 0,
      JSON.stringify(input.constants),
      input.reviewedAt ?? null,
      input.createdAt,
    );
    this.audit(actorUserId, 'coefficient:create', 'coefficient_set', id, { version: input.version, athleteId: input.athleteId });
    return this.coefficientFromRow(this.db.prepare('SELECT * FROM coefficient_sets WHERE id = ?').get(id) as Row);
  }

  listSessions(user: User, athleteId: string): TrainingSession[] {
    if (!this.canAccessAthlete(user, athleteId)) throw new Error('Forbidden.');
    return this.db.prepare('SELECT * FROM training_sessions WHERE athlete_id = ? ORDER BY date DESC, created_at DESC')
      .all(athleteId)
      .map((row) => this.sessionFromRow(row));
  }

  createSession(user: User, input: TrainingSessionInput): TrainingSession {
    if (!this.canAccessAthlete(user, input.athleteId)) throw new Error('Forbidden.');
    const athlete = this.getAthlete(input.athleteId);
    if (!athlete) throw new Error('Athlete not found.');
    const coefficientSet = this.activeCoefficientSet(input.athleteId);
    const priorSessions = this.listSessions(user, input.athleteId);
    const result = calculateSessionLoad(input, athlete, coefficientSet, priorSessions);
    const id = randomUUID();
    const createdAt = nowIso();
    this.insertSessionRow(id, input, result, createdAt, createdAt);
    this.insertLoadMetric(id, input, result, coefficientSet.version, createdAt);
    this.audit(user.id, 'session:create', 'training_session', id, { athleteId: input.athleteId, discipline: input.discipline });
    return this.getSession(id) as TrainingSession;
  }

  updateSession(user: User, id: string, patch: Partial<TrainingSessionInput>): TrainingSession {
    const current = this.getSession(id);
    if (!current) throw new Error('Session not found.');
    if (!this.canAccessAthlete(user, current.athleteId)) throw new Error('Forbidden.');
    const input: TrainingSessionInput = {
      athleteId: current.athleteId,
      date: current.date,
      discipline: current.discipline,
      sessionType: current.sessionType,
      distanceMeters: current.distanceMeters,
      durationSeconds: current.durationSeconds,
      perceivedExertion: current.perceivedExertion,
      averageHeartRateBpm: current.averageHeartRateBpm,
      maxHeartRateBpm: current.maxHeartRateBpm,
      swimPaceSecondsPer100m: current.swimPaceSecondsPer100m,
      runPaceSecondsPerKm: current.runPaceSecondsPerKm,
      bikePowerWatts: current.bikePowerWatts,
      cadence: current.cadence,
      brickParentId: current.brickParentId,
      notes: current.notes,
      ...patch,
    };
    const athlete = this.getAthlete(input.athleteId);
    if (!athlete) throw new Error('Athlete not found.');
    const coefficientSet = this.activeCoefficientSet(input.athleteId);
    const priorSessions = this.listSessions(user, input.athleteId).filter((session) => session.id !== id);
    const result = calculateSessionLoad(input, athlete, coefficientSet, priorSessions);
    this.insertSessionRow(id, input, result, current.createdAt, nowIso(), true);
    this.db.prepare('DELETE FROM load_metrics WHERE session_id = ?').run(id);
    this.insertLoadMetric(id, input, result, coefficientSet.version, nowIso());
    this.audit(user.id, 'session:update', 'training_session', id, patch);
    return this.getSession(id) as TrainingSession;
  }

  deleteSession(user: User, id: string) {
    const current = this.getSession(id);
    if (!current) return;
    if (!this.canAccessAthlete(user, current.athleteId)) throw new Error('Forbidden.');
    this.db.prepare('DELETE FROM training_sessions WHERE id = ?').run(id);
    this.audit(user.id, 'session:delete', 'training_session', id, {});
  }

  recomputeSessions(user: User, athleteId: string): TrainingSession[] {
    if (!this.canAccessAthlete(user, athleteId)) throw new Error('Forbidden.');
    const sessions = this.listSessions(user, athleteId).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    for (const session of sessions) {
      this.updateSession(user, session.id, {});
    }
    this.audit(user.id, 'session:recompute', 'athlete', athleteId, { count: sessions.length });
    return this.listSessions(user, athleteId);
  }

  getReadiness(user: User, athleteId: string, date: string): ReadinessSnapshot {
    if (!this.canAccessAthlete(user, athleteId)) throw new Error('Forbidden.');
    const row = this.db.prepare('SELECT * FROM readiness_snapshots WHERE athlete_id = ? AND date = ?').get(athleteId, date);
    if (row) return parseJson<ReadinessSnapshot>(row.payload_json, {} as ReadinessSnapshot);
    return this.calculateAndStoreReadiness(user, athleteId, date);
  }

  calculateAndStoreReadiness(user: User, athleteId: string, date: string): ReadinessSnapshot {
    if (!this.canAccessAthlete(user, athleteId)) throw new Error('Forbidden.');
    const coefficientSet = this.activeCoefficientSet(athleteId);
    const sessions = this.listSessions(user, athleteId);
    const id = randomUUID();
    const createdAt = nowIso();
    const payload: ReadinessSnapshot = {
      id,
      createdAt,
      ...calculateReadiness(athleteId, date, sessions, coefficientSet),
    };
    this.db.prepare(`
      INSERT INTO readiness_snapshots (id, athlete_id, date, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(athlete_id, date) DO UPDATE SET
        id = excluded.id,
        payload_json = excluded.payload_json,
        created_at = excluded.created_at
    `).run(id, athleteId, date, JSON.stringify(payload), createdAt);
    this.audit(user.id, 'readiness:calculate', 'readiness_snapshot', id, { athleteId, date });
    return payload;
  }

  listCalibrationTests(user: User, athleteId: string): CalibrationTest[] {
    if (!this.canAccessAthlete(user, athleteId)) throw new Error('Forbidden.');
    return this.db.prepare('SELECT * FROM calibration_tests WHERE athlete_id = ? ORDER BY test_date DESC').all(athleteId)
      .map((row) => this.calibrationFromRow(row));
  }

  createCalibrationTest(user: User, input: Omit<CalibrationTest, 'id' | 'createdAt'>): CalibrationTest {
    if (!this.canAccessAthlete(user, input.athleteId)) throw new Error('Forbidden.');
    const id = randomUUID();
    const createdAt = nowIso();
    this.db.prepare(`
      INSERT INTO calibration_tests (
        id, athlete_id, test_type, test_date, protocol_data_json, measurements_json,
        results_json, is_valid, confidence_level, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.athleteId,
      input.testType,
      input.testDate,
      JSON.stringify(input.protocolData),
      JSON.stringify(input.measurements),
      JSON.stringify(input.results),
      input.isValid ? 1 : 0,
      input.confidenceLevel,
      createdAt,
    );
    this.audit(user.id, 'calibration:create', 'calibration_test', id, { athleteId: input.athleteId, testType: input.testType });
    return this.calibrationFromRow(this.db.prepare('SELECT * FROM calibration_tests WHERE id = ?').get(id) as Row);
  }

  private insertSessionRow(
    id: string,
    input: TrainingSessionInput,
    result: ReturnType<typeof calculateSessionLoad>,
    createdAt: string,
    updatedAt: string,
    replace = false,
  ) {
    const verb = replace ? 'INSERT OR REPLACE' : 'INSERT';
    this.db.prepare(`
      ${verb} INTO training_sessions (
        id, athlete_id, date, discipline, session_type, distance_meters, duration_seconds,
        perceived_exertion, average_hr_bpm, max_hr_bpm, swim_pace_seconds_per_100m,
        run_pace_seconds_per_km, bike_power_watts, cadence, brick_parent_id, notes,
        normalized_load, aerobic_load, anaerobic_load, confidence_level, calculation_trace_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.athleteId,
      input.date,
      input.discipline,
      input.sessionType,
      input.distanceMeters,
      input.durationSeconds,
      input.perceivedExertion,
      input.averageHeartRateBpm ?? null,
      input.maxHeartRateBpm ?? null,
      input.swimPaceSecondsPer100m ?? null,
      input.runPaceSecondsPerKm ?? null,
      input.bikePowerWatts ?? null,
      input.cadence ?? null,
      input.brickParentId ?? null,
      input.notes ?? null,
      result.normalizedLoad,
      result.aerobicLoad,
      result.anaerobicLoad,
      result.confidenceLevel,
      JSON.stringify(result.calculationTrace),
      createdAt,
      updatedAt,
    );
  }

  private insertLoadMetric(
    sessionId: string,
    input: TrainingSessionInput,
    result: ReturnType<typeof calculateSessionLoad>,
    coefficientVersion: string,
    createdAt: string,
  ) {
    this.db.prepare(`
      INSERT INTO load_metrics (
        id, session_id, athlete_id, date, discipline, normalized_load, aerobic_load, anaerobic_load,
        intensity_factor, source_coefficient_version, confidence_level, calculation_trace_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      sessionId,
      input.athleteId,
      input.date,
      input.discipline,
      result.normalizedLoad,
      result.aerobicLoad,
      result.anaerobicLoad,
      result.intensityFactor,
      coefficientVersion,
      result.confidenceLevel,
      JSON.stringify(result.calculationTrace),
      createdAt,
    );
  }

  private getSession(id: string): TrainingSession | undefined {
    const row = this.db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(id);
    return row ? this.sessionFromRow(row) : undefined;
  }

  private audit(actorUserId: string | undefined, action: string, entityType: string, entityId?: string, details: unknown = {}) {
    this.db.prepare(`
      INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), actorUserId ?? null, action, entityType, entityId ?? null, JSON.stringify(details), nowIso());
  }

  private userFromRow(row: Row): User {
    return {
      id: asString(row.id),
      email: asString(row.email),
      name: asString(row.name),
      role: asString(row.role) as Role,
    };
  }

  private athleteFromRow(row: Row): AthleteProfile {
    return {
      id: asString(row.id),
      userId: asString(row.user_id),
      name: asString(row.name),
      email: asString(row.email),
      dateOfBirth: asString(row.date_of_birth),
      gender: asString(row.gender) as AthleteProfile['gender'],
      specialtyDiscipline: asString(row.specialty_discipline) as AthleteProfile['specialtyDiscipline'],
      bodyMassKg: asNumber(row.body_mass_kg),
      swimCriticalVelocityMps: asNumber(row.swim_critical_velocity_mps),
      bikeFunctionalThresholdPowerWatts: asNumber(row.bike_ftp_watts),
      runCriticalVelocityMps: asNumber(row.run_critical_velocity_mps),
      restingHeartRateBpm: asNumber(row.resting_hr_bpm),
      maxHeartRateBpm: asNumber(row.max_hr_bpm),
      hrvBaselineRmssdMs: asNumber(row.hrv_baseline_rmssd_ms),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
  }

  private assignmentFromRow(row: Row): CoachAssignment {
    return {
      id: asString(row.id),
      coachUserId: asString(row.coach_user_id),
      athleteId: asString(row.athlete_id),
      status: asString(row.status) as CoachAssignment['status'],
      createdAt: asString(row.created_at),
    };
  }

  private coefficientFromRow(row: Row): CoefficientSet {
    return {
      id: asString(row.id),
      athleteId: row.athlete_id ? asString(row.athlete_id) : undefined,
      version: asString(row.version),
      name: asString(row.name),
      confidenceLevel: asString(row.confidence_level) as ConfidenceLevel,
      active: Number(row.active) === 1,
      constants: parseJson(row.constants_json, defaultCoefficientSet().constants),
      reviewedAt: row.reviewed_at ? asString(row.reviewed_at) : undefined,
      createdAt: asString(row.created_at),
    };
  }

  private sessionFromRow(row: Row): TrainingSession {
    return {
      id: asString(row.id),
      athleteId: asString(row.athlete_id),
      date: asString(row.date),
      discipline: asString(row.discipline) as Discipline,
      sessionType: asString(row.session_type) as TrainingSession['sessionType'],
      distanceMeters: Number(row.distance_meters),
      durationSeconds: Number(row.duration_seconds),
      perceivedExertion: Number(row.perceived_exertion),
      averageHeartRateBpm: asNumber(row.average_hr_bpm),
      maxHeartRateBpm: asNumber(row.max_hr_bpm),
      swimPaceSecondsPer100m: asNumber(row.swim_pace_seconds_per_100m),
      runPaceSecondsPerKm: asNumber(row.run_pace_seconds_per_km),
      bikePowerWatts: asNumber(row.bike_power_watts),
      cadence: asNumber(row.cadence),
      brickParentId: row.brick_parent_id ? asString(row.brick_parent_id) : undefined,
      notes: row.notes ? asString(row.notes) : undefined,
      normalizedLoad: Number(row.normalized_load),
      aerobicLoad: Number(row.aerobic_load),
      anaerobicLoad: Number(row.anaerobic_load),
      confidenceLevel: asString(row.confidence_level) as ConfidenceLevel,
      calculationTrace: parseJson(row.calculation_trace_json, {
        formulaVersion: 'unknown',
        sourceCoefficientVersion: 'unknown',
        confidenceLevel: 'estimated-default',
        inputs: {},
        steps: [],
        warnings: [],
      }),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
  }

  private calibrationFromRow(row: Row): CalibrationTest {
    return {
      id: asString(row.id),
      athleteId: asString(row.athlete_id),
      testType: asString(row.test_type) as CalibrationTest['testType'],
      testDate: asString(row.test_date),
      protocolData: parseJson(row.protocol_data_json, {}),
      measurements: parseJson(row.measurements_json, []),
      results: parseJson(row.results_json, {}),
      isValid: Number(row.is_valid) === 1,
      confidenceLevel: asString(row.confidence_level) as ConfidenceLevel,
      createdAt: asString(row.created_at),
    };
  }

  // --- Ecosystem sync (hub-and-spoke outbox; ttp-publish-to-hub) -----------

  ecosystemLinkFor(athleteId: string): string | undefined {
    const row = this.db.prepare('SELECT shared_athlete_id FROM ecosystem_athlete_links WHERE athlete_id = ?').get(athleteId);
    return row ? asString(row.shared_athlete_id) : undefined;
  }

  ecosystemStoreLink(athleteId: string, sharedAthleteId: string) {
    this.db.prepare(`
      INSERT INTO ecosystem_athlete_links (athlete_id, shared_athlete_id, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(athlete_id) DO UPDATE SET shared_athlete_id = excluded.shared_athlete_id
    `).run(athleteId, sharedAthleteId, nowIso());
  }

  ecosystemEnqueue(idempotencyKey: string, payloadType: string, athleteId: string, payloadJson: string): boolean {
    try {
      this.db.prepare(`
        INSERT INTO ecosystem_outbox (id, idempotency_key, payload_type, athlete_id, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), idempotencyKey, payloadType, athleteId, payloadJson, nowIso());
      return true;
    } catch {
      return false; // duplicate idempotency key — already queued/sent
    }
  }

  ecosystemPending(limit: number, maxAttempts: number) {
    return this.db
      .prepare('SELECT id, idempotency_key, payload_type, athlete_id, payload_json, attempts FROM ecosystem_outbox WHERE status = ? AND attempts < ? ORDER BY created_at ASC LIMIT ?')
      .all('pending', maxAttempts, limit)
      .map((row) => ({
        id: asString(row.id),
        idempotencyKey: asString(row.idempotency_key),
        payloadType: asString(row.payload_type),
        athleteId: asString(row.athlete_id),
        payloadJson: asString(row.payload_json),
        attempts: Number(row.attempts),
      }));
  }

  ecosystemMark(id: string, status: 'pending' | 'sent' | 'failed', attempts: number, lastError?: string) {
    this.db.prepare('UPDATE ecosystem_outbox SET status = ?, attempts = ?, last_error = ?, sent_at = ? WHERE id = ?')
      .run(status, attempts, lastError ?? null, status === 'sent' ? nowIso() : null, id);
  }
}
