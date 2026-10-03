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
  useImportUiStore.setState({ preview: null, failure: null, pendingLink: null });
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

  it('numbers every preview it opens, so a newer one is told from the one it replaces', () => {
    const start = useImportUiStore.getState().previewSeq;
    useImportUiStore.getState().openPreview(previewOf('First'));
    useImportUiStore.getState().openPreview(previewOf('Second'));
    expect(useImportUiStore.getState().previewSeq).toBe(start + 2);

    // The count only goes up: closing a preview does not hand its number out again.
    useImportUiStore.getState().closePreview();
    useImportUiStore.getState().openPreview(previewOf('Third'));
    expect(useImportUiStore.getState().previewSeq).toBe(start + 3);
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

describe('a share link waiting in the store', () => {
  it('is held until it is claimed, and claimed once', () => {
    const link = { kind: 'take', version: 1, data: 'AbC' } as const;
    useImportUiStore.getState().receiveLink(link);
    expect(useImportUiStore.getState().pendingLink).toBe(link);

    expect(useImportUiStore.getState().claimLink()).toBe(link);
    expect(useImportUiStore.getState().pendingLink).toBeNull();
    // A second claim, such as StrictMode's second effect, finds nothing.
    expect(useImportUiStore.getState().claimLink()).toBeNull();
  });

  it('gives way to a newer link, and leaves the preview and the failure alone', () => {
    const preview = previewOf('Waiting');
    useImportUiStore.getState().openPreview(preview);
    useImportUiStore.getState().fail('generic');
    useImportUiStore.getState().receiveLink({ kind: 'library', trackId: 'fur-elise' });
    const newer = { kind: 'library', trackId: 'good-night' } as const;
    useImportUiStore.getState().receiveLink(newer);

    expect(useImportUiStore.getState().pendingLink).toBe(newer);
    expect(useImportUiStore.getState().preview).toBe(preview);
    expect(useImportUiStore.getState().failure).toBe('generic');
  });
});
