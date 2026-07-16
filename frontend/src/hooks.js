import { useCallback, useEffect, useState } from "react";

/**
 * Small data-loading hook: runs an async loader, exposes reload() for after mutations.
 * Replaces the prototype's single shared state object — each tab loads what it needs from the API.
 */
export function useLoad(loader, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    return loader()
      .then(setData)
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}

export const byId = (list) => Object.fromEntries((list || []).map((x) => [x.id, x]));
