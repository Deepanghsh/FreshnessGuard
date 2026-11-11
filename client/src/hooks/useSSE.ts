import { useEffect, useRef, useState } from 'react';
import { subscribeToEvents } from '../api/client';

export function useSSE(onMessage: (data: unknown) => void) {
  const [connected, setConnected] = useState(false);
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;

  useEffect(() => {
    setConnected(false);
    const unsub = subscribeToEvents((data) => {
      const d = data as { type?: string };
      if (d?.type === 'connected' || d === null) setConnected(true);
      else { setConnected(true); cbRef.current(data); }
    });
    return unsub;
  }, []);

  return { connected };
}

