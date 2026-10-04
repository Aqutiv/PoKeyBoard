import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { gotoAppReady, nav, transport } from './helpers';

/** Eight bars for the right hand alone, authored in the repo: nothing to fetch. */
const TITLE = 'Ode to Joy (first steps)';

/** The computer key for each note the tune asks for (computerKeyboard.ts, from C4). */
const KEY_FOR_NOTE: Record<string, string> = {
  C4: 'KeyA',
  D4: 'KeyS',
  E4: 'KeyD',
  F4: 'KeyF',
  G4: 'KeyG',
};

/** The notes the right hand plays: both phrases, fourteen each. */
const NOTES = 28;

const card = (page: Page) => page.getByRole('group', { name: 'Practice results' });

/** The track's row in the Library, by the very name the other specs find it by. */
const row = (page: Page) => page.getByRole('button', { name: `Open ${TITLE}`, exact: true });

/**
 * Play the right hand through from the top, each key as playback holds for
 * it: every note right first time.
 */
async function playEveryNote(page: Page): Promise<void> {
  const held = page.locator('.piano-key[data-target="true"]');
  await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
  for (let played = 0; played < NOTES; played += 1) {
    await expect(held).toHaveCount(1, { timeout: 10_000 });
    const note = ((await held.getAttribute('aria-label')) ?? '').replace(/ key$/, '');
    const key = KEY_FOR_NOTE[note];
    if (!key) throw new Error(`The tune asked for ${note}, which no key here plays`);
    await page.keyboard.press(key);
    // Let go before the next hold, which may ask for the same key again.
    await expect(held).toHaveCount(0);
  }
}

test.describe('best results', () => {
  test('keep a run through a Library track as its best, shown in the Library across a reload', async ({
    page,
  }) => {
    // About twenty seconds of music at 150%, on top of the usual.
    test.slow();
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Library' }).click();
    await page.getByRole('button', { name: 'Classics', exact: true }).click();
    await row(page).click();
    await expect(page.locator('.play-header__title')).toHaveText(TITLE);

    await page.getByRole('button', { name: 'Practice right', exact: true }).click();
    await page.getByRole('button', { name: 'Playback speed: 100%' }).click();
    await page.getByRole('menuitemradio', { name: '150%', exact: true }).click();
    await playEveryNote(page);

    const results = card(page);
    await expect(results).toBeVisible({ timeout: 10_000 });
    await expect(results).toContainText(`${NOTES} of ${NOTES} right first time`);
    // A first result is the track's best, but no new one.
    await expect(results).toContainText('Best 100% (at 150%)');
    await expect(results.getByText('New best')).toHaveCount(0);

    await nav(page).getByRole('button', { name: 'Library' }).click();
    await expect(row(page)).toContainText('Right hand · 100%');
    await expect(row(page)).toHaveAccessibleDescription(
      'Best in right hand, waiting for you: 100%',
    );

    // Kept on the device.
    await page.reload();
    await expect(row(page)).toContainText('Right hand · 100%', { timeout: 30_000 });
  });
});
