import { useCallback, useEffect, useState } from 'react';

/**
 * Run an async loader and track loading/error state.
 * `reload()` refetches (used after mutations). Pass deps that should retrigger it.
 * While refetching, the previous `data` is kept so the page doesn't flash.
 * @param {() => Promise<any>} loader
 * @param {Array} deps
 */
export default function useFetch(loader, deps = []) {
  const [tick, setTick] = useState(0);
  const [result, setResult] = useState({ key: null, data: null, error: null });
  const key = JSON.stringify([...deps, tick]);

  useEffect(() => {
    let cancelled = false;
    loader()
      .then((data) => !cancelled && setResult({ key, data, error: null }))
      .catch((error) => !cancelled && setResult((prev) => ({ key, data: prev.data, error })));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data: result.data, error: result.error, loading: result.key !== key, reload };
}
