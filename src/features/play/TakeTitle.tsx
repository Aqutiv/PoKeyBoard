import { useRef, useState } from 'react';
import { isLibraryTakeId } from '@/domain/libraryTakes';
import { renameTake } from '@/features/takes/takesService';
import { useMessages } from '@/i18n/i18nContext';
import { useTakeStore } from '@/state/useTakeStore';
import { toErrorMessageKey } from '@/utils/errors';

export function TakeTitle({ disabled }: { disabled: boolean }) {
  const m = useMessages();
  const id = useTakeStore((s) => s.take.id);
  const title = useTakeStore((s) => s.take.title);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const committing = useRef(false);

  const finish = () => {
    setEditing(false);
    requestAnimationFrame(() => button.current?.focus());
  };
  const commit = async () => {
    if (committing.current) return;
    committing.current = true;
    try {
      await renameTake(id, draft);
      finish();
    } catch (reason) {
      setError(m.errors[toErrorMessageKey(reason)]);
    } finally {
      committing.current = false;
    }
  };

  if (isLibraryTakeId(id)) return <h1 className="play-header__title">{title}</h1>;
  return (
    <div className="take-title">
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void commit();
          }}
        >
          <input
            autoFocus
            disabled={disabled}
            maxLength={200}
            aria-label={m.takes.newTitle}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                finish();
              }
            }}
          />
          <button type="submit" disabled={disabled} className="btn btn--small">
            {m.takes.rename}
          </button>
        </form>
      ) : (
        <h1 className="play-header__title" aria-label={title}>
          <button
            ref={button}
            type="button"
            disabled={disabled}
            title={m.takes.rename}
            aria-label={`${m.takes.rename}: ${title}`}
            onClick={() => {
              setDraft(title);
              setError(null);
              setEditing(true);
            }}
          >
            {title}
            <svg
              className="take-title__edit"
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="m15 4 5 5-11 11H4v-5zM13 6l5 5" />
            </svg>
          </button>
        </h1>
      )}
      {error ? (
        <span role="alert" className="save-status--error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
