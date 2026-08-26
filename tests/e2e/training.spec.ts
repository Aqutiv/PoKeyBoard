import { expect, test } from './fixtures';
import { gotoAppReady, recordShortTake, transport, transportTime } from './helpers';

/** Pick a mode out of the transport's one mode menu. */
async function chooseMode(page: import('@playwright/test').Page, name: RegExp): Promise<void> {
  await transport(page).getByRole('button', { name: 'Modes' }).click();
  await page.getByRole('menuitemradio', { name }).click();
}

test.describe('training playback', () => {
  test('holds for the user at every note, then carries on', async ({ page }) => {
    await gotoAppReady(page);
    // Long enough notes that the two onsets are clearly apart in the take.
    await recordShortTake(page, 350);

    await transport(page).getByRole('button', { name: 'Return to beginning' }).click();
    await chooseMode(page, /both hands/);
    await transport(page).getByRole('button', { name: 'Play' }).click();

    // The take opens on C4, so playback holds before it has played anything.
    await expect(page.getByText('Waiting for you to play the lit keys')).toBeVisible();
    await expect(page.locator('.piano-key[data-target="true"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'C4 key' })).toHaveAttribute(
      'data-target',
      'true',
    );
    // Holding means holding: the clock does not move on its own.
    await page.waitForTimeout(500);
    await expect(transportTime(page)).toContainText('0:00.0');

    // Playing the lit key lets it through, and it stops again at the next one.
    await page.keyboard.press('KeyA'); // C4
    await expect(page.getByRole('button', { name: 'E4 key' })).toHaveAttribute(
      'data-target',
      'true',
      { timeout: 5_000 },
    );
    await expect(transportTime(page)).not.toContainText('0:00.0');

    // The last note played, playback runs out to the end and parks.
    await page.keyboard.press('KeyD'); // E4
    await expect(page.getByText('Waiting for you to play the lit keys')).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(transport(page).getByRole('button', { name: 'Play' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('plays straight through in simple mode, and remembers the choice', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page, 350);

    await chooseMode(page, /left hand/);
    // Settings autosave is debounced (500 ms); outrun it and the reload reads
    // the previous row back.
    await page.waitForTimeout(800);
    await page.reload();
    await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });

    await transport(page).getByRole('button', { name: 'Modes' }).click();
    await expect(page.getByRole('menuitemradio', { name: /left hand/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('Escape');

    // Both recorded notes are right-hand, so training the left hand never
    // holds: playback runs to the end on its own.
    await transport(page).getByRole('button', { name: 'Return to beginning' }).click();
    await transport(page).getByRole('button', { name: 'Play' }).click();
    await expect(page.getByText('Waiting for you to play the lit keys')).toHaveCount(0);
    await expect(transport(page).getByRole('button', { name: 'Play' })).toBeVisible({
      timeout: 10_000,
    });
  });
});
