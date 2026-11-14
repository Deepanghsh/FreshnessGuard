import { useEffect, useRef, useState } from 'react';
import { subscribeToEvents } from '../api/client';
import type { SSEEvent } from '../types';

export function useSSE(onMessage?: (data: SSEEvent) => void) {
  const [connected, setConnected] = useState(false);
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;

  useEffect(() => {
    setConnected(false);
    const unsub = subscribeToEvents((data) => {
      setConnected(true);
      if (cbRef.current) {
        cbRef.current(data);
      }
    });
    return unsub;
  }, []);

  return { connected };
}
