import type { Settings as SettingsValues } from '../config';
import type { AlertsState } from './hooks/useAlerts';
import { BellIcon, CloseIcon } from './icons';

interface Props {
  open: boolean;
  values: SettingsValues;
  alerts: AlertsState;
  onChange: (patch: Partial<SettingsValues>) => void;
  onClose: () => void;
}

export function Settings({ open, values, alerts, onChange, onClose }: Props) {
  if (!open) return null;

  const blocked = alerts.permission === 'denied' || alerts.permission === 'unsupported';

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="drawer__head">
          <h2>Settings</h2>
          <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Close settings">
            <CloseIcon />
          </button>
        </div>

        <section className="drawer__section">
          <h3>Proximity alerts</h3>

          <label className="field field--row">
            <input
              type="checkbox"
              checked={values.alertsEnabled}
              onChange={(e) => onChange({ alertsEnabled: e.target.checked })}
            />
            <span>Alert when price nears a strong band</span>
          </label>

          <label className="field" htmlFor="min-score">
            <span className="field__label">
              Minimum band strength <strong>{values.alertMinScore}</strong>
            </span>
            <input
              id="min-score"
              type="range"
              min={10}
              max={100}
              step={5}
              value={values.alertMinScore}
              onChange={(e) => onChange({ alertMinScore: Number(e.target.value) })}
            />
            <span className="field__hint">
              Relative to the strongest band on screen, where 100 is the strongest.
            </span>
          </label>

          <label className="field" htmlFor="distance">
            <span className="field__label">
              Trigger within <strong>{values.alertDistancePct}%</strong> of price
            </span>
            <input
              id="distance"
              type="range"
              min={0.1}
              max={5}
              step={0.1}
              value={values.alertDistancePct}
              onChange={(e) => onChange({ alertDistancePct: Number(e.target.value) })}
            />
          </label>

          {values.alertsEnabled && alerts.permission === 'default' && (
            <button type="button" className="btn btn--primary" onClick={alerts.request}>
              <BellIcon /> Allow notifications
            </button>
          )}

          {values.alertsEnabled && blocked && (
            <p className="note note--warn">
              {alerts.permission === 'unsupported'
                ? 'This browser has no Notification API.'
                : 'Notifications are blocked in your browser settings.'}{' '}
              Alerts will still appear in the list below.
            </p>
          )}
        </section>

        <section className="drawer__section">
          <h3>Recent alerts</h3>
          {alerts.log.length === 0 ? (
            <p className="note">Nothing yet.</p>
          ) : (
            <ul className="alerts">
              {alerts.log.map((a, i) => (
                <li key={`${a.symbol}-${a.price}-${a.at}-${i}`}>
                  <strong>{a.symbol}</strong>
                  <span>{a.price.toPrecision(6)}</span>
                  <span data-dir={a.distancePct >= 0 ? 'up' : 'down'}>
                    {Math.abs(a.distancePct).toFixed(2)}%
                  </span>
                  <span className="alerts__score">{a.score.toFixed(0)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="drawer__section">
          <h3>About the numbers</h3>
          <p className="note">
            Scores are relative estimates of where leveraged positions would be liquidated,
            derived from candles and open interest. They are not dollar amounts and not
            exchange-reported positions.
          </p>
        </section>
      </aside>
    </>
  );
}
