import { useMessages } from '@/i18n/i18nContext';
import { useExportUiStore } from '@/state/useExportUiStore';
import { MenuButton } from '@/ui/MenuButton';

interface ShareMenuProps {
  takeId: string;
  disabled?: boolean;
  /** Trigger styling: play header accent button or takes small button. */
  triggerClassName: string;
  /** Which edge the panel aligns to; header uses 'right', takes row 'left'. */
  align?: 'left' | 'right';
}

/** One "Share" button opening a menu with Audio (MP3) / Sheet music (PDF). */
export function ShareMenu({ takeId, disabled, triggerClassName, align = 'right' }: ShareMenuProps) {
  const m = useMessages();
  const openExport = useExportUiStore((s) => s.openExport);
  const openSheetExport = useExportUiStore((s) => s.openSheetExport);

  return (
    <MenuButton
      label={m.share.trigger}
      menuLabel={m.share.menuLabel}
      disabled={disabled}
      triggerClassName={triggerClassName}
      align={align}
      items={[
        { label: m.share.audio, onSelect: () => openExport(takeId) },
        { label: m.share.sheet, onSelect: () => openSheetExport(takeId) },
      ]}
    />
  );
}
