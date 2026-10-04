import { z } from 'zod';
import { isLibraryTakeId } from '@/domain/libraryTakes';
import type { TrainingHand } from '@/domain/trainingGate';
import type { PracticeStyle } from '@/features/transport/modes';
import type { PracticeRun, RunEndReason } from '@/features/transport/practiceEvents';

/**
 * A best and a last result for each Library track, for each way it has been
 * practised through. Pure: the records come in, and what to keep, which is
 * better and what the Library shows come out. They are kept on the device
 * alone, in one metadata row (`practiceResultsRepository`), and never in a
 * backup.
 *
 * A result is of the track as it was when it was played, which its
 * fingerprint says: the track's notes and length, as the catalog counts them.
 * Once a track changes, a score transcribed again or a manifest regenerated,
 * its old results measure nothing: practising it again starts afresh, and the
 * Library shows none of them meanwhile.
 */

/** A way of practising a track: waiting for the player, or keeping time (`along`), and the hand. */
export type PracticeModeKey = `${'wait' | 'along'}:${TrainingHand}`;

/** One run's result, as it is kept. */
export interface PracticeScore {
  /** When the run ended, as an ISO string. */
  at: string;
  /**
   * The share that went right, from 0 to 1. Waiting for the player, the steps
   * right first time; keeping time, the notes played, of the notes asked for
   * and the wrong notes besides (`PlayAlongScore.accuracy`).
   */
  accuracy: number;
  /** Keeping time, the share of the notes played on time, from 0 to 1. */
  onTime?: number;
  /** The slowest the run went, 1 being the take's own speed. */
  speed: number;
  /** The steps asked for, waiting for the player, or the notes judged, keeping time. */
  notes: number;
  /** The track it was played on, as `trackFingerprint` writes it. */
  fingerprint: string;
}

/** A way of practising a track: its best result so far, and its last. */
export interface ModeRecord {
  best: PracticeScore;
  last: PracticeScore;
}

/** A track's records, one for each way it has been practised through. */
export type TrackRecords = Partial<Record<PracticeModeKey, ModeRecord>>;

/** Every Library track's records, by take id. */
export interface PracticeRecords {
  v: 1;
  tracks: Record<string, TrackRecords>;
}

/**
 * A run kept among its track's results: the best now, the run itself as the
 * last, and whether it beat the best.
 */
export interface ResultRecord {
  best: PracticeScore;
  last: PracticeScore;
  /** It beat a best of the track as it stands. A first result is the best, but not a new one. */
  newBest: boolean;
}

export const EMPTY_PRACTICE_RECORDS: PracticeRecords = { v: 1, tracks: {} };

/** The key of the way `style` practises `hand`. */
export function practiceModeKey(style: PracticeStyle, hand: TrainingHand): PracticeModeKey {
  return `${style === 'wait' ? 'wait' : 'along'}:${hand}`;
}

/** The style and the hand a mode key names. */
export function practiceModeOf(mode: PracticeModeKey): {
  style: PracticeStyle;
  hand: TrainingHand;
} {
  const [style, hand] = mode.split(':') as ['wait' | 'along', TrainingHand];
  return { style: style === 'wait' ? 'wait' : 'playAlong', hand };
}

/** A track as its catalog entry counts it: how many notes, and how long. */
export function trackFingerprint({
  noteCount,
  durationMs,
}: {
  noteCount: number;
  durationMs: number;
}): string {
  return `${noteCount}:${durationMs}`;
}

/**
 * Whether a run went through the whole of what it asks for, as a best has to:
 * from no later than its first note to the take's end, round no loop. A run
 * paused, stopped or sent elsewhere is over, however far it got; one that
 * asked for nothing has nothing to measure.
 */
export function isCompleteRun(run: PracticeRun, reason: RunEndReason): boolean {
  const first = run.asked[0];
  return (
    first !== undefined && run.fromMs <= first.startMs && reason === 'end' && run.loop === null
  );
}

/**
 * Whether `a` is a better result than `b`, practised in `style`. Waiting for
 * the player, the share right first time decides, then the speed; keeping
 * time, the share on time, then the notes played, then the speed. A faster
 * run has to be as right to beat a slower one, so a slow perfect run stays the
 * best until one as perfect comes faster: the card says each result's speed,
 * so the trade is never hidden. Two results only as good as each other are
 * neither better.
 */
export function isBetter(a: PracticeScore, b: PracticeScore, style: PracticeStyle): boolean {
  const order: [number, number][] =
    style === 'wait'
      ? [
          [a.accuracy, b.accuracy],
          [a.speed, b.speed],
        ]
      : [
          [a.onTime ?? 0, b.onTime ?? 0],
          [a.accuracy, b.accuracy],
          [a.speed, b.speed],
        ];
  for (const [ours, theirs] of order) {
    if (ours !== theirs) return ours > theirs;
  }
  return false;
}

