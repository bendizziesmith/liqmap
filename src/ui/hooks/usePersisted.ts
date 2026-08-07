import { useCallback, useEffect, useState } from 'react';

/**
 * State mirrored into localStorage.
 *
 * A plain merge of stored-over-defaults is not enough on its own: it means the first value
 * a user ever received wins forever, so a changed default can never reach them. Callers
 * holding a versioned schema pass `migrate`, which decides what survives.
 */
export function usePersisted<T extends object>(
  key: string,
  fallback: T,
  migrate?: (raw: unknown) => T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (migrate) return migrate(raw ? JSON.parse(raw) : null);
      if (!raw) return fallback;
      return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
    } catch {
      return migrate ? migrate(null) : fallback;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Private browsing or a full quota. Losing persistence must not break the app.
    }
  }, [key, value]);

  const patch = useCallback((changes: Partial<T>) => {
    setValue((prev) => ({ ...prev, ...changes }));
  }, []);

  return [value, patch, setValue] as const;
}
