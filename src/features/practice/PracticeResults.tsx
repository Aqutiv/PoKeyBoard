import { Fragment, useId } from 'react';
import { COMPACT_LANDSCAPE_QUERY, useMediaQuery } from '@/app/hooks/useMediaQuery';
import { loopBetween } from '@/features/transport/practiceLoop';
import { transportController } from '@/features/transport/transportController';
import { useMessages } from '@/i18n/i18nContext';
import type { Messages } from '@/i18n/types';
import { usePracticeStore, type PracticeResult } from '@/state/usePracticeStore';
import { useTakeStore } from '@/state/useTakeStore';
import { TooltipButton } from '@/ui/TooltipButton';
import type { KeepTimeReport } from './playAlongSession';
import type { BarsCell, ResultCell } from './resultCells';
import type { WaitReport } from './trainingReport';
import './practice.css';

/** Room for every fact on one line: where the transport row shows its practice hint. */
const DESKTOP_QUERY = '(min-width: 900px) and (min-height: 501px)';

/** A fact after the headline, keyed for the list it is drawn in. */
type Fact = readonly [key: string, text: string];

/** How a cell is named for a screen reader, in the words of the run's style. */
interface CellNames {
  section: Messages['practice']['sectionCell'];
  pass: Messages['practice']['passCell'];
}

/** What the card says of a run, whichever way it was practised. */
interface Told {
  headline: string;
  /** The headline's share, beside it where there is room. */
  share: string;
  /** Every fact after the headline, for a desktop. */
  full: Fact[];
  /** What a phone's line has room for. */
  short: Fact[];
  /** The one sentence a screen reader hears for the result: all of it, whatever the screen. */
  summary: string;
  cells: readonly ResultCell[];
  names: CellNames;
}

/**
 * The share of `total` that went right, rounded down: 199 of 200 is not 100%.
 * From the counts rather than a ratio, which a whole percentage can sit a hair
 * under.
 */
function percentRight(good: number, total: number): number {
  return total > 0 ? Math.floor((good * 100) / total) : 0;
}

/** The slowest speed a run went at, when below the take's own. */
function slowestSpeedFact(m: Messages, slowestSpeed: number): Fact[] {
  const speed = Math.round(slowestSpeed * 100);
  return speed === 100 ? [] : [['speed', m.practice.atSpeed({ percent: speed })]];
}

/**
 * A "wait for me" run: the steps right first time. Everything worth saying
 * follows on a desktop, zero counts left out, as is the take's own speed; a
 * phone keeps to the mistakes, and nothing it could leave to the cells.
 */
function toldOfWait(m: Messages, wait: WaitReport): Told {
  const { wrongKeys, letThrough, slowHolds, inFlow } = wait;
  const full: Fact[] = [];
  if (wrongKeys > 0) full.push(['wrong', m.practice.wrongKeys({ count: wrongKeys })]);
  if (letThrough > 0) full.push(['let', m.practice.letThrough({ count: letThrough })]);
  if (slowHolds > 0) full.push(['slow', m.practice.slowHolds({ count: slowHolds })]);
  if (inFlow > 0) full.push(['flow', m.practice.inFlow({ count: inFlow })]);
  full.push(...slowestSpeedFact(m, wait.slowestSpeed));
  const short: Fact[] = [];
  if (wrongKeys > 0) short.push(['wrong', m.practice.wrongKeysShort({ count: wrongKeys })]);
  if (letThrough > 0) short.push(['let', m.practice.letThroughShort({ count: letThrough })]);

  const headline = m.practice.rightFirstTime({ good: wait.rightFirstTime, total: wait.steps });
  const share = m.practice.accuracy({ percent: percentRight(wait.rightFirstTime, wait.steps) });
  const facts = [`${headline} ${share}`, ...full.map(([, text]) => text)];
  return {
    headline,
    share,
    full,
    short,
    summary: m.practice.summaryWait({ facts: facts.join(', ') }),
    cells: wait.cells,
    names: { section: m.practice.sectionCell, pass: m.practice.passCell },
  };
}

