import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, migrateSettings } from '../config';

/** The exact blob a user from the smoothing era carries. */
const OLD_ERA = {
  alertMinScore: 55,
  alertDistancePct: 2.5,
  alertsEnabled: true,
  levelDecay: false,
  smoothRendering: true,
  wickClearing: 'partial',
  standingShare: 'current',
};

describe('settings migration', () => {
  it('drops keys the app no longer owns', () => {
    const out = migrateSettings(OLD_ERA);
    expect('smoothRendering' in out).toBe(false);
    expect('somethingInvented' in migrateSettings({ ...OLD_ERA, somethingInvented: 1 })).toBe(false);
  });

  it('resets render and model settings to their shipped values', () => {
    // The whole point: shipping a corrected default is worthless if a value stored under
    // the old schema outlives it. A version bump means the model changed, so the model
    // settings go back to what ships.
    const out = migrateSettings(OLD_ERA);
    expect(out.levelDecay).toBe(DEFAULT_SETTINGS.levelDecay);
    expect(out.wickClearing).toBe(DEFAULT_SETTINGS.wickClearing);
    expect(out.standingShare).toBe(DEFAULT_SETTINGS.standingShare);
  });

  it('keeps personal preferences that no default change invalidates', () => {
    const out = migrateSettings(OLD_ERA);
    expect(out.alertMinScore).toBe(55);
    expect(out.alertDistancePct).toBe(2.5);
    expect(out.alertsEnabled).toBe(true);
  });

  it('stamps the current version so it migrates exactly once', () => {
    const once = migrateSettings(OLD_ERA);
    expect(once.v).toBe(SETTINGS_VERSION);
    // Already-current settings pass through untouched, including chosen model settings.
    const chosen = { ...once, wickClearing: 'partial' as const };
    expect(migrateSettings(chosen)).toEqual(chosen);
  });

  it('returns shipped defaults for junk, null or a missing blob', () => {
    for (const junk of [null, undefined, 'nonsense', 42, [], { v: 'x' }]) {
      const out = migrateSettings(junk);
      expect(out.wickClearing).toBe(DEFAULT_SETTINGS.wickClearing);
      expect(out.v).toBe(SETTINGS_VERSION);
    }
  });

  it('fills in a key added after the user last saved', () => {
    const partial = { v: SETTINGS_VERSION, alertMinScore: 80 };
    const out = migrateSettings(partial);
    expect(out.standingShare).toBe(DEFAULT_SETTINGS.standingShare);
    expect(out.alertMinScore).toBe(80);
  });

  it('never yields a settings object carrying an unknown key', () => {
    const out = migrateSettings({ ...OLD_ERA, v: 1, ghost: true, smooth: true });
    for (const k of Object.keys(out)) {
      expect(k === 'v' || k in DEFAULT_SETTINGS).toBe(true);
    }
  });
});

describe('an old-schema blob loads clean', () => {
  it('leaves nothing for a renderer to read as "smooth"', () => {
    // The exact localStorage a smoothing-era user carries. Whatever survives migration is
    // what the app runs on, and no key in it may switch smoothing back on — there is no
    // such key any more.
    const out = migrateSettings({
      alertMinScore: 70, alertDistancePct: 1.5, alertsEnabled: false,
      levelDecay: true, smoothRendering: true, wickClearing: 'partial',
      standingShare: 'highLeverage',
    });
    expect(JSON.stringify(out)).not.toContain('smooth');
    expect(out.wickClearing).toBe('full');
  });

  it('survives a blob from before any of these keys existed', () => {
    const ancient = { alertMinScore: 70, alertDistancePct: 1.5, alertsEnabled: false };
    const out = migrateSettings(ancient);
    expect(out).toEqual({ ...DEFAULT_SETTINGS, v: SETTINGS_VERSION });
  });
});
