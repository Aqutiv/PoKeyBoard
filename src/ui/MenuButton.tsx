import { useEffect, useRef, useState } from 'react';
import './menuButton.css';

export interface MenuButtonItem {
  /** Visible label, and the item's accessible name. */
  label: string;
  /**
   * Runs synchronously right after the menu closes, still inside the click
   * event, so it may call input.click() or navigator.share() and keep user
   * activation. Never await before such a call.
   */
  onSelect: () => void;
}

/** One choice within a group: a radio, not an action. */
export interface MenuButtonChoice {
  label: string;
  checked: boolean;
  onSelect: () => void;
}

/** A titled set of mutually exclusive choices inside the panel. */
export interface MenuButtonGroup {
  label: string;
  choices: MenuButtonChoice[];
}

interface MenuButtonProps {
  /** Trigger text; the ▾ caret is appended here. */
  label: string;
  /** Accessible name of the popup. */
  menuLabel: string;
  /** Flat actions. Give either these or `groups`. */
  items?: MenuButtonItem[];
  /** Titled radio groups, for a menu that holds settings rather than actions. */
  groups?: MenuButtonGroup[];
  disabled?: boolean;
  /** Trigger styling: play header accent button or takes small button. */
  triggerClassName: string;
  /** Which edge the panel aligns to. */
  align?: 'left' | 'right';
}

/** One button opening a small menu of actions. */
export function MenuButton({
  label,
  menuLabel,
  items,
  groups,
  disabled,
  triggerClassName,
  align = 'right',
}: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Closing unmounts the panel, so focus inside it would fall to the body.
  const holdsFocus = () =>
    rootRef.current !== null && rootRef.current.contains(document.activeElement);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const returnFocus = holdsFocus();
      setOpen(false);
      if (returnFocus) triggerRef.current?.focus();
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

  return (
    <span className="menu-button" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div
          className={`menu-button__panel menu-button__panel--${align}`}
          role="menu"
          aria-label={menuLabel}
        >
          {items?.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="menu-button__item"
              onClick={() => {
                // setOpen only schedules a render, so onSelect still runs in
                // this click's turn and keeps user activation.
                setOpen(false);
                item.onSelect();
                triggerRef.current?.focus();
              }}
            >
              {item.label}
            </button>
          ))}
          {groups?.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <p className="menu-button__group-label" aria-hidden="true">
                {group.label}
              </p>
              {group.choices.map((choice) => (
                <button
                  key={choice.label}
                  type="button"
                  role="menuitemradio"
                  aria-checked={choice.checked}
                  className={`menu-button__item menu-button__item--radio${
                    choice.checked ? ' is-checked' : ''
                  }`}
                  onClick={() => {
                    setOpen(false);
                    choice.onSelect();
                    triggerRef.current?.focus();
                  }}
                >
                  <span className="menu-button__check" aria-hidden="true">
                    {choice.checked ? '✓' : ''}
                  </span>
                  {choice.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}
