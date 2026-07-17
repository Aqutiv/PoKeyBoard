import { useEffect, useRef, useState } from 'react';
import { useMessages } from '@/i18n/i18nContext';
import type { Messages, Repair } from '@/i18n/types';
import { formatDurationMs } from '@/utils/timing';
import type { ImportPreview } from './takesService';

/** Translate one structured repair record for display. */
function repairText(m: Messages, repair: Repair): string {
  switch (repair.code) {
    case 'timestamp':
      return m.repairs.timestamp({ field: repair.field ?? '' });
    case 'noteIdsAssigned':
      return m.repairs.noteIdsAssigned({ count: repair.count ?? 0 });
    default:
      return m.repairs[repair.code];
  }
}

interface ImportTakeDialogProps {
  preview: ImportPreview;
  onConfirm: (strategy: 'copy' | 'replace') => void;
  onCancel: () => void;
}

/** Pre-import preview: title, duration, note count, tempo, repairs, collisions. */
export function ImportTakeDialog({ preview, onConfirm, onCancel }: ImportTakeDialogProps) {
  const m = useMessages();
  const [strategy, setStrategy] = useState<'copy' | 'replace'>('copy');
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const { take, repairs } = preview.parsed;

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="import-dialog-title" className="modal__title">
          {m.importDialog.title}
        </h2>
        <dl className="import-preview">
          <div>
            <dt>{m.importDialog.titleLabel}</dt>
            <dd>{take.title}</dd>
          </div>
          <div>
            <dt>{m.importDialog.duration}</dt>
            <dd>{formatDurationMs(take.durationMs)}</dd>
          </div>
          <div>
            <dt>{m.importDialog.notes}</dt>
            <dd>{take.notes.length}</dd>
          </div>
          <div>
            <dt>{m.importDialog.tempo}</dt>
            <dd>
              {m.importDialog.tempoValue({
                bpm: Math.round(take.tempo.bpm),
                numerator: take.tempo.timeSignature.numerator,
                denominator: take.tempo.timeSignature.denominator,
              })}
            </dd>
          </div>
        </dl>

        {repairs.length > 0 ? (
          <div className="import-repairs">
            <p>{m.importDialog.repairsHeading}</p>
            <ul>
              {repairs.map((repair) => (
                <li key={`${repair.code}:${repair.field ?? repair.count ?? ''}`}>
                  {repairText(m, repair)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {preview.collision ? (
          <fieldset className="import-collision">
            <legend>{m.importDialog.collisionLegend}</legend>
            <label>
              <input
                type="radio"
                name="collision"
                checked={strategy === 'copy'}
                onChange={() => setStrategy('copy')}
              />
              {m.importDialog.importAsCopy}
            </label>
            <label>
              <input
                type="radio"
                name="collision"
                checked={strategy === 'replace'}
                onChange={() => setStrategy('replace')}
              />
              {m.importDialog.replaceExisting}
            </label>
          </fieldset>
        ) : null}

        <div className="modal__actions">
          <button type="button" className="btn" onClick={onCancel}>
            {m.importDialog.cancel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="btn btn--primary"
            onClick={() => onConfirm(strategy)}
          >
            {m.importDialog.import}
          </button>
        </div>
      </div>
    </div>
  );
}
