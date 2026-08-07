import type { Settings as SettingsValues } from '../config';
import type { AlertsState } from './hooks/useAlerts';
import { BellIcon, CloseIcon } from './icons';
import type { PriceFormatter } from './hooks/usePriceFormat';
import { COLORMAPS, colormapIds, type ColormapId } from '../engine/classes';

interface Props {
  open: boolean;
  values: SettingsValues;
  alerts: AlertsState;
  onChange: (patch: Partial<SettingsValues>) => void;
  onClose: () => void;
  formatPrice: PriceFormatter;
  colormap: ColormapId;
  onColormap: (id: ColormapId) => void;
}

export function Settings({
  open,
  values,
  alerts,
  onChange,
  onClose,
  formatPrice,
  colormap,
  onColormap,
}: Props) {
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
          <h3>Heat colours</h3>
          <div className="seg seg--stack" role="group" aria-label="Colormap">
            {colormapIds().map((id) => (
              <button
                key={id}
                type="button"
                className="seg__btn"
                aria-pressed={colormap === id}
                onClick={() => onColormap(id)}
              >
                {COLORMAPS[id].label}
              </button>
            ))}
          </div>
          <div className="ramp" aria-hidden="true">
            {COLORMAPS[colormap].classColors.map((c, i) => (
              <span key={i} style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }} />
            ))}
          </div>
          <span className="field__hint">
            Five intensity classes, lightest to heaviest. Applies to the heatmap, the side
            panel and the Map.
          </span>
        </section>

        <section className="drawer__section">
          <h3>Model</h3>

          <label className="field field--row">
            <input
              type="checkbox"
              checked={values.levelDecay}
              onChange={(e) => onChange({ levelDecay: e.target.checked })}
            />
            <span>Level decay</span>
          </label>
          <span className="field__hint">
            Levels only disappear when price trades through them — but most positions are
            closed long before they are liquidated, so old untouched levels are ghosts. Decay
            ages them out by leverage (100× lasts hours, 3× lasts months). Turn it off to see
            the raw clearing-only book.
          </span>

          <div className="field">
            <span className="field__label">Wick clearing</span>
            <div className="seg" role="group" aria-label="Wick clearing">
              {(['partial', 'full'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="seg__btn"
                  aria-pressed={values.wickClearing === mode}
                  onClick={() => onChange({ wickClearing: mode })}
                >
                  {mode === 'partial' ? 'Partial' : 'Full'}
                </button>
              ))}
            </div>
            <span className="field__hint">
              A fast wick doesn't liquidate every position it touches — exchanges use mark
              price, and traders add margin. Partial keeps half of what only a wick swept;
              candle bodies always clear fully. Full is the strict original rule.
            </span>
          </div>

          <label className="field field--row">
            <input
              type="checkbox"
              checked={values.smoothRendering}
              onChange={(e) => onChange({ smoothRendering: e.target.checked })}
            />
            <span>Smooth rendering</span>
          </label>
          <span className="field__hint">
            Softens band edges where the heat is scaled up, and the side panel's bars with
            them. Off draws crisp blocky buckets. Display only — no figure changes either way.
          </span>
        </section>

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
                  <span>{formatPrice(a.price)}</span>
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
            Figures are estimated USD notional, modelled from candle turnover and open
            interest — not exchange-reported open positions. Prices use each instrument's
            own tick size.
          </p>
          <p className="note note--build">
            build <code>{__BUILD_ID__}</code>
          </p>
        </section>
      </aside>
    </>
  );
}
