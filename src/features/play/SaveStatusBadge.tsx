import { useSyncExternalStore } from 'react';
import { persistenceService } from '@/data/persistence';

const subscribe = (onStoreChange: () => void) => persistenceService.subscribe(onStoreChange);
const getSnapshot = () => persistenceService.getStatus();

export function SaveStatusBadge() {
  const { status, message } = useSyncExternalStore(subscribe, getSnapshot);

  if (status === 'idle') return null;
  if (status === 'error') {
    return (
      <span className="save-status save-status--error" role="alert">
        {message ?? 'Save failed'}{' '}
        <button type="button" className="save-status__retry" onClick={() => persistenceService.retry()}>
          Retry
        </button>
      </span>
    );
  }
  return (
    <span className="save-status" role="status">
      {status === 'saving' ? 'Saving…' : 'Saved locally'}
    </span>
  );
}
