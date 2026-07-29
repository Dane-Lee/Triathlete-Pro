import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SyncPayloadType } from '../src/ecosystem-contracts/enums';
import {
  fetchHubStatus,
  loadConnectionSettings,
  outboundState,
  reportToHub,
  saveConnectionSettings,
  setConnectionState,
  shouldEnqueue,
  shouldTransmit,
} from './connectionSettings';

describe('connectionSettings', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ttp-connections-'));
    delete process.env.ATHLETEOS_HUB_URL;
    delete process.env.ATHLETEOS_SERVICE_KEY;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.ATHLETEOS_HUB_URL;
    delete process.env.ATHLETEOS_SERVICE_KEY;
  });

  it('defaults to open (on) for every flow when no file exists', () => {
    const settings = loadConnectionSettings(dir);
    expect(outboundState(settings, SyncPayloadType.ReadinessSnapshotUpsert)).toBe('on');
    expect(shouldEnqueue(outboundState(settings, SyncPayloadType.ReadinessSnapshotUpsert))).toBe(true);
    expect(shouldTransmit(outboundState(settings, SyncPayloadType.ReadinessSnapshotUpsert))).toBe(true);
  });

  it('degrades to default-open when the file contains malformed JSON', () => {
    writeFileSync(join(dir, 'ecosystem-connection-settings.json'), '{ not valid json', 'utf8');
    const settings = loadConnectionSettings(dir);
    expect(outboundState(settings, SyncPayloadType.ReadinessSnapshotUpsert)).toBe('on');
  });

  it('round-trips a saved setting through the JSON file next to the DB dir', () => {
    saveConnectionSettings(dir, {
      version: 1,
      outbound: { [SyncPayloadType.ReadinessSnapshotUpsert]: 'pause' },
      inbound: {},
      updatedAt: '1970-01-01T00:00:00.000Z',
    });

    const reloaded = loadConnectionSettings(dir);
    expect(outboundState(reloaded, SyncPayloadType.ReadinessSnapshotUpsert)).toBe('pause');

    const onDisk = JSON.parse(readFileSync(join(dir, 'ecosystem-connection-settings.json'), 'utf8'));
    expect(onDisk.outbound[SyncPayloadType.ReadinessSnapshotUpsert]).toBe('pause');
  });

  it('setConnectionState flips a single flow and persists it', () => {
    setConnectionState(dir, 'outbound', SyncPayloadType.ReadinessSnapshotUpsert, 'off');
    const settings = loadConnectionSettings(dir);
    expect(outboundState(settings, SyncPayloadType.ReadinessSnapshotUpsert)).toBe('off');
    expect(shouldEnqueue(outboundState(settings, SyncPayloadType.ReadinessSnapshotUpsert))).toBe(false);
    // Untouched flows stay default-open.
    expect(outboundState(settings, SyncPayloadType.AthleteUpsert)).toBe('on');
  });

  it('reportToHub is a no-op when the hub is not configured', async () => {
    const settings = loadConnectionSettings(dir);
    const fakeFetch = (async () => {
      throw new Error('must not be called');
    }) as typeof fetch;
    await expect(reportToHub(settings, fakeFetch)).resolves.toBeUndefined();
  });

  it('reportToHub PUTs the settings to the hub with the service key header when configured', async () => {
    process.env.ATHLETEOS_HUB_URL = 'http://hub.test';
    process.env.ATHLETEOS_SERVICE_KEY = 'sk';
    const settings = loadConnectionSettings(dir);
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init as RequestInit });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    await reportToHub(settings, fakeFetch);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://hub.test/api/ecosystem/connections');
    expect(calls[0].init.method).toBe('PUT');
    expect((calls[0].init.headers as Record<string, string>)['x-service-key']).toBe('sk');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ version: 1 });
  });

  it('reportToHub never throws even when the hub is unreachable', async () => {
    process.env.ATHLETEOS_HUB_URL = 'http://hub.test';
    process.env.ATHLETEOS_SERVICE_KEY = 'sk';
    const settings = loadConnectionSettings(dir);
    const fakeFetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;

    await expect(reportToHub(settings, fakeFetch)).resolves.toBeUndefined();
  });

  it('fetchHubStatus rejects before making a request when the hub is not configured', async () => {
    const fakeFetch = (async () => {
      throw new Error('must not be called');
    }) as typeof fetch;

    await expect(fetchHubStatus(fakeFetch)).rejects.toThrow(
      'AthleteOS hub is not configured'
    );
  });

  it('fetchHubStatus GETs status with the server-side service key when configured', async () => {
    process.env.ATHLETEOS_HUB_URL = 'http://hub.test/';
    process.env.ATHLETEOS_SERVICE_KEY = 'sk';
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init as RequestInit });
      return new Response(
        JSON.stringify({ generatedAt: '2026-07-29T00:00:00.000Z', apps: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    await expect(fetchHubStatus(fakeFetch)).resolves.toMatchObject({ apps: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://hub.test/api/ecosystem/status');
    expect(calls[0].init.method).toBeUndefined();
    expect((calls[0].init.headers as Record<string, string>)['x-service-key']).toBe('sk');
  });
});
