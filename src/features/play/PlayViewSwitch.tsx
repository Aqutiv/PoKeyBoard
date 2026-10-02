import type { ReactNode } from 'react';
import { useMessages } from '@/i18n/i18nContext';
import type { PlayView } from './playView';

interface PlayViewSwitchProps {
  /** The view the page shows above the keys. */
  view: PlayView;
  /** Short landscape is showing the keys alone, over either view. */
  keysOnly: boolean;
  /** Offer the keys alone: only short landscape is too short for both. */
  offerKeys: boolean;
  onView: (view: PlayView) => void;
  onKeysOnly: () => void;
}

/** Shared by the three icons, which only narrow screens show; see index.css. */
const ICON = {
  className: 'play-view-switch__icon',
  width: 18,
  height: 18,
  viewBox: '0 0 18 18',
  'aria-hidden': true,
  focusable: 'false',
} as const;

function StaffIcon() {
  return (
    <svg {...ICON} fill="none" stroke="currentColor" strokeWidth={1.1}>
      <path d="M1 3h16M1 6h16M1 9h16M1 12h16M1 15h16" />
      <ellipse
        cx="7.4"
        cy="13.5"
        rx="2.4"
        ry="1.8"
        fill="currentColor"
        stroke="none"
        transform="rotate(-20 7.4 13.5)"
      />
      <path d="M9.6 13V2" strokeWidth={1.4} />
    </svg>
  );
}

function FallingIcon() {
  return (
    <svg {...ICON} fill="currentColor">
      <rect x="1.5" y="1.5" width="4" height="7.5" rx="1.3" />
      <rect x="7" y="5.5" width="4" height="8.5" rx="1.3" />
      <rect x="12.5" y="1" width="4" height="4.5" rx="1.3" />
      <rect x="1" y="15.5" width="16" height="1.6" rx="0.8" />
    </svg>
  );
}

function KeysIcon() {
  return (
    <svg {...ICON} fill="none" stroke="currentColor" strokeWidth={1.1}>
      <rect x="1.5" y="3" width="15" height="12" rx="1.5" />
      <path d="M6.5 15V9.5M11.5 15V9.5" />
      <rect x="5" y="3" width="3" height="6.5" fill="currentColor" stroke="none" />
      <rect x="10" y="3" width="3" height="6.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * What the Play page shows above the keys: the score or the falling notes,
 * remembered, and in short landscape, which has no room for both, the keys
 * alone for the while the phone lies on its side. Narrow screens show each
 * option as an icon, its name kept for screen readers.
 */
export function PlayViewSwitch({
  view,
  keysOnly,
  offerKeys,
  onView,
  onKeysOnly,
}: PlayViewSwitchProps) {
  const m = useMessages();
  const option = (
    key: string,
    label: string,
    icon: ReactNode,
    pressed: boolean,
    onClick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      className={`play-view-switch__option${pressed ? ' is-selected' : ''}`}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {icon}
      <span className="play-view-switch__text">{label}</span>
    </button>
  );
  return (
    <div className="play-view-switch" role="group" aria-label={m.play.viewLabel}>
      {option('score', m.play.notationView, <StaffIcon />, !keysOnly && view === 'score', () =>
        onView('score'),
      )}
      {option(
        'waterfall',
        m.play.fallingView,
        <FallingIcon />,
        !keysOnly && view === 'waterfall',
        () => onView('waterfall'),
      )}
      {offerKeys ? option('keys', m.play.keyboardView, <KeysIcon />, keysOnly, onKeysOnly) : null}
    </div>
  );
}
