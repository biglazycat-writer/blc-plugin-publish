import { useEffect, useMemo, useState, type DependencyList } from 'react';

// Give the page a frame before expensive preview work, and coalesce typing.
export function useScheduledValue<T>(compute: () => T, dependencies: DependencyList, initial: T) {
  const request = useMemo(() => ({ compute }), dependencies);
  const [state, setState] = useState<{ request?: typeof request; value: T; error: string }>({ value: initial, error: '' });
  useEffect(() => {
    const timer = setTimeout(() => {
      try { setState({ request, value: request.compute(), error: '' }); }
      catch (error) { setState(previous => ({ request, value: previous.value, error: String(error instanceof Error ? error.message : error) })); }
    }, 100);
    return () => clearTimeout(timer);
  }, [request]);
  return { value: state.value, pending: state.request !== request, error: state.error };
}
