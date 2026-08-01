/**
 * Learn levels, in tab order.
 *
 * This module must stay free of chapter and content imports: the settings store
 * and its Zod schema take the id type from here, so anything pulled in lands in
 * the boot bundle. Same contract as features/library/folders.ts.
 */
export const LEARN_LEVEL_IDS = ['beginner', 'advanced'] as const;

export type LearnLevelId = (typeof LEARN_LEVEL_IDS)[number];

export const DEFAULT_LEARN_LEVEL: LearnLevelId = 'beginner';
