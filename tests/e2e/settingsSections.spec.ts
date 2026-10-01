import { expect, test } from './fixtures';
import {
  chooseSettingsSection,
  gotoAppReady,
  openSettings,
  persistedSetting,
  settingsSections,
} from './helpers';

test.describe('Settings sections', () => {
  test('opens on Sound and shows one section at a time', async ({ page }) => {
    await gotoAppReady(page);
    await openSettings(page);
    const sections = settingsSections(page);
    await expect(sections.getByRole('button')).toHaveText(['Sound', 'Playing', 'Display', 'App']);
    await expect(sections.getByRole('button', { name: 'Sound', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('slider', { name: 'Piano volume' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Note labels on keys' })).toHaveCount(0);

    await chooseSettingsSection(page, 'Display');
    await expect(page.getByRole('checkbox', { name: 'Note labels on keys' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Piano volume' })).toHaveCount(0);
  });

  test('opens where it was left, after a reload too', async ({ page }) => {
    await gotoAppReady(page);
    await openSettings(page, 'App');
    // Settings save on a debounce; reload only once the row is down.
    await expect.poll(() => persistedSetting(page, 'settingsSection')).toBe('app');
    await page.reload();
    await expect(
      settingsSections(page).getByRole('button', { name: 'App', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Reset settings' })).toBeVisible();
  });

  test('stays on App when its Reset puts everything else back', async ({ page }) => {
    await gotoAppReady(page);
    await openSettings(page, 'Display');
    await page.getByRole('checkbox', { name: 'Note labels on keys' }).uncheck();

    await chooseSettingsSection(page, 'App');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Reset settings' }).click();
    await expect(
      settingsSections(page).getByRole('button', { name: 'App', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    await chooseSettingsSection(page, 'Display');
    await expect(page.getByRole('checkbox', { name: 'Note labels on keys' })).toBeChecked();
  });

  test('moves a choice with the arrow keys, as radio buttons do', async ({ page }) => {
    await gotoAppReady(page);
    await openSettings(page, 'Playing');
    const sensitivity = page.getByRole('radiogroup', { name: 'Touch sensitivity' });
    await sensitivity.getByRole('radio', { name: 'Normal' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(sensitivity.getByRole('radio', { name: 'Firm' })).toBeChecked();
    await expect.poll(() => persistedSetting(page, 'touchSensitivity')).toBe('firm');
  });

  test('keeps a download going, and in view, through a visit to another section', async ({
    page,
  }) => {
    // Every Wurlitzer recording waits until released, so the download is
    // still running when the player comes back to it.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/wurlitzer-ep203w-v*/*.sample', async (route) => {
      await held;
      await route.continue();
    });

    await gotoAppReady(page);
    await openSettings(page);
    const card = page
      .locator('.piano-card')
      .filter({ has: page.locator('strong', { hasText: /^Wurlitzer$/ }) });
    await card.getByRole('button', { name: /^Download / }).click();
    await expect(card.getByText(/^Downloading…/)).toBeVisible();

    await chooseSettingsSection(page, 'Display');
    await chooseSettingsSection(page, 'Sound');
    // The card is a new one, but the download is the same: still going, and
    // nothing offered that would start it again.
    await expect(card.getByText(/^Downloading…/)).toBeVisible();
    await expect(card.getByRole('button', { name: /^Download / })).toHaveCount(0);

    release();
    await expect(card.getByRole('button', { name: /^Delete / })).toBeVisible({ timeout: 30_000 });
  });
});
