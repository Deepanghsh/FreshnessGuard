import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { subscribeToEvents } from '../api/client';
import type { StatsData } from '../types';

export function useStats(intervalMs = 5000) {
  const [stats, setStats]   = useState<StatsData | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = () =>
      api.getStats()
        .then(s => { setStats(s); setError(null); setLoading(false); })
        .catch(e => { setError((e as Error).message); setLoading(false); });
    fetch();
    const t = setInterval(fetch, intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);

  return { stats, error, loading };
}

