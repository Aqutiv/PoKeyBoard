import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import type { ImportPreview } from '@/features/takes/takesService';
import { useImportUiStore } from '@/state/useImportUiStore';

function previewOf(title: string): ImportPreview {
  return {
    parsed: { take: createEmptyTake({ title }), repairs: [] },
    collision: false,
    fileName: `${title}.pokeyboard.json`,
  };
}

beforeEach(() => {
  useImportUiStore.setState({ preview: null, failure: null });
});

describe('the import inbox store', () => {
  it('starts with nothing to show', () => {
    const { preview, failure } = useImportUiStore.getState();
    expect(preview).toBeNull();
    expect(failure).toBeNull();
  });

  it('holds a preview until it is answered', () => {
    const preview = previewOf('Scale');
    useImportUiStore.getState().openPreview(preview);
    expect(useImportUiStore.getState().preview).toBe(preview);

    useImportUiStore.getState().closePreview();
    expect(useImportUiStore.getState().preview).toBeNull();
  });

  it('lets a newer preview replace one still waiting', () => {
    useImportUiStore.getState().openPreview(previewOf('First'));
    const second = previewOf('Second');
    useImportUiStore.getState().openPreview(second);
    expect(useImportUiStore.getState().preview).toBe(second);
  });

  it('holds a failure until it is dismissed', () => {
    useImportUiStore.getState().fail('storageFailed');
    expect(useImportUiStore.getState().failure).toBe('storageFailed');

    useImportUiStore.getState().dismissFailure();
    expect(useImportUiStore.getState().failure).toBeNull();
  });

  it('keeps a failure and a waiting preview apart, so neither loses the other', () => {
    const preview = previewOf('Waiting');
    useImportUiStore.getState().openPreview(preview);
    useImportUiStore.getState().fail('storageFull');
    expect(useImportUiStore.getState().preview).toBe(preview);

    useImportUiStore.getState().dismissFailure();
    expect(useImportUiStore.getState().preview).toBe(preview);

    useImportUiStore.getState().fail('generic');
    useImportUiStore.getState().closePreview();
    expect(useImportUiStore.getState().failure).toBe('generic');
  });
});
