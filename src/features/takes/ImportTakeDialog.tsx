import { useEffect, useRef, useState } from 'react';
import { formatDurationMs } from '@/utils/timing';
import type { ImportPreview } from './takesService';

interface ImportTakeDialogProps {
  preview: ImportPreview;
  onConfirm: (strategy: 'copy' | 'replace') => void;
  onCancel: () => void;
}

/** Pre-import preview: title, duration, note count, tempo, repairs, collisions. */
export function ImportTakeDialog({ preview, onConfirm, onCancel }: ImportTakeDialogProps) {
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
          Import take
        </h2>
        <dl className="import-preview">
          <div>
            <dt>Title</dt>
            <dd>{take.title}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDurationMs(take.durationMs)}</dd>
          </div>
          <div>
            <dt>Notes</dt>
            <dd>{take.notes.length}</dd>
          </div>
          <div>
            <dt>Tempo</dt>
            <dd>
              {Math.round(take.tempo.bpm)} BPM · {take.tempo.timeSignature.numerator}/
              {take.tempo.timeSignature.denominator}
            </dd>
          </div>
        </dl>

        {repairs.length > 0 ? (
          <div className="import-repairs">
            <p>Minor problems were repaired:</p>
            <ul>
              {repairs.map((repair) => (
                <li key={repair}>{repair}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {preview.collision ? (
          <fieldset className="import-collision">
            <legend>A take with this ID already exists</legend>
            <label>
              <input
                type="radio"
                name="collision"
                checked={strategy === 'copy'}
                onChange={() => setStrategy('copy')}
              />
              Import as a new copy
            </label>
            <label>
              <input
                type="radio"
                name="collision"
                checked={strategy === 'replace'}
                onChange={() => setStrategy('replace')}
              />
              Replace the existing take
            </label>
          </fieldset>
        ) : null}

        <div className="modal__actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="btn btn--primary"
            onClick={() => onConfirm(strategy)}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
