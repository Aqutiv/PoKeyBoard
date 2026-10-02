/**
 * What the Play page shows above the keys: the scrolling score, or the
 * falling notes. This module must stay free of imports: the settings store
 * and its repository take the id type from here.
 */
export const PLAY_VIEWS = ['score', 'waterfall'] as const;

export type PlayView = (typeof PLAY_VIEWS)[number];

export const DEFAULT_PLAY_VIEW: PlayView = 'score';
