import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TempoSettings } from '@/domain/takeTypes';
import { MetronomeControls } from '@/features/metronome/MetronomeControls';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { useTakeStore } from '@/state/useTakeStore';

function renderWithTempo(tempo: TempoSettings): HTMLSelectElement {
  useTakeStore.getState().setTempo(tempo);
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en', m: en }}>
      <MetronomeControls />
    </I18nContext.Provider>,
  );
  return screen.getByLabelText<HTMLSelectElement>(en.metronome.timeSignatureLabel);
}

function optionValues(select: HTMLSelectElement): string[] {
  return [...select.options].map((option) => option.value);
}

describe('MetronomeControls time signature select', () => {
  afterEach(cleanup);

  it('offers the preset list and selects 3/8 for a take like Für Elise', () => {
    const select = renderWithTempo({
      bpm: 70,
      timeSignature: { numerator: 3, denominator: 8 },
      countInBars: 0,
    });
    expect(select.value).toBe('3/8');
    expect(optionValues(select)).toEqual(['2/2', '2/4', '3/4', '3/8', '4/4', '6/8']);
  });

  it('selects 2/2 for an alla breve take like Moonlight Sonata', () => {
    const select = renderWithTempo({
      bpm: 54,
      timeSignature: { numerator: 2, denominator: 2 },
      countInBars: 0,
    });
    expect(select.value).toBe('2/2');
  });

  it('appends an unlisted signature instead of falling back to the first option', () => {
    const select = renderWithTempo({
      bpm: 120,
      timeSignature: { numerator: 5, denominator: 4 },
      countInBars: 1,
    });
    expect(select.value).toBe('5/4');
    const values = optionValues(select);
    expect(values).toEqual(['2/2', '2/4', '3/4', '3/8', '4/4', '6/8', '5/4']);
    expect(new Set(values).size).toBe(values.length);
  });
});
