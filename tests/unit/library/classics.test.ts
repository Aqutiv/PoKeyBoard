import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { libraryTakeId } from '@/domain/libraryTakes';
import { MAX_NOTE_COUNT } from '@/domain/takeTypes';
import { LIBRARY_FOLDER_SUMMARIES, LIBRARY_TRACKS } from '@/features/library/catalog';
import { CLASSIC_SCORES } from '@/features/library/classicsManifest';
import { CLASSIC_SCORE_NAMES } from '@/features/library/classicsNames';
import { SCORE_PACK_PATH } from '@/features/library/scoreLoader';

const PACK_DIR = path.resolve(process.cwd(), 'public', SCORE_PACK_PATH);

describe('vendored classics', () => {
  it('ships a manifest entry for every score, each with a file on disk', () => {
    expect(CLASSIC_SCORES.length).toBeGreaterThan(0);
    for (const entry of CLASSIC_SCORES) {
      expect(existsSync(path.join(PACK_DIR, entry.file)), `missing ${entry.file}`).toBe(true);
    }
  });

  it('gives every score a curated name', () => {
    const unnamed = CLASSIC_SCORES.filter((entry) => !CLASSIC_SCORE_NAMES[entry.trackId]);
    expect(unnamed.map((entry) => entry.trackId)).toEqual([]);
    // A name with no score behind it is dead weight the list can never show.
    const ids = new Set(CLASSIC_SCORES.map((entry) => entry.trackId));
    expect(Object.keys(CLASSIC_SCORE_NAMES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('keeps track ids unique and clear of the authored tracks', () => {
    const ids = CLASSIC_SCORES.map((entry) => entry.trackId);
    expect(new Set(ids).size).toBe(ids.length);
    const authored = new Set(LIBRARY_TRACKS.map((def) => def.trackId));
    expect(ids.filter((id) => authored.has(id))).toEqual([]);
  });

  it('carries list metadata the catalog can render without fetching', () => {
    for (const entry of CLASSIC_SCORES) {
      expect(entry.noteCount, entry.trackId).toBeGreaterThan(0);
      expect(entry.noteCount, entry.trackId).toBeLessThanOrEqual(MAX_NOTE_COUNT);
      expect(entry.durationMs, entry.trackId).toBeGreaterThan(0);
      expect(entry.bpm, entry.trackId).toBeGreaterThan(0);
    }
  });

  it('shelves the whole pack into Classics with rounded tempi', () => {
    const scores = LIBRARY_FOLDER_SUMMARIES.classics.filter((track) => track.source === 'score');
    expect(scores).toHaveLength(CLASSIC_SCORES.length);
    for (const summary of scores) {
      expect(summary.takeId).toBe(libraryTakeId(summary.trackId));
      expect(summary.descriptionKey).toBeUndefined();
      // Parsed tempi are not always whole; the list must not show 70.0002 BPM.
      expect(Number.isInteger(summary.bpm), `${summary.trackId} bpm ${summary.bpm}`).toBe(true);
    }
  });
});
