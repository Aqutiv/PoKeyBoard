import { useEffect, useRef, useState } from 'react';
import { useMessages } from '@/i18n/i18nContext';
import { useExportUiStore } from '@/state/useExportUiStore';
import './export.css';

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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const openExport = useExportUiStore((s) => s.openExport);
  const openSheetExport = useExportUiStore((s) => s.openSheetExport);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const choose = (action: (id: string) => void) => {
    setOpen(false);
    action(takeId);
  };

  return (
    <span className="share-menu" ref={rootRef}>
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {m.share.trigger} <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div
          className={`share-menu__panel share-menu__panel--${align}`}
          role="menu"
          aria-label={m.share.menuLabel}
        >
          <button
            type="button"
            role="menuitem"
            className="share-menu__item"
            onClick={() => choose(openExport)}
          >
            {m.share.audio}
          </button>
          <button
            type="button"
            role="menuitem"
            className="share-menu__item"
            onClick={() => choose(openSheetExport)}
          >
            {m.share.sheet}
          </button>
        </div>
      ) : null}
    </span>
  );
}
