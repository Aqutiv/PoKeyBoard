/**
 * Throwaway measurement of the vendored classics pack (see the plan's
 * verification section). Writes one JSON digest per run so the same run can be
 * compared across a code change.
 *
 *   npx vitest run --config vitest.tools.config.ts -t 'measure short values'
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { it } from 'vitest';
import { musicXmlToTake } from '@/domain/musicXmlImport';
import { extractMusicXmlText } from '@/domain/mxlContainer';
import { layoutScore } from '@/features/notation/notationLayout';
import { barUnits, UNITS_PER_WHOLE } from '@/features/notation/rests';
import { beatsForSymbol, type DurationSymbol } from '@/features/notation/quantization';
import type { QuantizationSetting, Take } from '@/domain/takeTypes';

const SCORES_DIR = path.resolve(process.cwd(), 'public/scores/classics-v1');
const OUT = process.env.MEASURE_OUT ?? 'measure.json';

function histogram(symbols: { base: string; dotted: boolean }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const symbol of symbols) {
    const key = `${symbol.dotted ? 'dotted ' : ''}${symbol.base}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function digestFor(take: Take, quantization: QuantizationSetting) {
  const layout = layoutScore(take.notes, {
    bpm: take.tempo.bpm,
    timeSignature: take.tempo.timeSignature,
    tempoChanges: take.tempo.changes,
    quantization,
    keySignature: take.tempo.keySignature ?? 0,
    pedals: take.pedalEvents,
    minMeasures: 1,
  });

  // Per measure and staff, what the written values add up to against the bar.
  const bar = barUnits(take.tempo.timeSignature);
  const filled = new Map<string, number>();
  const add = (staff: string, startMs: number, symbol: DurationSymbol): void => {
    const index = layout.measures.findIndex((m) => startMs >= m.startMs && startMs < m.endMs);
    if (index < 0) return;
    const key = `${index}|${staff}`;
    filled.set(key, (filled.get(key) ?? 0) + beatsForSymbol(symbol, UNITS_PER_WHOLE));
  };
  for (const chord of layout.chords) add(chord.staff, chord.displayStartMs, chord.symbol);
  for (const rest of layout.rests) add(rest.staff, rest.displayStartMs, rest.symbol);
  // A voice sounding under another doubles a bar's total, so "overfull" only
  // counts bars with a single voice on the staff.
  const voicesPerBar = new Map<string, Set<number>>();
  for (const chord of layout.chords) {
    const index = layout.measures.findIndex(
      (m) => chord.displayStartMs >= m.startMs && chord.displayStartMs < m.endMs,
    );
    if (index < 0) continue;
    const key = `${index}|${chord.staff}`;
    const set = voicesPerBar.get(key) ?? new Set<number>();
    set.add(chord.voice);
    voicesPerBar.set(key, set);
  }
  let overfull = 0;
  let exact = 0;
  let underfull = 0;
  let deviation = 0;
  for (const [key, units] of filled) {
    if ((voicesPerBar.get(key)?.size ?? 1) > 1) continue;
    if (units > bar + 1e-6) overfull += 1;
    else if (units > bar - 1e-6) exact += 1;
    else underfull += 1;
    deviation += Math.abs(units - bar);
  }

  return {
    chords: layout.chords.length,
    rests: layout.rests.length,
    beams: layout.beams.length,
    measures: layout.measures.length,
    chordSymbols: histogram(layout.chords.map((chord) => chord.symbol)),
    restSymbols: histogram(layout.rests.map((rest) => rest.symbol)),
    beamCounts: histogram(
      layout.beams.map((beam) => ({ base: `beams:${beam.beamCount}`, dotted: false })),
    ),
    overfullBars: overfull,
    exactBars: exact,
    underfullBars: underfull,
    /** Total distance from the bar, in units — 0 when every bar adds up. */
    deviationUnits: Math.round(deviation),
  };
}

it('measure short values across the classics pack', async () => {
  const files = (await readdir(SCORES_DIR)).filter((name) => name.endsWith('.mxl')).sort();
  const out: Record<string, unknown> = {};
  for (const file of files) {
    const bytes = await readFile(path.join(SCORES_DIR, file));
    let take: Take;
    try {
      take = musicXmlToTake(extractMusicXmlText(new Uint8Array(bytes)), file);
    } catch (error) {
      out[file] = { failed: String(error) };
      continue;
    }
    out[file] = {
      defaultGrid: take.display.quantization,
      atSixteenth: digestFor(take, '1/16'),
      atOwnGrid: digestFor(take, take.display.quantization),
    };
  }
  await writeFile(OUT, `${JSON.stringify(out, null, 1)}\n`, 'utf8');
}, 600_000);
