import { Fragment, useId } from 'react';
import { COMPACT_LANDSCAPE_QUERY, useMediaQuery } from '@/app/hooks/useMediaQuery';
import { loopBetween } from '@/features/transport/practiceLoop';
import { transportController } from '@/features/transport/transportController';
import { useMessages } from '@/i18n/i18nContext';
import type { Messages } from '@/i18n/types';
import { usePracticeStore, type PracticeResult } from '@/state/usePracticeStore';
import { useTakeStore } from '@/state/useTakeStore';
import { TooltipButton } from '@/ui/TooltipButton';
import type { BarsCell, ResultCell } from './resultCells';
import type { WaitReport } from './trainingReport';
import './practice.css';

/** Room for every fact on one line: where the transport row shows its practice hint. */
const DESKTOP_QUERY = '(min-width: 900px) and (min-height: 501px)';

/** A fact after the headline, keyed for the list it is drawn in. */
type Fact = readonly [key: string, text: string];

/** Everything worth saying about a run: zero counts are left out, as is the take's own speed. */
function fullFacts(m: Messages, wait: WaitReport): Fact[] {
  const { wrongKeys, letThrough, slowHolds, inFlow } = wait;
  const facts: Fact[] = [];
  if (wrongKeys > 0) facts.push(['wrong', m.practice.wrongKeys({ count: wrongKeys })]);
  if (letThrough > 0) facts.push(['let', m.practice.letThrough({ count: letThrough })]);
  if (slowHolds > 0) facts.push(['slow', m.practice.slowHolds({ count: slowHolds })]);
  if (inFlow > 0) facts.push(['flow', m.practice.inFlow({ count: inFlow })]);
  const speed = Math.round(wait.slowestSpeed * 100);
  if (speed !== 100) facts.push(['speed', m.practice.atSpeed({ percent: speed })]);
  return facts;
}

/** What a phone's line has room for: the mistakes, and nothing it could leave to the cells. */
function shortFacts(m: Messages, wait: WaitReport): Fact[] {
  const { wrongKeys, letThrough } = wait;
  const facts: Fact[] = [];
  if (wrongKeys > 0) facts.push(['wrong', m.practice.wrongKeysShort({ count: wrongKeys })]);
  if (letThrough > 0) facts.push(['let', m.practice.letThroughShort({ count: letThrough })]);
  return facts;
}

const headline = (m: Messages, wait: WaitReport) =>
  m.practice.rightFirstTime({ good: wait.rightFirstTime, total: wait.steps });

/**
 * The share of `total` that went right, rounded down: 199 of 200 is not 100%.
 * From the counts rather than a ratio, which a whole percentage can sit a hair
 * under.
 */
function percentRight(good: number, total: number): number {
  return total > 0 ? Math.floor((good * 100) / total) : 0;
}

const accuracy = (m: Messages, wait: WaitReport) =>
  m.practice.accuracy({ percent: percentRight(wait.rightFirstTime, wait.steps) });

/** The one sentence a screen reader hears for a result: all of it, whatever the screen. */
function summaryOf(m: Messages, result: PracticeResult): string {
  const { wait } = result;
  const facts = [`${headline(m, wait)} ${accuracy(m, wait)}`];
  for (const [, text] of fullFacts(m, wait)) facts.push(text);
  return m.practice.summaryWait({ facts: facts.join(', ') });
}

/**
 * Loop a section's bars and stand at their start, ready to play them again.
 * Music still playing is paused first: a run ended by choosing plain playback
 * leaves the take playing under the card, a loop set mid-playback restarts it
 * from where it is, and a seek is ignored while it plays.
 */
function loopSection(cell: BarsCell): void {
  const loop = loopBetween(useTakeStore.getState().take, cell.startMs, cell.endMs);
  if (!loop) return;
  if (transportController.getState() === 'playing') transportController.pause();
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
 * is written on each, so the colour is never all there is to go on; as a
 * percentage, since "3/4" in a music app reads as a time signature. Words
 * stand in for it all, with the counts, for a screen reader.
 */
function ResultCells({ cells }: { cells: readonly ResultCell[] }) {
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
                  {m.practice.passCell({ pass: cell.pass, good: cell.good, total: cell.total })}
                </span>
              </li>
            );
          }
          const label = m.practice.sectionCell({
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
 * A desktop has room for every fact on one line; a phone keeps to the
 * mistakes; a short landscape screen gives the card one line and no cells.
 */
export function PracticeResults() {
  const m = useMessages();
  const result = usePracticeStore((s) => s.result);
  const live = usePracticeStore((s) => s.live !== null);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const compactLandscape = useMediaQuery(COMPACT_LANDSCAPE_QUERY);
  const shown = live ? null : result;
  const wait = shown?.wait;
  const facts = wait ? (desktop ? fullFacts(m, wait) : shortFacts(m, wait)) : [];

  return (
    <>
      {/* Always mounted, so a screen reader hears each result as it arrives:
          one sentence, while the card is there. */}
      <p role="status" className="visually-hidden">
        {shown ? summaryOf(m, shown) : ''}
      </p>
      {wait ? (
        <div className="practice-results" role="group" aria-label={m.practice.resultsLabel}>
          <p className="practice-results__facts">
            <strong>{headline(m, wait)}</strong>
            {desktop ? ` ${accuracy(m, wait)}` : null}
            {/* Where the line wraps, it wraps between facts, after a dot:
                never inside one, and never leaving a dot to start a line. */}
            {facts.map(([key, text]) => (
              <Fragment key={key}>
                <span aria-hidden="true">{'\u00a0· '}</span>
                <span className="practice-results__fact">{text}</span>
              </Fragment>
            ))}
          </p>
          {compactLandscape || wait.cells.length === 0 ? null : <ResultCells cells={wait.cells} />}
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
