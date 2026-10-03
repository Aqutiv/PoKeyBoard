import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data/db';
import { loadSettings, saveSettings } from '@/data/settingsRepository';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { catalogs } from './allCatalogs';
import { en } from '@/i18n/en';
import type { Messages } from '@/i18n/types';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

/** Recursively collect the shape of a catalog: nested key paths, marking
 * whether each leaf is a function (dynamic entry) or a string. */
function shape(value: unknown, prefix = ''): string[] {
  if (typeof value === 'function') return [`${prefix}=fn`];
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .flatMap((key) => shape((value as Record<string, unknown>)[key], `${prefix}${key}.`));
  }
  return [`${prefix}=str`];
}

describe('i18n catalogs', () => {
  it('exposes exactly the four supported languages', () => {
    expect(Object.keys(catalogs).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  it('every locale has the same keys and value kinds as English', () => {
    const reference = shape(en as unknown as Messages);
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(shape(catalogs[lang]), `catalog ${lang} shape`).toEqual(reference);
    }
  });

  it('dynamic entries interpolate their parameters', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const m = catalogs[lang];
      expect(m.score.label({ count: 3 })).toContain('3');
      expect(m.play.fallingLabel({ count: 7 })).toContain('7');
      expect(m.about.version({ version: '9.9.9' })).toContain('9.9.9');
      expect(m.metronome.on({ bpm: 128 })).toContain('128');
    }
  });

  it('practice results interpolate their counts, bars and passes', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const m = catalogs[lang];
      expect(m.practice.rightFirstTime({ good: 8, total: 10 }), lang).toMatch(/8\D+10/);
      expect(m.practice.accuracy({ percent: 80 }), lang).toContain('80');
      for (const count of [1, 3]) {
        expect(m.practice.wrongKeys({ count }), lang).toContain(String(count));
        expect(m.practice.wrongKeysShort({ count }), lang).toContain(String(count));
        expect(m.practice.letThrough({ count }), lang).toContain(String(count));
        expect(m.practice.slowHolds({ count }), lang).toContain(String(count));
        expect(m.practice.inFlow({ count }), lang).toContain(String(count));
      }
      expect(m.practice.atSpeed({ percent: 60 }), lang).toContain('60');
      expect(m.practice.sectionCell({ from: 5, to: 8, good: 3, total: 4 }), lang).toMatch(
        /5–8\D+3\D+4/,
      );
      expect(m.practice.sectionCell({ from: 9, to: 9, good: 1, total: 1 }), lang).not.toContain(
        '–',
      );
      expect(m.practice.loopSection({ bars: 1 }), lang).not.toBe(
        m.practice.loopSection({ bars: 4 }),
      );
      expect(m.practice.passCell({ pass: 6, good: 3, total: 4 }), lang).toMatch(/6\D+3\D+4/);
      expect(m.practice.summaryWait({ facts: '8 / 10' }), lang).toContain('8 / 10');
    }
  });
});

describe('language setting persistence', () => {
  beforeEach(async () => {
    await db.settings.clear();
    useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
  });

  it('defaults to English', () => {
    expect(useSettingsStore.getState().language).toBe('en');
  });

  it('round-trips a chosen language through the settings repository', async () => {
    useSettingsStore.getState().setLanguage('mg');
    await saveSettings(useSettingsStore.getState());
    const loaded = await loadSettings();
    expect(loaded.language).toBe('mg');
  });
});