/**
 * A Keep-time run: the notes on time. On a desktop, how many were played at
 * all, which early or late, the missed and the wrong notes, then the player's
 * timing in sentences of its own: which way they pull the beat, and, late by
 * the same every note, that it may be the sound reaching them late. A phone
 * keeps to the notes played and the timing in a word or two.
 */
function toldOfKeepTime(m: Messages, report: KeepTimeReport): Told {
  const counts: Fact[] = [['hit', m.practice.hit({ count: report.hits })]];
  if (report.early > 0) counts.push(['early', m.practice.early({ count: report.early })]);
  if (report.late > 0) counts.push(['late', m.practice.late({ count: report.late })]);
  if (report.missed > 0) counts.push(['missed', m.practice.missed({ count: report.missed })]);
  if (report.wrong > 0) counts.push(['wrong', m.practice.wrongNotes({ count: report.wrong })]);
  counts.push(...slowestSpeedFact(m, report.slowestSpeed));

  const ms = Math.round(Math.abs(report.meanOffsetMs ?? 0));
  const remarks: Fact[] = [];
  const shortRemarks: Fact[] = [];
  if (report.tendency === 'rushing') {
    remarks.push(['tendency', m.practice.rushing({ ms })]);
    shortRemarks.push(['tendency', m.practice.rushingShort]);
  } else if (report.tendency === 'dragging') {
    remarks.push(['tendency', m.practice.dragging({ ms })]);
    shortRemarks.push(['tendency', m.practice.draggingShort]);
  }
  if (report.consistentlyLate) {
    remarks.push(['latency', m.practice.consistentlyLate]);
    shortRemarks.push(['latency', m.practice.consistentlyLateShort]);
  }

  const headline = m.practice.onTime({ good: report.onTime, total: report.notes });
  const share = m.practice.accuracy({ percent: percentRight(report.onTime, report.notes) });
  const facts = [`${headline} ${share}`, ...counts.map(([, text]) => text)];
  return {
    headline,
    share,
    full: [...counts, ...remarks],
    short: [...counts.slice(0, 1), ...shortRemarks],
    summary: m.practice.summaryKeepTime({
      facts: facts.join(', '),
      remarks: remarks.map(([, text]) => text),
    }),
    cells: report.cells,
    names: { section: m.practice.sectionCellKeepTime, pass: m.practice.passCellKeepTime },
  };
}

function toldOf(m: Messages, result: PracticeResult): Told {
  return result.style === 'wait' ? toldOfWait(m, result.wait) : toldOfKeepTime(m, result.keepTime);
}

/** Loop a section's bars and stand at their start, ready to play them again. */
function loopSection(cell: BarsCell): void {
  const loop = loopBetween(useTakeStore.getState().take, cell.startMs, cell.endMs);
  if (!loop) return;
  transportController.setLoop(loop);
  transportController.seek(loop.startMs);
}

function cellName(cell: ResultCell): string {
  if (cell.kind === 'pass') return String(cell.pass);
  return cell.fromBar === cell.toBar ? String(cell.fromBar) : `${cell.fromBar}–${cell.toBar}`;
}

/**
 * Each part of the run, coloured by how it went: four-bar sections, each a
 * button that loops it, or the latest passes round a loop. The share right
 * (or on time) is written on each, so the colour is never all there is to go
 * on; as a percentage, since "3/4" in a music app reads as a time signature.
 * Words stand in for it all, with the counts, for a screen reader.
 */
