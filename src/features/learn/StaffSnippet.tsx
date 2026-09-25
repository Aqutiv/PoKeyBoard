import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { themeController } from '@/app/theme';
import type { NoteEvent } from '@/domain/takeTypes';
import { layoutScore, type ScoreLayout } from '@/features/notation/notationLayout';
import {
  computeScoreGeometry,
  drawScore,
  gutterWidthFor,
  SCORE_LEAD_IN,
  SCORE_PALETTES,
  type ScoreChrome,
  type ScoreGeometry,
  type StaffMode,
} from '@/features/notation/scoreRenderer';
import { barDurationMs } from '@/utils/timing';
import { phraseToNotes } from './phrase';
import { barsPerSystemFor, SNIPPET_RIGHT_PAD_PX } from './staffSystems';
import type { LearnPhrase } from './types';

/** Far enough behind the start that `drawPlayhead` bails on its own guard. */
const NO_PLAYHEAD_MS = -1e9;

const subscribeTheme = (onChange: () => void): (() => void) => themeController.subscribe(onChange);
const getTheme = (): 'dark' | 'light' => themeController.getResolved();

interface StaffSnippetProps {
  phrase: LearnPhrase;
  ariaLabel: string;
  /**
   * Keys the user is holding, drawn lit where they match a written note.
   *
   * Passed only where the stave is the *answer*. A reading quiz shows a note
   * and asks for its letter, so lighting the head there would let the whole
   * thing be brute-forced on the keyboard — `QuizPanel` never passes this.
   */
  litMidis?: ReadonlySet<number>;
  /**
   * Written notes to light by which note they are, replacing `litMidis`: the
   * heads a `playAlong` attempt has played so far. See `ScoreRenderInput`.
   */
  litNoteIds?: ReadonlySet<string>;
  /**
   * The note the player is due to play next. When the line runs to several
   * systems, the one holding it is kept in view as the attempt moves on.
   */
  focusNoteId?: string | null;
  /**
   * Which staves to draw. `'treble'` by default, because every chapter before
   * the bass staff draws exactly one.
   *
   * Taken once and used twice, deliberately. `computeScoreGeometry` sizes the
   * canvas and `ScoreView` decides what is drawn into it; if the two disagree,
   * a one-staff picture lands in a two-staff canvas — gutter fill and all.
   */
  staves?: StaffMode;
  /**
   * Keep the rests the engraver derived, instead of blanking them.
   *
   * Off by default, because `deriveRests` answers "what silence did this
   * performance leave over" and a worked example is not a performance. The
   * rhythm chapter is the exception that proves it: there, the silence *is*
   * the subject.
   */
  showRests?: boolean;
  /**
   * Bar furniture. 'bare' by default — a lesson about one written note has no
   * use for a time signature. The rhythm chapter passes 'lesson' to get the
   * time signature without the measure number. Only the first system of a
   * long line carries it, as on a printed page; the rest keep just the clef.
   */
  chrome?: ScoreChrome;
}

/** One system's worth of engraving, and the span its width is shared across. */
interface StaffSystem {
  layout: ScoreLayout;
  geometry: ScoreGeometry;
  /** How much music the usable width represents. */
  spanMs: number;
  /** Ids of the notes on this system, for keeping the due one in view. */
  noteIds: ReadonlySet<string>;
}

/**
 * Engrave notes the way every lesson snippet is engraved.
 *
 * One helper, because a long line is laid out once per system and the options
 * must not drift between them — least of all `eighthsByHalfBar`.
 */
function lessonLayout(
  notes: readonly NoteEvent[],
  phrase: LearnPhrase,
  showRests: boolean,
): ScoreLayout {
  const score = layoutScore([...notes], {
    bpm: phrase.bpm,
    timeSignature: phrase.timeSignature,
    quantization: '1/16',
    minMeasures: 1,
    // A lesson about the beat shows eighths in pairs, one pair per beat, as
    // its prose says; printed music groups four to the half bar.
    eighthsByHalfBar: false,
  });
  // `layoutScore` reads dynamics off how hard the keys were struck, which is
  // right for a performance and wrong for a worked example — a lesson about
  // where middle C sits should not also be shouting `f`. Blanking them also
  // drops the dynamics row from the computed height.
  //
  // Rests go the same way, and the renderer's own staff filter is not enough
  // on its own: that only drops the *bass* rests, while a phrase shorter than
  // its bar also leaves treble ones. `deriveRests` answers "what silence did
  // this performance leave over", and a worked example is not a performance.
  return { ...score, dynamics: [], hairpins: [], rests: showRests ? score.rests : [] };
}

/**
 * A short engraved example, drawn with the live score renderer rather than the
 * sheet one. The sheet path is print-monochrome and would render as a white
 * page inside a themed card; this path is theme-aware and carries no page
 * furniture to crop away.
 *
 * A line too long for the card breaks onto several systems, one canvas each,
 * split at bar lines. Each is laid out on its own, from its own notes, so
 * nothing of a neighbouring system's music can bleed across its edge.
 */