/**
 * Keep `score` as the last result of `takeId` practised in `mode`, and as its
 * best if it is better (`isBetter`). A best of the track before its notes
 * changed is no measure, so that way of practising it starts afresh. The
 * records handed in are left as they were.
 */
export function withScore(
  records: PracticeRecords,
  takeId: string,
  mode: PracticeModeKey,
  score: PracticeScore,
): ResultRecord & { records: PracticeRecords } {
  const track = records.tracks[takeId] ?? {};
  const earlier = track[mode]?.best;
  const standing = earlier?.fingerprint === score.fingerprint ? earlier : undefined;
  const newBest = standing !== undefined && isBetter(score, standing, practiceModeOf(mode).style);
  const best = standing === undefined || newBest ? score : standing;
  return {
    records: {
      v: 1,
      tracks: { ...records.tracks, [takeId]: { ...track, [mode]: { best, last: score } } },
    },
    best,
    last: score,
    newBest,
  };
}

/**
 * A result's headline share, as a whole percentage rounded down, as the
 * results card writes it: right first time, waiting for the player; on time,
 * keeping time. From the count it stands for, since a share kept as a ratio
 * can sit a hair under a whole percentage (0.29 × 100 is 28.999…).
 */
export function headlinePercent(score: PracticeScore, style: PracticeStyle): number {
  const share = style === 'wait' ? score.accuracy : (score.onTime ?? 0);
  const good = Math.round(share * score.notes);
  return Math.floor((good * 100) / score.notes);
}

/** What the Library shows of a track: the best in the way it was practised most recently. */
export interface PracticeChip {
  mode: PracticeModeKey;
  best: PracticeScore;
}

/**
 * The chip for a track as the catalog now has it (`summary`): of the ways it
 * has been practised through on these very notes, the one practised most
 * recently, and its best. Nothing for a track whose every record is of notes
 * it no longer has.
 */
export function chipFor(
  track: TrackRecords | undefined,
  summary: { noteCount: number; durationMs: number },
): PracticeChip | null {
  const fingerprint = trackFingerprint(summary);
  let chip: PracticeChip | null = null;
  let latest = Number.NEGATIVE_INFINITY;
  for (const [mode, record] of Object.entries(track ?? {}) as [PracticeModeKey, ModeRecord][]) {
    if (record.last.fingerprint !== fingerprint) continue;
    const at = Date.parse(record.last.at);
    if (at > latest) {
      latest = at;
      chip = { mode, best: record.best };
    }
  }
  return chip;
}

const MODE_KEY = /^(wait|along):(left|right|both)$/;

const share = z.number().min(0).max(1);

const waitScoreSchema = z.object({
  at: z.iso.datetime(),
  accuracy: share,
  speed: z.number().positive(),
  notes: z.number().int().positive(),
  fingerprint: z.string().min(1),
});

/** A Keep-time result says how many of its notes were on time. */
const keepTimeScoreSchema = waitScoreSchema.extend({ onTime: share });

/** A best and a last of one track as it was: of two versions, neither measures the other. */
function modeRecordSchema(score: typeof waitScoreSchema | typeof keepTimeScoreSchema) {
  return z
    .object({ best: score, last: score })
    .refine(({ best, last }) => best.fingerprint === last.fingerprint);
}

const waitRecordSchema = modeRecordSchema(waitScoreSchema);
const keepTimeRecordSchema = modeRecordSchema(keepTimeScoreSchema);

/**
 * The outer envelope, then each track, then each entry, each parsed on its
 * own: a bad entry is dropped and every other kept. A record of every track at
 * once — zod's exhaustive enum-keyed records, or partial records that refuse
 * an unknown key — would lose the lot to one bad entry. Keys are checked too:
 * a track by its Library id, and a way of practising by name.
 */
const envelopeSchema = z.object({
  v: z.literal(1),
  tracks: z.record(z.string(), z.unknown()),
});
const trackSchema = z.record(z.string(), z.unknown());

/**
 * The practice records in a stored row, as far as they can be read: anything
 * else, nothing at all or a version this build does not know, starts empty.
 * `getMetadata` checks nothing, so this is all that stands between a bad row
 * and a Library that will not open.
 */
export function parsePracticeRecords(raw: unknown): PracticeRecords {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) return EMPTY_PRACTICE_RECORDS;
  const tracks: Record<string, TrackRecords> = {};
  for (const [takeId, value] of Object.entries(envelope.data.tracks)) {
    if (!isLibraryTakeId(takeId)) continue;
    const entries = trackSchema.safeParse(value);
    if (!entries.success) continue;
    const track: TrackRecords = {};
    for (const [mode, entry] of Object.entries(entries.data)) {
      if (!MODE_KEY.test(mode)) continue;
      const schema = mode.startsWith('wait:') ? waitRecordSchema : keepTimeRecordSchema;
      const parsed = schema.safeParse(entry);
      if (parsed.success) track[mode as PracticeModeKey] = parsed.data;
    }
    if (Object.keys(track).length > 0) tracks[takeId] = track;
  }
  return { v: 1, tracks };
}
