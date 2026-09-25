import { useRef } from 'react';
import { useMessages } from '@/i18n/i18nContext';
import { useExportUiStore } from '@/state/useExportUiStore';
import { MenuButton } from '@/ui/MenuButton';
import { downloadBlob, shareOrDownloadFile } from '@/utils/download';
import { takeMidiFile } from './midiFile';

interface ShareMenuProps {
  takeId: string;
  disabled?: boolean;
  /** Trigger styling: play header accent button or takes small button. */
  triggerClassName: string;
  /** Which edge the panel aligns to; header uses 'right', takes row 'left'. */
  align?: 'left' | 'right';
}

interface PreparedMidi {
  file: File | null;
  pending: Promise<File | null>;
}

/**
 * One "Share" button opening a menu with Audio (MP3) / Sheet music (PDF) /
 * MIDI. The first two open a dialog of options; MIDI has none to ask, so it is
 * written as the menu opens and handed over the moment it is chosen.
 */
export function ShareMenu({ takeId, disabled, triggerClassName, align = 'right' }: ShareMenuProps) {
  const m = useMessages();
  const openExport = useExportUiStore((s) => s.openExport);
  const openSheetExport = useExportUiStore((s) => s.openSheetExport);
  const midi = useRef<PreparedMidi | null>(null);
  const trackNames = { right: m.share.rightHandTrack, left: m.share.leftHandTrack };

  const prepareMidi = () => {
    const pending = takeMidiFile(takeId, trackNames).catch(() => null);
    const prepared: PreparedMidi = { file: null, pending };
    midi.current = prepared;
    void pending.then((file) => {
      prepared.file = file;
    });
  };

  const shareMidi = () => {
    const prepared = midi.current;
    // Ready: share inside this click, while the share sheet still counts as
    // the user's own doing.
    if (prepared?.file) {
      void shareOrDownloadFile(prepared.file);
      return;
    }
    // Still being written (a very long take): by the time it is, the click's
    // permission to share has lapsed, so it downloads instead.
    void (prepared?.pending ?? takeMidiFile(takeId, trackNames)).then((file) => {
      if (file) downloadBlob(file, file.name);
    });
  };

  return (
    <MenuButton
      label={m.share.trigger}
      menuLabel={m.share.menuLabel}
      disabled={disabled}
      triggerClassName={triggerClassName}
      align={align}
      onOpen={prepareMidi}
      items={[
        { label: m.share.audio, onSelect: () => openExport(takeId) },
        { label: m.share.sheet, onSelect: () => openSheetExport(takeId) },
        { label: m.share.midi, onSelect: shareMidi },
      ]}
    />
  );
}