export function StaffSnippet({
  phrase,
  ariaLabel,
  litMidis,
  litNoteIds,
  focusNoteId,
  staves = 'treble',
  showRests = false,
  chrome = 'bare',
}: StaffSnippetProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState(0);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    setWidthPx(wrapper.clientWidth);
    const observer = new ResizeObserver((entries) => {
      setWidthPx(Math.round(entries[0]?.contentRect.width ?? 0));
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  const notes = useMemo(() => phraseToNotes(phrase), [phrase]);
  const barMs = barDurationMs(phrase.bpm, phrase.timeSignature);
  const barCount = Math.max(
    1,
    Math.ceil(
      notes.reduce((end, note) => Math.max(end, note.startMs + note.durationMs), 0) / barMs,
    ),
  );
  // Unmeasured, a long line is drawn as one system rather than guessed at; the
  // first resize settles it before anything is read.
  const barsPerSystem =
    widthPx === 0 ? barCount : barsPerSystemFor(barCount, phrase.timeSignature.numerator, widthPx);

  const systems = useMemo((): readonly StaffSystem[] => {
    if (barsPerSystem >= barCount) {
      const layout = lessonLayout(notes, phrase, showRests);
      return [
        {
          layout,
          geometry: computeScoreGeometry(layout, { staves }),
          // Fit the whole phrase, exactly as a single snippet always has.
          spanMs: layout.totalMs,
          noteIds: new Set(notes.map((note) => note.id)),
        },
      ];
    }
    const systemMs = barsPerSystem * barMs;
    const out: StaffSystem[] = [];
    for (let start = 0; start < barCount * barMs - 1; start += systemMs) {
      // Ids travel with the notes, so a lit head stays lit on its own system.
      const own = notes
        .filter((note) => note.startMs >= start && note.startMs < start + systemMs)
        .map((note) => ({ ...note, startMs: note.startMs - start }));
      const layout = lessonLayout(own, phrase, showRests);
      out.push({
        layout,
        geometry: computeScoreGeometry(layout, { staves }),
        // Every system shares one scale, so a beat is as wide on the last line
        // as on the first.
        spanMs: systemMs,
        noteIds: new Set(own.map((note) => note.id)),
      });
    }
    return out;
  }, [notes, phrase, showRests, staves, barsPerSystem, barCount, barMs]);

  // Keep the system holding the due note in view as the attempt moves on. Not
  // on first paint: the card opens at its heading, and a lesson that scrolled
  // itself past its own prose on arrival would be hiding what it says.
  const systemRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const focusIndex =
    focusNoteId == null ? -1 : systems.findIndex((system) => system.noteIds.has(focusNoteId));
  const shownFocus = useRef(focusIndex);
  useEffect(() => {
    if (systems.length < 2 || focusIndex < 0 || focusIndex === shownFocus.current) return;
    shownFocus.current = focusIndex;
    systemRefs.current[focusIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [focusIndex, systems.length]);

  return (
    <div className="learn-staff" ref={wrapperRef}>
      {systems.map((system, index) => (
        <StaffSystemCanvas
          key={index}
          ref={(canvas) => {
            systemRefs.current[index] = canvas;
          }}
          system={system}
          phrase={phrase}
          staves={staves}
          chrome={index === 0 ? chrome : 'bare'}
          litMidis={litMidis}
          litNoteIds={litNoteIds}
          // One picture, however many systems it takes: the first carries the
          // label and the rest are its continuation.
          ariaLabel={index === 0 ? ariaLabel : undefined}
        />
      ))}
    </div>
  );
}

interface StaffSystemCanvasProps {
  ref: (canvas: HTMLCanvasElement | null) => void;
  system: StaffSystem;
  phrase: LearnPhrase;
  staves: StaffMode;
  chrome: ScoreChrome;
  litMidis?: ReadonlySet<number>;
  litNoteIds?: ReadonlySet<string>;
  ariaLabel?: string;
}

function StaffSystemCanvas({
  ref,
  system,
  phrase,
  staves,
  chrome,
  litMidis,
  litNoteIds,
  ariaLabel,
}: StaffSystemCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme);
  const { layout, geometry, spanMs } = system;

  // Kept in a ref so the ResizeObserver can be created once and still call the
  // current closure. The runner re-renders on every note-on and note-off, and
  // rebuilding the observer — and reallocating the canvas backing store — that
  // often is exactly the churn `staffPhrase.ts` was written to avoid.
  const drawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = (): void => {
      const widthPx = canvas.clientWidth;
      if (widthPx === 0) return;
      const heightPx = geometry.minHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(widthPx * dpr);
      canvas.height = Math.round(heightPx * dpr);
      canvas.style.height = `${heightPx}px`;

      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, widthPx, heightPx);

      const gutterPx = gutterWidthFor(0);
      // Fit the system's span in the space left after the fixed prefix.
      const usablePx = Math.max(1, widthPx - gutterPx - SCORE_LEAD_IN - SNIPPET_RIGHT_PAD_PX);
      const pxPerMs = usablePx / Math.max(1, spanMs);

      drawScore(
        context,
        {
          widthPx,
          heightPx,
          pxPerMs,
          scrollMs: 0,
          trebleTop: geometry.trebleTop,
          bassTop: geometry.bassTop,
          pedalRow: geometry.pedalRow,
          dynamicsRow: geometry.dynamicsRow,
          gutterPx,
          staves,
          chrome,
        },
        {
          layout,
          timeSignature: phrase.timeSignature,
          keySignature: 0,
          playheadMs: NO_PLAYHEAD_MS,
          recording: false,
          openNotes: [],
          ghosts: [],
          litMidis,
          litNoteIds,
        },
        SCORE_PALETTES[theme],
      );
    };

    drawRef.current = draw;
    draw();
    // `litMidis` is safe to depend on by identity: the engine replaces its
    // active-note set only when the set actually changes, so an equal-but-new
    // object never reaches here. `litNoteIds` is memoized on the attempt.
  }, [layout, geometry, spanMs, phrase.timeSignature, theme, litMidis, litNoteIds, staves, chrome]);

  // A static canvas has no redraw loop of its own to catch a resize. Created
  // once and left alone; it calls whichever draw closure is current.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  return (
    <canvas
      ref={(canvas) => {
        canvasRef.current = canvas;
        ref(canvas);
      }}
      className="learn-staff__canvas"
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    />
  );
}
