import { useCallback, useEffect, useState } from 'react';

/**
 * State mirrored into localStorage.
 *
 * Stored values are merged over the defaults rather than replacing them, so a settings
 * object saved by an older build does not leave newly added fields undefined.
 */
export function usePersisted<T extends object>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
    } catch {
      return fallback;
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
