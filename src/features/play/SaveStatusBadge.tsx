import { useSyncExternalStore } from 'react';
import { persistenceService } from '@/data/persistence';
import { useMessages } from '@/i18n/i18nContext';

const subscribe = (onStoreChange: () => void) => persistenceService.subscribe(onStoreChange);
const getSnapshot = () => persistenceService.getStatus();

export function SaveStatusBadge() {
  const m = useMessages();
  const { status, messageKey } = useSyncExternalStore(subscribe, getSnapshot);

  if (status === 'idle') return null;
  if (status === 'error') {
    return (
      <span className="save-status save-status--error" role="alert">
        {messageKey ? m.errors[messageKey] : m.save.failed}{' '}
        <button
          type="button"
          className="save-status__retry"
          onClick={() => persistenceService.retry()}
        >
          {m.save.retry}
        </button>
      </span>
    );
  }
  return (
    <span className="save-status" role="status">
      {status === 'saving' ? m.save.saving : m.save.savedLocally}
    </span>
  );
}
