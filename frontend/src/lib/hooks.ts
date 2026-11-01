import { useCallback, useEffect, useState } from 'react';

/** Fetch on mount and whenever deps change; `reload()` refetches. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/** App-wide "data changed" signal so every page refreshes after an add/edit. */
const listeners = new Set<() => void>();
export const dataChanged = {
  emit: () => listeners.forEach((l) => l()),
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

export function useOnDataChanged(cb: () => void) {
  useEffect(() => dataChanged.subscribe(cb), [cb]);
}
