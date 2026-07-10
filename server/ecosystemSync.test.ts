import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from './db';
import { EcosystemSync } from './ecosystemSync';
import type { ReadinessSnapshot } from '../src/shared/domain';

const SHARED_ID = '11111111-1111-4111-8111-111111111111';

const snapshot = (id: string): ReadinessSnapshot => ({
  id,
  athleteId: 'athlete-1',
  date: '2026-07-10',
  swim: baseDiscipline('swim'),
  bike: baseDiscipline('bike'),
  run: baseDiscipline('run'),
  overallScore: 72,
  overallState: 'ready',
  limitingDiscipline: 'run',
  recommendation: 'Proceed as planned.',
  sourceCoefficientVersion: 'coeff-v1',
  confidenceLevel: 'partially-calibrated',
  warnings: [],
  calculationTrace: {
    formulaVersion: 'model-v1',
    sourceCoefficientVersion: 'coeff-v1',
    confidenceLevel: 'partially-calibrated',
    inputs: {},
    steps: [],
    warnings: [],
  },
  createdAt: '2026-07-10T08:00:00.000Z',
});

function baseDiscipline(discipline: 'swim' | 'bike' | 'run') {
  return {
    discipline,
    acuteLoad: 100,
    chronicLoad: 90,
    fatigueIndex: 0.3,
    adaptationIndex: 0.7,
    carryoverPenalty: 0,
    readinessScore: 72,
    state: 'ready' as const,
  };
}

describe('EcosystemSync', () => {
  let dir: string;
  let db: AppDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttp-sync-'));
    db = new AppDatabase(join(dir, 'test.sqlite'));
    process.env.ATHLETEOS_HUB_URL = 'http://hub.test';
    process.env.ATHLETEOS_SERVICE_KEY = 'sk';
    delete process.env.SENTIOS_API_KEY;
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.ATHLETEOS_HUB_URL;
    delete process.env.ATHLETEOS_SERVICE_KEY;
  });

  it('publishes a snapshot and drains it to the hub with the canonical athlete id', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ url, body });
      if (url.endsWith('/api/registry/athletes')) {
        return new Response(JSON.stringify({ sharedAthleteId: SHARED_ID, created: true }), { status: 200 });
      }
      const envelopes = (body as { envelopes: { idempotencyKey: string }[] }).envelopes;
      return new Response(
        JSON.stringify({
          results: envelopes.map((env) => ({ idempotencyKey: env.idempotencyKey, accepted: true, conflictDetected: false })),
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const sync = new EcosystemSync(db, fakeFetch);
    sync.publishReadiness(snapshot('snap-1'));
    // publishReadiness fires a drain internally; run one more to settle.
    const report = await sync.drain();

    const pushCall = calls.find((call) => call.url.endsWith('/api/sync/push'));
    expect(pushCall).toBeDefined();
    const envelope = (pushCall!.body as { envelopes: Record<string, unknown>[] }).envelopes[0];
    expect(envelope.sourceApp).toBe('triathletePro');
    expect(envelope.payloadType).toBe('readinessSnapshotUpsert');
    expect((envelope.payload as { sharedAthleteId: string }).sharedAthleteId).toBe(SHARED_ID);
    expect((envelope.payload as { globalReadinessCategory: string }).globalReadinessCategory).toBe('green');

    // Everything accepted across the internal + explicit drains.
    expect(report.rejected).toBe(0);
    expect(report.transportFailed).toBe(0);
    expect(db.ecosystemPending(10, 10)).toHaveLength(0);
  });

  it('re-publishing the same snapshot id does not enqueue a duplicate', () => {
    const sync = new EcosystemSync(db, (async () => {
      throw new Error('offline');
    }) as typeof fetch);
    sync.publishReadiness(snapshot('snap-dup'));
    sync.publishReadiness(snapshot('snap-dup'));
    expect(db.ecosystemPending(10, 10)).toHaveLength(1);
  });

  it('keeps rows pending with stable keys when the hub is unreachable', async () => {
    const sync = new EcosystemSync(db, (async () => {
      throw new Error('hub unreachable');
    }) as typeof fetch);
    sync.publishReadiness(snapshot('snap-off'));
    const report = await sync.drain();

    // Offline, athlete-link resolution fails first: the row is SKIPPED (not
    // attempted), so it stays pending with its key intact and no attempt burn.
    expect(report.skipped).toBe(1);
    const pending = db.ecosystemPending(10, 10);
    expect(pending).toHaveLength(1);
    expect(pending[0].idempotencyKey).toBe('snap-off');
    expect(pending[0].attempts).toBe(0);
  });

  it('is a complete no-op when the hub is not configured', async () => {
    delete process.env.ATHLETEOS_HUB_URL;
    delete process.env.ATHLETEOS_SERVICE_KEY;
    const sync = new EcosystemSync(db, (async () => {
      throw new Error('must not be called');
    }) as typeof fetch);
    sync.publishReadiness(snapshot('snap-noop'));
    const report = await sync.drain();
    expect(report.accepted).toBe(0);
    expect(db.ecosystemPending(10, 10)).toHaveLength(0);
  });
});
