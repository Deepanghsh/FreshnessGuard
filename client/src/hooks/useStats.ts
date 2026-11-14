import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type { StatsData } from '../types';

export function useStats(intervalMs = 5000) {
  const [stats, setStats]     = useState<StatsData | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(() => {
    api.getStats()
      .then(s => { setStats(s); setError(null); setLoading(false); })
      .catch(e => { setError((e as Error).message); setLoading(false); });
  }, []);

  useEffect(() => {
    fetchStats();
    const t = setInterval(fetchStats, intervalMs);
    return () => clearInterval(t);
  }, [fetchStats, intervalMs]);

  return { stats, error, loading, refetch: fetchStats };
}
