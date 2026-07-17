import { expect, test } from '@playwright/test';
import {
  gotoAppReady,
  recordShortTake,
  totalDurationText,
  transport,
  transportTime,
} from './helpers';

test.describe('recording and playback', () => {
  test('records notes, plays back, pauses, and persists across reload', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);

    // Duration is non-zero after recording.
    const duration = await totalDurationText(page);
    expect(duration).not.toBe('0:00.0');

    // Playback: return to start, play, watch the clock advance.
    await transport(page).getByRole('button', { name: 'Return to beginning' }).click();
    await transport(page).getByRole('button', { name: 'Play' }).click();
    await expect(transport(page).getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.waitForTimeout(400);
    const midText = (await transportTime(page).textContent()) ?? '';
    expect(midText.startsWith('0:00.0')).toBe(false);

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
});
