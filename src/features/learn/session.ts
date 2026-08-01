import type { LearnChapterId } from './types';

/**
 * Which chapter is open, for as long as the app keeps running.
 *
 * `LearnPage` unmounts whenever the user visits another tab, so its own state
 * cannot survive a trip to Library and back — mid-lesson, that dumped them
 * back at the outline. This lives outside React so a remount can pick it up.
 *
 * Deliberately in memory only. Which step you reached is real progress and is
 * persisted; being *inside* a chapter is a property of this sitting, and
 * reopening the app should start at the outline rather than drop you into a
 * lesson you may not remember choosing.
 */
let openChapterId: LearnChapterId | null = null;

export function getOpenChapter(): LearnChapterId | null {
  return openChapterId;
}

export function setOpenChapter(id: LearnChapterId | null): void {
  openChapterId = id;
}
