import { expect, test } from './fixtures';
import {
  gotoAppReady,
  nav,
  recordShortTake,
  totalDurationText,
  transport,
  transportTime,
} from './helpers';

test.describe('recording and playback', () => {
  test('records notes, plays back, pauses, and persists across reload', async ({ page }) => {
    await gotoAppReady(page);
    // Longer notes than the default: this is the one test that has to observe
    // playback in flight, so the take must outlast a poll interval.
    await recordShortTake(page, 350);

    // Duration is non-zero after recording.
    const duration = await totalDurationText(page);
    expect(duration).not.toBe('0:00.0');

    // Playback: return to start, play, watch the clock advance.
    await transport(page).getByRole('button', { name: 'Return to beginning' }).click();
    await transport(page).getByRole('button', { name: 'Play' }).click();
    await expect(transport(page).getByRole('button', { name: 'Pause' })).toBeVisible();
    // The first non-zero reading is the proof the clock is running; polling for
    // it beats sleeping a guessed interval and reading once.
    await expect
      .poll(async () => (await transportTime(page).textContent()) ?? '', { timeout: 5_000 })
      .not.toMatch(/^0:00\.0/);

    // Playback auto-pauses at the end of the short take.
    await expect(transport(page).getByRole('button', { name: 'Play' })).toBeVisible({
      timeout: 10_000,
    });

    // Reload: the take and its duration are restored.
    await page.reload();
    await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
    await expect.poll(async () => totalDurationText(page), { timeout: 10_000 }).toBe(duration);
  });

  test('undo last pass removes the recorded notes', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);
    await expect(page.getByRole('button', { name: 'Undo last recording pass' })).toBeVisible();
    await page.getByRole('button', { name: 'Undo last recording pass' }).click();
    await expect.poll(async () => totalDurationText(page), { timeout: 5_000 }).toBe('0:00.0');
  });

  test('count-in delays recording start', async ({ page }) => {
    await gotoAppReady(page);
    await page.getByLabel('Count-in length').selectOption('1');
    await transport(page).getByRole('button', { name: 'Record, inactive' }).click();
    await expect(page.getByText('Count-in…')).toBeVisible();
    await expect(page.getByText('● Recording')).toBeVisible({ timeout: 5_000 });
    await transport(page).getByRole('button', { name: 'Stop', exact: true }).click();
  });

  test('metronome toggles and shows beat indicators', async ({ page }) => {
    await gotoAppReady(page);
    const toggle = page.getByRole('button', { name: /Metronome/ });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.metronome__dot.is-active')).toHaveCount(1, { timeout: 5_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('tempo follows the playhead through a library track’s tempo changes', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Library' }).click();
    await page.getByRole('button', { name: 'Open Forward, Gently' }).click();

    const bpm = page.getByLabel('Beats per minute');
    await expect(bpm).toHaveValue('96');

    // Bar 25 ("Open and radiant") is marked 104 and starts at 60 s.
    await page.getByLabel('Seek position').fill('61000');
    await expect(bpm).toHaveValue('104');
    // The field edits that section, not the opening tempo.
    await expect(page.getByText('from bar 25')).toBeVisible();

    // The closing bar is the slowest.
    await page.getByLabel('Seek position').fill('78000');
    await expect(bpm).toHaveValue('76');
    await expect(page.getByText('from bar 32')).toBeVisible();

    // Back at the start it reads — and edits — the take's own tempo.
    await transport(page).getByRole('button', { name: 'Return to beginning' }).click();
    await expect(bpm).toHaveValue('96');
    await expect(page.getByText(/from bar/)).toHaveCount(0);
  });
});
