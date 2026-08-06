import { useCallback, useEffect, useRef, useState } from 'react';
import type { Band } from '../../engine/types';
import { alertCandidates, alertKey, dueAlerts, type AlertCandidate } from '../../engine/alerts';
import { ALERT_COOLDOWN_MS, type Settings } from '../../config';

export type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

function currentPermission(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as PermissionState;
}

export interface AlertsState {
  permission: PermissionState;
  request: () => Promise<void>;
  /** Recent firings, newest first. Also the fallback UI when notifications are blocked. */
  log: Array<AlertCandidate & { symbol: string; at: number }>;
}

/**
 * Watch the focused symbol's bands and notify when a strong one gets close.
 *
 * Firing is keyed per band with a cooldown, so a price oscillating around a level produces
 * one notification rather than a stream. If permission is missing or denied the alert still
 * lands in `log`, which the UI shows in-app — a blocked notification must not mean a
 * silently dropped signal.
 */
export function useAlerts(
  symbol: string,
  price: number | null,
  bands: Band[],
  settings: Settings,
): AlertsState {
  const [permission, setPermission] = useState<PermissionState>(currentPermission);
  const [log, setLog] = useState<AlertsState['log']>([]);
  const lastFired = useRef(new Map<string, number>());

  // A different symbol has its own levels; old cooldowns do not apply.
  useEffect(() => {
    lastFired.current.clear();
    setLog([]);
  }, [symbol]);

  const request = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setPermission(result as PermissionState);
  }, []);

  useEffect(() => {
    if (!settings.alertsEnabled || price == null || price <= 0 || bands.length === 0) return;

    const candidates = alertCandidates(
      bands,
      price,
      settings.alertDistancePct,
      settings.alertMinScore,
    );
    const now = Date.now();
    const due = dueAlerts(symbol, candidates, lastFired.current, now, ALERT_COOLDOWN_MS);
    if (due.length === 0) return;

    for (const c of due) {
      lastFired.current.set(alertKey(symbol, c.price), now);

      if (permission === 'granted') {
        const side = c.distancePct >= 0 ? 'above' : 'below';
        new Notification(`${symbol} approaching liquidation band`, {
          body: `Strength ${c.score.toFixed(0)} at ${c.price.toPrecision(6)} — ${Math.abs(
            c.distancePct,
          ).toFixed(2)}% ${side} price`,
          tag: alertKey(symbol, c.price),
        });
      }
    }

    setLog((l) => [...due.map((c) => ({ ...c, symbol, at: now })), ...l].slice(0, 20));
  }, [symbol, price, bands, settings, permission]);

  return { permission, request, log };
}
