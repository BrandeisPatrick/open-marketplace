import { useEffect, useState } from 'react';
import { getHealth } from '../api';
import { errorText } from '../lib/format';
import type { Health } from '../types';

/** `/api/health`, re-polled every 30s (5s while the server is unreachable). */
export function useHealth(): { health: Health | null; error: string | null; loading: boolean } {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await getHealth();
        if (!alive) return;
        // Keep the old object when nothing changed so consumers don't re-render.
        setHealth((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
        setError(null);
        timer = window.setTimeout(poll, 30_000);
      } catch (err) {
        if (!alive) return;
        setError(errorText(err));
        timer = window.setTimeout(poll, 5_000);
      }
    };
    void poll();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  return { health, error, loading: health === null && error === null };
}
