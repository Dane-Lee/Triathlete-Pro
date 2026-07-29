import { useCallback, useEffect, useState } from 'react';

import type {
  ConnectionChange,
  EcosystemStatus,
} from '../ecosystem-control-center';
import { api } from './api';

export function useEcosystemControlCenter(enabled: boolean) {
  const [status, setStatus] = useState<EcosystemStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      setStatus(await api.ecosystemStatus());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Live ecosystem status is unavailable.',
      );
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const setConnection = useCallback(
    async (change: ConnectionChange) => {
      if (!status) return;
      const settings = await api.updateEcosystemConnection(status, change);
      setStatus((current) =>
        current
          ? {
              ...current,
              connections: [
                ...current.connections.filter(
                  (report) => report.app !== 'triathletePro',
                ),
                {
                  app: 'triathletePro',
                  settings,
                  reportedAt:
                    typeof settings.updatedAt === 'string'
                      ? settings.updatedAt
                      : new Date().toISOString(),
                },
              ],
            }
          : current,
      );
    },
    [status],
  );

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  return { status, loading, error, refresh, setConnection };
}