function ResultCells({ cells, names }: { cells: readonly ResultCell[]; names: CellNames }) {
  const m = useMessages();
  const captionId = useId();
  const passes = cells[0]?.kind === 'pass';
  return (
    <div className="practice-results__cells">
      <span id={captionId} className="practice-results__caption">
        {passes ? m.practice.passesLabel : m.practice.sectionsLabel}
      </span>
      <ol className="practice-results__list" aria-labelledby={captionId}>
        {cells.map((cell) => {
          const face = (
            <span className="practice-cell__face" aria-hidden="true">
              {cellName(cell)} ·{' '}
              <span className="practice-cell__share">
                {m.practice.cellShare({ percent: percentRight(cell.good, cell.total) })}
              </span>
            </span>
          );
          if (cell.kind === 'pass') {
            // In words inside the item rather than as its label, which a
            // screen reader may pass over on a list item.
            return (
              <li
                key={`pass-${cell.pass}`}
                className={`practice-cell practice-cell--${cell.grade}`}
                data-grade={cell.grade}
              >
                {face}
                <span className="visually-hidden">
                  {names.pass({ pass: cell.pass, good: cell.good, total: cell.total })}
                </span>
              </li>
            );
          }
          const label = names.section({
            from: cell.fromBar,
            to: cell.toBar,
            good: cell.good,
            total: cell.total,
          });
          const loop = m.practice.loopSection({ bars: cell.toBar - cell.fromBar + 1 });
          return (
            <li key={`bars-${cell.fromBar}`}>
              <button
                type="button"
                className={`practice-cell practice-cell--${cell.grade}`}
                data-grade={cell.grade}
                aria-label={`${label} ${loop}`}
                onClick={() => loopSection(cell)}
              >
                {face}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * How the last practice run went, under the transport until it is dismissed
 * or the next run starts. Not a dialog: an `aria-modal` anywhere would stand
 * the computer keyboard and MIDI down, and the player is at the keys. The
 * results themselves are collected outside React (`practiceSession`).
 *
 * A desktop has room for every fact on one line; a phone keeps to the few
 * that matter most; a short landscape screen gives the card one line and no
 * cells.
 */
export function PracticeResults() {
  const m = useMessages();
  const result = usePracticeStore((s) => s.result);
  const live = usePracticeStore((s) => s.live !== null);
  // Where a Keep-time run's presses land, while one is under way.
  const pressOriginMs = usePracticeStore((s) => s.live?.pressOriginMs);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const compactLandscape = useMediaQuery(COMPACT_LANDSCAPE_QUERY);
  const shown = live ? null : result;
  const told = shown ? toldOf(m, shown) : null;
  const facts = told ? (desktop ? told.full : told.short) : [];

  return (
    <>
      {/* Always mounted, so a screen reader hears each result as it arrives:
          one sentence, while the card is there. It also carries, while a
          Keep-time run lasts, the moment on the page's clock a press lands
          on the run's start, for the end-to-end tests to play in time from:
          a fact about the running transport, as `data-piano-ready` is. */}
      <p
        role="status"
        className="visually-hidden"
        data-keep-time-origin-ms={pressOriginMs === undefined ? undefined : String(pressOriginMs)}
      >
        {told ? told.summary : ''}
      </p>
      {told ? (
        <div className="practice-results" role="group" aria-label={m.practice.resultsLabel}>
          <p className="practice-results__facts">
            <strong>{told.headline}</strong>
            {desktop ? ` ${told.share}` : null}
            {facts.map(([key, text]) => (
              <Fragment key={key}>
                <span aria-hidden="true"> · </span>
                <span className="practice-results__fact">{text}</span>
              </Fragment>
            ))}
          </p>
          {compactLandscape || told.cells.length === 0 ? null : (
            <ResultCells cells={told.cells} names={told.names} />
          )}
          <TooltipButton
            type="button"
            className="practice-results__dismiss"
            aria-label={m.practice.dismiss}
            onClick={() => usePracticeStore.getState().dismiss()}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M7 7l10 10M17 7 7 17" />
            </svg>
          </TooltipButton>
        </div>
      ) : null}
    </>
  );
}
