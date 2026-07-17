import { expect, type Locator, type Page } from '@playwright/test';

/** The transport control group (avoids clashing with nav button names). */
export function transport(page: Page): Locator {
  return page.getByRole('group', { name: 'Transport' });
}

/** Bottom navigation (its "Play"/"Takes" names clash with other buttons). */
export function nav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Main' });
}

/** Fresh app visit: navigate and wait for the piano core pack to decode. */
export async function gotoAppReady(page: Page): Promise<void> {
  await page.goto('/');
  // Deterministic readiness signal: every core sample is decoded.
  await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'C4 key' })).toBeVisible();
}

/** Set the count-in selector (recording tests want zero). */
export async function setCountIn(page: Page, value: '0' | '1' | '2'): Promise<void> {
  await page.getByLabel('Count-in length').selectOption(value);
}

/** Record a short two-note pass with the computer keyboard. */
export async function recordShortTake(page: Page): Promise<void> {
  await setCountIn(page, '0');
  await transport(page).getByRole('button', { name: 'Record, inactive' }).click();
  await expect(page.getByText('● Recording')).toBeVisible();
  await page.keyboard.down('KeyA'); // C4
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyA');
  await page.keyboard.down('KeyD'); // E4
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(120);
  await transport(page).getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText('● Recording')).toHaveCount(0);
  // Autosave confirmation so reload-based tests are safe.
  await expect(page.getByText('Saved locally')).toBeVisible({ timeout: 10_000 });
}

/** The transport time display, e.g. "0:00.0 / 0:01.2". */
export function transportTime(page: Page) {
  return page.locator('.transport__time');
}

export async function totalDurationText(page: Page): Promise<string> {
  const text = (await transportTime(page).textContent()) ?? '';
  return text.split('/')[1]?.trim() ?? '';
}
