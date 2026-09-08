import { useEffect, useId, useState, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

/** Portaled so the piano's scroll containers cannot clip a focused control's hint. */
export function TooltipButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const show = (button: HTMLButtonElement) => {
    const bounds = button.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(bounds.left, window.innerWidth - 248)),
      top: bounds.bottom + 6,
    });
  };
  useEffect(() => {
    if (!position) return;
    const dismiss = () => setPosition(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [position]);
  return (
    <>
      <button
        {...props}
        aria-describedby={position ? id : props['aria-describedby']}
        onFocus={(e) => {
          if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setPosition(null);
          props.onBlur?.(e);
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') show(e.currentTarget);
          props.onPointerEnter?.(e);
        }}
        onPointerLeave={(e) => {
          setPosition(null);
          props.onPointerLeave?.(e);
        }}
        onClick={(e) => {
          setPosition(null);
          props.onClick?.(e);
        }}
      >
        {children}
      </button>
      {position &&
        createPortal(
          <span id={id} role="tooltip" className="control-tooltip" style={position}>
            {props['aria-label']}
          </span>,
          document.body,
        )}
    </>
  );
}
