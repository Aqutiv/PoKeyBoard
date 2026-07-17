import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data/db';
import {
  deleteTake,
  duplicateTake,
  getAllTakesForBackup,
  getTake,
  listTakeSummaries,
  renameTake,
  saveTake,
} from '@/data/takeRepository';
import { putCachedAudio, getCachedAudio } from '@/data/audioCacheRepository';
import { createEmptyTake } from '@/domain/noteEvents';
import type { Take } from '@/domain/takeTypes';

function takeWithNotes(title: string): Take {
  return createEmptyTake({
    title,
    notes: [
      { id: 'n1', midi: 60, startMs: 0, durationMs: 500, velocity: 0.8 },
      { id: 'n2', midi: 64, startMs: 500, durationMs: 500, velocity: 0.6 },
    ],
    durationMs: 1000,
  });
}

beforeEach(async () => {
  await db.takes.clear();
  await db.audioCache.clear();
  await db.metadata.clear();
});

describe('takeRepository', () => {
  it('round-trips a take through save and load', async () => {
    const take = takeWithNotes('Roundtrip');
    await saveTake(take);
    const loaded = await getTake(take.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe('Roundtrip');
    expect(loaded!.notes).toHaveLength(2);
    expect(loaded!.notes[0]!.midi).toBe(60);
  });

  it('increments the revision on every save', async () => {
    const take = takeWithNotes('Rev');
    expect(await saveTake(take)).toBe(1);
    expect(await saveTake(take)).toBe(2);
    expect(await saveTake(take)).toBe(3);
  });

  it('lists summaries most recently edited first, without parsing JSON', async () => {
    const a = takeWithNotes('Older');
    const b = takeWithNotes('Newer');
    a.updatedAt = '2026-01-01T00:00:00.000Z';
    b.updatedAt = '2026-06-01T00:00:00.000Z';
    await saveTake(a);
    await saveTake(b);
    const list = await listTakeSummaries();
    expect(list.map((t) => t.title)).toEqual(['Newer', 'Older']);
    expect(list[0]!.noteCount).toBe(2);
    expect(list[0]!.isDraft).toBe(false);
  });

  it('marks unnamed takes as drafts', async () => {
    await saveTake(createEmptyTake());
    const [summary] = await listTakeSummaries();
    expect(summary!.isDraft).toBe(true);
  });

  it('deletes a take together with its cached audio', async () => {
    const take = takeWithNotes('Doomed');
    await saveTake(take);
    await putCachedAudio({
      takeId: take.id,
      hash: 'h',
      blob: new Blob([new Uint8Array(5000)], { type: 'audio/mpeg' }),
      mimeType: 'audio/mpeg',
      fileName: 'x.mp3',
      createdAt: new Date().toISOString(),
    });
    await deleteTake(take.id);
    expect(await getTake(take.id)).toBeNull();
    expect(await getCachedAudio(take.id)).toBeNull();
  });

  it('renames without touching content', async () => {
    const take = takeWithNotes('Before');
    await saveTake(take);
    const renamed = await renameTake(take.id, 'After');
    expect(renamed!.title).toBe('After');
    expect((await getTake(take.id))!.notes).toHaveLength(2);
  });

  it('duplicates with a fresh id and copy title', async () => {
    const take = takeWithNotes('Original');
    await saveTake(take);
    const copy = await duplicateTake(take.id);
    expect(copy!.id).not.toBe(take.id);
    expect(copy!.title).toBe('Original copy');
    expect(copy!.notes).toHaveLength(2);
    expect(await listTakeSummaries()).toHaveLength(2);
  });

  it('collects all takes for backup', async () => {
    await saveTake(takeWithNotes('One'));
    await saveTake(takeWithNotes('Two'));
    const all = await getAllTakesForBackup();
    expect(all).toHaveLength(2);
  });
});
