import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent, TempoSettings } from '@/domain/takeTypes';
import { MetronomeControls } from '@/features/metronome/MetronomeControls';
import { transportController } from '@/features/transport/transportController';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { useTakeStore } from '@/state/useTakeStore';

function renderControls(): void {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en', m: en }}>
      <MetronomeControls />
    </I18nContext.Provider>,
  );
}

function renderWithTempo(tempo: TempoSettings): HTMLSelectElement {
  useTakeStore.getState().setTempo(tempo);
  renderControls();
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

/** A take of `count` bars of quarter notes at 96 bpm in 4/4 (2500 ms bars). */
function fourFourTake(tempo: Partial<TempoSettings> = {}, bars = 12): void {
  const notes: NoteEvent[] = [];
  for (let beat = 0; beat < bars * 4; beat += 1) {
    notes.push({
      id: `n${beat}`,
      midi: 60,
      startMs: beat * 625,
      durationMs: 600,
      velocity: 0.7,
    });
  }
  useTakeStore.getState().setTake(
    createEmptyTake({
      notes,
      tempo: { bpm: 96, timeSignature: { numerator: 4, denominator: 4 }, countInBars: 1, ...tempo },
    }),
  );
}

function bpmField(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(en.metronome.bpmLabel);
}

function typeBpm(value: string): void {
  const field = bpmField();
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

describe('MetronomeControls tempo editing', () => {
  afterEach(() => {
    cleanup();
    transportController.seek(0);
  });

  it('edits the take’s tempo at the start', () => {
    fourFourTake();
    transportController.seek(0);
    renderControls();

    expect(screen.queryByText(/from bar/)).toBeNull();
    typeBpm('120');

    const { tempo } = useTakeStore.getState().take;
    expect(tempo.bpm).toBe(120);
    expect(tempo.changes).toBeUndefined();
  });

  it('writes a tempo change from the nearest bar line when stopped mid-take', () => {
    fourFourTake();
    transportController.seek(9800); // just shy of bar 5 (10 000 ms)
    renderControls();

    // The hint names the bar the edit will start at.
    expect(screen.getByText(en.metronome.tempoFromBar({ bar: 5 }))).toBeInTheDocument();
    typeBpm('120');

    const { tempo } = useTakeStore.getState().take;
    expect(tempo.bpm).toBe(96); // the opening tempo is untouched
    expect(tempo.changes).toEqual([{ atMs: 10_000, bpm: 120 }]);
    // The playhead parks on that bar line, ready to record the next part.
    expect(transportController.getPlayheadMs()).toBe(10_000);
  });

  it('shows the tempo in force at the playhead, not the opening tempo', () => {
    fourFourTake({ changes: [{ atMs: 10_000, bpm: 120 }] });
    transportController.seek(12_000);
    renderControls();

    expect(bpmField().value).toBe('120');
    expect(useTakeStore.getState().take.tempo.bpm).toBe(96); // still the opening tempo
  });

  it('steps the tempo in force at the playhead', () => {
    fourFourTake({ changes: [{ atMs: 10_000, bpm: 120 }] });
    transportController.seek(10_000);
    renderControls();

    fireEvent.click(screen.getByLabelText(en.metronome.increaseTempo));
    expect(useTakeStore.getState().take.tempo.changes).toEqual([{ atMs: 10_000, bpm: 121 }]);
  });

  it('removes the change when the tempo is set back to the one before it', () => {
    fourFourTake({ changes: [{ atMs: 10_000, bpm: 120 }] });
    transportController.seek(10_000);
    renderControls();

    typeBpm('96');
    expect(useTakeStore.getState().take.tempo.changes).toBeUndefined();
  });

  it('edits the whole take when it has nothing recorded yet', () => {
    useTakeStore.getState().setTake(
      createEmptyTake({
        tempo: { bpm: 96, timeSignature: { numerator: 4, denominator: 4 }, countInBars: 1 },
      }),
    );
    transportController.seek(0);
    renderControls();

    expect(screen.queryByText(/from bar/)).toBeNull();
    typeBpm('132');
    expect(useTakeStore.getState().take.tempo).toMatchObject({ bpm: 132 });
    expect(useTakeStore.getState().take.tempo.changes).toBeUndefined();
  });
});
