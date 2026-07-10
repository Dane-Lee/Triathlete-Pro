/**
 * Ecosystem hub publishing for the Triathlete Energy Tracker (milestones
 * ttp-adopt-shared-contracts / ttp-publish-to-hub / ttp-sentios-signals).
 *
 * Runs entirely SERVER-SIDE: the service key never reaches the browser
 * (APPROACH_SUGGESTIONS S2 satisfied by construction). Readiness snapshots
 * queue in the SQLite outbox and drain opportunistically to the AthleteOS
 * hub; hub down = app unaffected. Everything is a no-op unless configured:
 *
 *   ATHLETEOS_HUB_URL      hub base URL, e.g. http://localhost:3001
 *   ATHLETEOS_SERVICE_KEY  triathletePro service key (x-service-key header)
 *   SENTIOS_URL            SentiOS local API (default http://127.0.0.1:4777)
 *   SENTIOS_API_KEY        SentiOS key; senti emission disabled when unset
 */
import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './db';
import type { ReadinessSnapshot } from '../src/shared/domain';
import { buildTriathlonReadinessDraft } from '../src/shared/ecosystemEnvelope';
import { SourceApp, SyncPayloadType } from '../src/ecosystem-contracts/enums';
import { SYNC_SCHEMA_VERSION } from '../src/ecosystem-contracts/envelope';

const PAYLOAD_SCHEMA_VERSION = '1.0.0';
const MAX_ATTEMPTS = 10;
const DRAIN_BATCH = 100;
const DRAIN_INTERVAL_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 45_000;

const hubUrl = () => process.env.ATHLETEOS_HUB_URL?.replace(/\/$/, '');
const serviceKey = () => process.env.ATHLETEOS_SERVICE_KEY;
export const isHubConfigured = () => Boolean(hubUrl() && serviceKey());

const sentiUrl = () => (process.env.SENTIOS_URL ?? 'http://127.0.0.1:4777').replace(/\/$/, '');
const sentiKey = () => process.env.SENTIOS_API_KEY;

export interface DrainReport {
  accepted: number;
  conflicts: number;
  rejected: number;
  skipped: number;
  transportFailed: number;
}

