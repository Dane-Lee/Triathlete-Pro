/**
 * Per-flow connection settings for the Triathlete Energy Tracker's
 * server-side ecosystem sync (milestone eco-connection-settings; Control
 * Center ratification 2026-07-11, decision 3: hybrid pair->flow toggles with
 * three states).
 *
 * This app's hub sync runs entirely server-side (ecosystemSync.ts — the
 * service key never reaches the browser), so unlike the browser-side sibling
 * apps (which keep settings in localStorage), storage here is a JSON file
 * next to the SQLite DB, per the vendored contract's own doc comment: "a
 * JSON file next to the server DB for local-API apps". Settings are mirrored
 * to the hub (PUT /api/ecosystem/connections) so the Control Center can
 * render every app's switchboard from one place. Everything degrades
 * silently: a missing file, malformed JSON, an unwritable directory, or an
 * unreachable hub all read/report as default-open, preserving the
 * standalone guarantee (ecosystem rule 1).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CONNECTION_SETTINGS,
  parseConnectionSettings,
  type ConnectionSettings,
  type ConnectionState,
} from '../src/ecosystem-contracts/connections';
import type { SyncPayloadType } from '../src/ecosystem-contracts/enums';

export {
  inboundState,
  outboundState,
  shouldEnqueue,
  shouldTransmit,
} from '../src/ecosystem-contracts/connections';
export type { ConnectionSettings, ConnectionState };

const SETTINGS_FILENAME = 'ecosystem-connection-settings.json';

const hubUrl = () => process.env.ATHLETEOS_HUB_URL?.replace(/\/$/, '');
const serviceKey = () => process.env.ATHLETEOS_SERVICE_KEY;
const isHubConfigured = () => Boolean(hubUrl() && serviceKey());

const settingsPath = (dbDir: string) => join(dbDir, SETTINGS_FILENAME);

/**
 * Reads the current settings from the JSON file next to the SQLite DB.
 * Missing file, unreadable path, or malformed content all degrade to
 * default-open rather than throwing.
 */
export function loadConnectionSettings(dbDir: string): ConnectionSettings {
  try {
    const path = settingsPath(dbDir);
    if (!existsSync(path)) return DEFAULT_CONNECTION_SETTINGS;
    return parseConnectionSettings(readFileSync(path, 'utf8'));
  } catch {
    return DEFAULT_CONNECTION_SETTINGS;
  }
}

/**
 * Persists settings to the JSON file next to the SQLite DB. Never throws: a
 * write failure just leaves the in-memory default-open behavior in place.
 */
export function saveConnectionSettings(dbDir: string, settings: ConnectionSettings): ConnectionSettings {
  const stamped: ConnectionSettings = { ...settings, updatedAt: new Date().toISOString() };
  try {
    mkdirSync(dbDir, { recursive: true });
    writeFileSync(settingsPath(dbDir), JSON.stringify(stamped, null, 2), 'utf8');
  } catch {
    // Filesystem unavailable — settings stay effectively default-open.
  }
  return stamped;
}

/** Mutator: flip one flow and persist. */
export function setConnectionState(
  dbDir: string,
  direction: 'outbound' | 'inbound',
  payloadType: SyncPayloadType,
  state: ConnectionState
): ConnectionSettings {
  const current = loadConnectionSettings(dbDir);
  return saveConnectionSettings(dbDir, {
    ...current,
    [direction]: { ...current[direction], [payloadType]: state },
  });
}

/**
 * Mirrors settings to the hub so the Control Center can render this app's
 * switchboard. Fire-and-forget: never throws, no-ops when the hub isn't
 * configured. Report is cosmetic (panel freshness); enforcement is local.
 */
export async function reportToHub(
  settings: ConnectionSettings,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  if (!isHubConfigured()) return;
  try {
    await fetchImpl(`${hubUrl()}/api/ecosystem/connections`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-service-key': serviceKey() as string },
      body: JSON.stringify(settings),
    });
  } catch {
    // Hub unreachable — no-op; enforcement of pause/off is local regardless.
  }
}
