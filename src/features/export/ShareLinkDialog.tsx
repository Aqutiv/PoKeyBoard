import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { libraryLinkUrl, takeLinkUrl } from '@/app/hashLinks';
import { isLibraryTakeId, LIBRARY_ID_PREFIX } from '@/domain/libraryTakes';
import { encodeTakeLink } from '@/domain/takeLink';
import { libraryTrackSummary } from '@/features/library/catalog';
import { snapshotTake, takeToJsonFile } from '@/features/takes/takesService';
import { useI18n } from '@/i18n/i18nContext';
import { useExportUiStore } from '@/state/useExportUiStore';
import { shareOrDownloadFile } from '@/utils/download';
import './export.css';

/** Past this many characters some apps cut a link short, so the dialog says so. */
export const LONG_LINK_CHARS = 32_000;
/**
 * Past this many characters no link is offered, only the file. A link that
 * long is hard to send anywhere; the decoder would still read one twice as
 * long, so a link made here always opens.
 */
export const MAX_LINK_CHARS = 2_000_000;

type Prepared =
  | { kind: 'preparing' }
  | { kind: 'link'; title: string; url: string; library: boolean; file: File | null }
  | { kind: 'tooLong'; file: File }
  | { kind: 'failed' };

/**
 * Everything the dialog offers, made once as it opens, so that every button
 * acts inside its own click: a share sheet opened after an await may find the
 * click's permission already spent.
 *
 * The take is read without disturbing anything (`snapshotTake`), so playback
 * carries on under the dialog. A Library track is never edited or stored —
 * opening one gives exactly its catalog entry — so its link only names it.
 */
async function prepare(takeId: string): Promise<Prepared> {
  const take = await snapshotTake(takeId);
  if (isLibraryTakeId(takeId)) {
    return {
      kind: 'link',
      title: take?.title ?? libraryTrackSummary(takeId)?.title ?? '',
      url: libraryLinkUrl(takeId.slice(LIBRARY_ID_PREFIX.length)),
      library: true,
      file: take ? takeToJsonFile(take) : null,
    };
  }
  if (!take) return { kind: 'failed' };
  const file = takeToJsonFile(take);
  let url: string | null = null;
  try {
    url = takeLinkUrl(encodeTakeLink(take));
  } catch {
    // A take the link format cannot hold at all: the file still can.
  }
  if (url === null || url.length > MAX_LINK_CHARS) return { kind: 'tooLong', file };
  return { kind: 'link', title: take.title, url, library: false, file };
}

function selectAll(event: FocusEvent<HTMLInputElement>): void {
  event.currentTarget.select();
}

/**
 * Share → Link…: a take carried whole in a link, or a Library track named by
 * one. Copy puts the link on the clipboard (or, where the clipboard refuses,
 * selects it for the keyboard); Share… hands it to the system share sheet where
 * there is one; and the take can always go as a file instead.
 */
export function ShareLinkDialog() {
  const { m, locale } = useI18n();
  const takeId = useExportUiStore((state) => state.linkRequestedTakeId);
  const close = useExportUiStore((state) => state.closeLinkShare);
  // Each keyed by the take it was made for, so a dialog reopened for another
  // take starts afresh rather than showing the last one's link for a moment.
  const [prepared, setPrepared] = useState<{ takeId: string; result: Prepared } | null>(null);
  const [status, setStatus] = useState<{ takeId: string; text: string } | null>(null);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!takeId) return;
    let alive = true;
    void prepare(takeId).then(
      (result) => {
        if (alive) setPrepared({ takeId, result });
      },
      () => {
        if (alive) setPrepared({ takeId, result: { kind: 'failed' } });
      },
    );
    return () => {
      alive = false;
    };
  }, [takeId]);

  useEffect(() => {
    if (!takeId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [takeId, close]);

  const phase: Prepared =
    takeId !== null && prepared?.takeId === takeId ? prepared.result : { kind: 'preparing' };

  // Once there is something to do, the first thing to do has the focus.
  useEffect(() => {
    primaryRef.current?.focus();
  }, [phase.kind]);

  if (!takeId) return null;

  const say = (text: string) => setStatus({ takeId, text });
  const statusText = status?.takeId === takeId ? status.text : '';

  /** Leave the link selected in its field and say how to copy it from there. */
  const offerManualCopy = () => {
    fieldRef.current?.focus();
    fieldRef.current?.select();
    say(m.share.linkCopyManual);
  };

  const copy = (url: string) => {
    if (typeof navigator.clipboard?.writeText !== 'function') {
      offerManualCopy();
      return;
    }
    void navigator.clipboard.writeText(url).then(() => say(m.share.linkCopied), offerManualCopy);
  };

  const shareLink = (title: string, url: string) => {
    void navigator.share({ title, url }).then(
      () => say(m.takes.shared),
      (error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        // The sheet refused it — a long link can be too much for one — but
        // the link itself is right there to copy.
        offerManualCopy();
      },
    );
  };

  const sendFile = (file: File) => {
    void shareOrDownloadFile(file).then((how) => {
      if (how !== 'cancelled') say(how === 'shared' ? m.takes.shared : m.takes.downloaded);
    });
  };

  const file = phase.kind === 'link' || phase.kind === 'tooLong' ? phase.file : null;
  const canShare = typeof navigator.share === 'function';

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-link-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="share-link-title" className="modal__title">
          {m.share.linkTitle}
        </h2>

        {phase.kind === 'preparing' ? (
          <p className="export-stage">{m.share.linkPreparing}</p>
        ) : null}

        {phase.kind === 'link' ? (
          <>
            {phase.title ? <p className="export-summary">{phase.title}</p> : null}
            <input
              ref={fieldRef}
              className="share-link__field"
              type="text"
              readOnly
              spellCheck={false}
              value={phase.url}
              aria-label={m.share.linkField}
              onFocus={selectAll}
            />
            <div className="share-link__actions">
              <button
                ref={primaryRef}
                type="button"
                className="btn btn--primary"
                onClick={() => copy(phase.url)}
              >
                {m.share.linkCopy}
              </button>
              {canShare ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => shareLink(phase.title, phase.url)}
                >
                  {m.share.linkShare}
                </button>
              ) : null}
            </div>
            {phase.url.length > LONG_LINK_CHARS ? (
              <p className="share-link__note">
                {m.share.linkLong({
                  characters: phase.url.length.toLocaleString(locale),
                })}
              </p>
            ) : null}
            <p className="export-note">
              {phase.library ? m.share.linkLibrary : m.share.linkPrivacy}
            </p>
          </>
        ) : null}

        {phase.kind === 'tooLong' ? (
          <p className="share-link__note">{m.share.linkTooLong}</p>
        ) : null}
        {phase.kind === 'failed' ? (
          <p className="export-warning" role="alert">
            {m.share.linkFailed}
          </p>
        ) : null}

        <p className="share-link__status" role="status">
          {statusText}
        </p>

        <div className="modal__actions modal__actions--wrap">
          {file ? (
            <button
              ref={phase.kind === 'tooLong' ? primaryRef : undefined}
              type="button"
              className={`btn share-link__file${phase.kind === 'tooLong' ? ' btn--primary' : ''}`}
              onClick={() => sendFile(file)}
            >
              {m.share.linkSendFile}
            </button>
          ) : null}
          <button
            ref={phase.kind === 'failed' ? primaryRef : undefined}
            type="button"
            className="btn"
            onClick={close}
          >
            {m.share.linkClose}
          </button>
        </div>
      </div>
    </div>
  );
}