export class EcosystemSync {
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private readonly db: AppDatabase,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  /** Fail-silent SentiSignal (module TriathleteTracker). */
  emitSenti(event: string, category: 'operational' | 'sync' | 'heartbeat', overrides: Record<string, unknown> = {}) {
    if (!sentiKey()) return;
    const signal = {
      module: 'TriathleteTracker',
      event,
      category,
      inbound: true,
      outbound: true,
      routing: 'complete',
      latency: 0,
      integrity: { ok: true },
      ts: new Date().toISOString(),
      optionalMetadata: { version: 'triathlete-energy-tracker' },
      ...overrides,
    };
    void this.fetchImpl(`${sentiUrl()}/senti/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sentios-api-key': sentiKey() as string },
      body: JSON.stringify(signal),
    }).catch(() => undefined);
  }

  /**
   * Queues a readiness snapshot for the hub. The snapshot's own id is the
   * idempotency key (recalculating a day upserts a NEW id, so a genuinely
   * recalculated day publishes again; the hub projection upserts by
   * athlete+date). Never throws.
   */
  publishReadiness(snapshot: ReadinessSnapshot): void {
    this.emitSenti('readiness_updated', 'operational');
    if (!isHubConfigured()) return;
    try {
      const draft = buildTriathlonReadinessDraft(snapshot);
      this.db.ecosystemEnqueue(
        snapshot.id,
        SyncPayloadType.ReadinessSnapshotUpsert,
        snapshot.athleteId,
        JSON.stringify(draft)
      );
      void this.drain();
    } catch (error) {
      console.warn('ecosystem publish skipped:', error);
    }
  }

  async resolveSharedAthleteId(athleteId: string): Promise<string | undefined> {
    const existing = this.db.ecosystemLinkFor(athleteId);
    if (existing) return existing;
    if (!isHubConfigured()) return undefined;

    try {
      const response = await this.fetchImpl(`${hubUrl()}/api/registry/athletes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-service-key': serviceKey() as string },
        body: JSON.stringify({ sourceAthleteId: athleteId, matchMethod: 'auto-resolve' }),
      });
      if (!response.ok) return undefined;
      const body = (await response.json()) as { sharedAthleteId?: string };
      if (!body.sharedAthleteId) return undefined;
      this.db.ecosystemStoreLink(athleteId, body.sharedAthleteId);
      return body.sharedAthleteId;
    } catch {
      return undefined;
    }
  }

  /** Pushes pending outbox rows to the hub. Never throws. */
  async drain(): Promise<DrainReport> {
    const report: DrainReport = { accepted: 0, conflicts: 0, rejected: 0, skipped: 0, transportFailed: 0 };
    if (!isHubConfigured()) return report;

    const rows = this.db.ecosystemPending(DRAIN_BATCH, MAX_ATTEMPTS);
    if (rows.length === 0) return report;

    const envelopes: Record<string, unknown>[] = [];
    const envelopeRows: typeof rows = [];
    for (const row of rows) {
      const sharedAthleteId = await this.resolveSharedAthleteId(row.athleteId);
      if (!sharedAthleteId) {
        report.skipped += 1;
        continue;
      }
      envelopes.push({
        syncSchemaVersion: SYNC_SCHEMA_VERSION,
        sourceApp: SourceApp.TriathletePro,
        exportedAt: new Date().toISOString(),
        idempotencyKey: row.idempotencyKey,
        payloadType: row.payloadType,
        payload: { ...JSON.parse(row.payloadJson), sharedAthleteId },
        payloadSchemaVersion: PAYLOAD_SCHEMA_VERSION,
      });
      envelopeRows.push(row);
    }
    if (envelopes.length === 0) return report;

    let results: { accepted?: boolean; conflictDetected?: boolean; remoteTraceId?: string }[];
    try {
      const response = await this.fetchImpl(`${hubUrl()}/api/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-service-key': serviceKey() as string },
        body: JSON.stringify({ envelopes }),
      });
      if (!response.ok) throw new Error(`hub push failed (${response.status})`);
      results = ((await response.json()) as { results?: typeof results }).results ?? [];
    } catch (error) {
      report.transportFailed = envelopeRows.length;
      for (const row of envelopeRows) {
        const attempts = row.attempts + 1;
        this.db.ecosystemMark(row.id, attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, String(error));
      }
      this.emitSenti('athlete_os_export_fail', 'sync', {
        routing: 'incomplete',
        integrity: { ok: false, details: String(error).slice(0, 200) },
      });
      return report;
    }

    envelopeRows.forEach((row, index) => {
      const result = results[index];
      const attempts = row.attempts + 1;
      if (result?.accepted || result?.conflictDetected) {
        this.db.ecosystemMark(row.id, 'sent', attempts, result.conflictDetected ? `conflict: ${result.remoteTraceId ?? ''}` : undefined);
        report[result.conflictDetected ? 'conflicts' : 'accepted'] += 1;
      } else {
        this.db.ecosystemMark(row.id, attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, result?.remoteTraceId ?? 'rejected by hub');
        report.rejected += 1;
      }
    });

    this.emitSenti('athlete_os_export_success', 'sync', {
      optionalMetadata: { version: 'triathlete-energy-tracker', opTime: report.accepted },
    });
    return report;
  }

  /** Interval drain + SentiOS heartbeat; call once at server start. */
  start(): void {
    if (sentiKey()) {
      this.emitSenti('triathlete_tracker_heartbeat', 'heartbeat');
      this.timers.push(setInterval(() => this.emitSenti('triathlete_tracker_heartbeat', 'heartbeat'), HEARTBEAT_INTERVAL_MS));
    }
    if (isHubConfigured()) {
      this.timers.push(setInterval(() => void this.drain(), DRAIN_INTERVAL_MS));
    }
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }
}

export const newIdempotencyKey = () => randomUUID();
