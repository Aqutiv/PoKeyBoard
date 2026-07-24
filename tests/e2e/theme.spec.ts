import { expect, test, type Page } from '@playwright/test';

const DARK_BG = 'rgb(20, 17, 16)'; // --surface-0 #141110
const LIGHT_BG = 'rgb(247, 243, 234)'; // --surface-0 #f7f3ea

// The service worker would satisfy blocked asset requests from its precache
// and defeat the pre-paint isolation below; none of these tests need it.
test.use({ serviceWorkers: 'block' });

function html(page: Page) {
  return page.locator('html');
}

function themeMeta(page: Page) {
  return page.locator('meta[name="theme-color"]');
}

async function gotoSettings(page: Page): Promise<void> {
  await page.goto('/#/settings');
  await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
}

test.describe('theme', () => {
  test('defaults to Conservatory dark', async ({ page }) => {
    await page.goto('/');
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', DARK_BG);
    await expect(themeMeta(page)).toHaveAttribute('content', '#141110');
  });

  test('switching to Ivory recital applies immediately and pre-paints on reload', async ({
    page,
  }) => {
    await gotoSettings(page);
    await page.getByRole('radio', { name: 'Ivory recital — light' }).check();
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', LIGHT_BG);
    await expect(themeMeta(page)).toHaveAttribute('content', '#f7f3ea');
    expect(await page.evaluate(() => localStorage.getItem('pokeyboard.theme'))).toBe('light');

    // Pin the index.html pre-paint script: with the app bundle blocked,
    // only that inline script can have set the attribute after reload.
    await page.route('**/assets/**/*.js', (route) => route.abort());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(themeMeta(page)).toHaveAttribute('content', '#f7f3ea');
  });

  test('Follow system tracks the OS scheme without a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await gotoSettings(page);
    await page.getByRole('radio', { name: 'Follow system' }).check();
    await expect(html(page)).toHaveAttribute('data-theme', 'light');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', DARK_BG);
    expect(await page.evaluate(() => localStorage.getItem('pokeyboard.theme'))).toBe('system');
  });
});
