import { expect, test } from './fixtures';
import { gotoAppReady, nav, recordShortTake, transport } from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });

test('piano controls synchronize with Settings in both directions', async ({ page }) => {
  await gotoAppReady(page);
  await page.getByRole('combobox', { name: 'Piano', exact: true }).selectOption('wurlitzer-ep203w');
  await expect(page.locator('section[data-piano-ready="true"]')).toBeVisible();
  await page.getByRole('slider', { name: 'Piano volume', exact: true }).fill('0.4');
  await nav(page).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('radio', { name: /Wurlitzer/ })).toBeChecked();
  await expect(page.getByRole('slider', { name: 'Piano volume', exact: true })).toHaveValue('0.4');
  await page.getByRole('slider', { name: 'Piano volume', exact: true }).fill('0.65');
  await nav(page).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Piano volume', exact: true })).toHaveValue('0.65');
  await expect(page.getByRole('slider', { name: 'Click volume', exact: true })).toBeVisible();
});

test('library restores the search after opening a result and switching folders', async ({
  page,
}) => {
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Classics', exact: true }).click();
  const filter = page.getByRole('searchbox', { name: 'Filter classics' });
  await filter.fill('fur elise');
  const count = await page.locator('.library-item').count();
  await page.getByRole('button', { name: 'Open Für Elise', exact: true }).click();
  await expect(page.locator('.play-header__title')).toHaveText('Für Elise');
  await nav(page).getByRole('button', { name: 'Library' }).click();
  await expect(filter).toHaveValue('fur elise');
  await expect(page.locator('.library-item')).toHaveCount(count);
  await page.getByRole('button', { name: 'Originals', exact: true }).click();
  await page.getByRole('button', { name: 'Classics', exact: true }).click();
  await expect(filter).toHaveValue('fur elise');
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(filter).toHaveValue('');
  await expect(page.locator('.library-item')).toHaveCount(64);
});

test('Now playing stays visible when paused, resumes, and disappears on stop', async ({ page }) => {
  await gotoAppReady(page);
  await nav(page).getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Open Where Starlight Lingers' }).click();
  await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
  await nav(page).getByRole('button', { name: 'Library' }).click();
  const bar = page.getByRole('complementary', { name: 'Now playing' });
  await expect(bar).toContainText('Where Starlight Lingers');
  await bar.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await nav(page).getByRole('button', { name: 'Settings' }).click();
  await expect(bar).toContainText('Where Starlight Lingers');
  await bar.getByRole('button', { name: 'Now playing: Where Starlight Lingers' }).click();
  await expect(bar).toHaveCount(0);
  const pausedAt = await page.locator('.transport__time').innerText();
  await page.waitForTimeout(250);
  await expect(page.locator('.transport__time')).toHaveText(pausedAt);
  await nav(page).getByRole('button', { name: 'Library' }).click();
  await bar.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await bar.getByRole('button', { name: 'Now playing: Where Starlight Lingers' }).click();
  await expect(page.locator('.transport__time')).not.toHaveText(pausedAt);
  await nav(page).getByRole('button', { name: 'Settings' }).click();
  await bar.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await bar.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(bar).toHaveCount(0);
  await nav(page).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(transport(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
  await nav(page).getByRole('button', { name: 'Settings' }).click();
  await bar.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(bar).toHaveCount(0);
  await nav(page).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(transport(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const stoppedAt = await page.locator('.transport__time').innerText();
  await page.waitForTimeout(250);
  await expect(page.locator('.transport__time')).toHaveText(stoppedAt);
});

test('Now playing disappears when playback finishes naturally', async ({ page }) => {
  await gotoAppReady(page);
  await recordShortTake(page, 1000);
  await transport(page).getByRole('button', { name: 'Return to beginning' }).click();
  await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
  await nav(page).getByRole('button', { name: 'Library' }).click();
  const bar = page.getByRole('complementary', { name: 'Now playing' });
  await expect(bar).toBeVisible();
  await expect(bar).toHaveCount(0, { timeout: 10_000 });
  await nav(page).getByRole('button', { name: 'Settings' }).click();
  await expect(bar).toHaveCount(0);
});

test('opening the actions of the take that is playing keeps it playing', async ({ page }) => {
  await gotoAppReady(page);
  // Long enough to still be sounding after the trip to Takes.
  await recordShortTake(page, 2000);
  await transport(page).getByRole('button', { name: 'Return to beginning' }).click();
  await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
  await nav(page).getByRole('button', { name: 'Takes' }).click();
  const bar = page.getByRole('complementary', { name: 'Now playing' });
  await expect(bar.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  // Opening the row prepares its share file; that used to stop the transport.
  await page.getByRole('button', { name: 'More actions for Untitled take' }).click();
  await expect(page.getByRole('button', { name: 'Share JSON' })).toBeEnabled();
  await expect(bar.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0);
});

test('scrubbing before playback does not show Now playing, but scrubbing a pause keeps Resume', async ({
  page,
}) => {
  await gotoAppReady(page);
  await nav(page).getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Open Where Starlight Lingers' }).click();
  const scrub = async () => {
    const box = await page.locator('.score__canvas').boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 - 30, box!.y + box!.height / 2, { steps: 5 });
    // Release without inertia so this checks the final scrub state.
    await page.waitForTimeout(150);
    await page.mouse.up();
  };
  await scrub();
  await nav(page).getByRole('button', { name: 'Library' }).click();
  const bar = page.getByRole('complementary', { name: 'Now playing' });
  await expect(bar).toHaveCount(0);
  await nav(page).getByRole('button', { name: 'Play', exact: true }).click();
  await transport(page).getByRole('button', { name: 'Play', exact: true }).click();
  await transport(page).getByRole('button', { name: 'Pause', exact: true }).click();
  await scrub();
  await nav(page).getByRole('button', { name: 'Library' }).click();
  await expect(bar.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await bar.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await bar.getByRole('button', { name: 'Stop', exact: true }).click();
  await nav(page).getByRole('button', { name: 'Play', exact: true }).click();
  await scrub();
  await nav(page).getByRole('button', { name: 'Library' }).click();
  await expect(bar).toHaveCount(0);
});

test('rename on Play persists and Takes search handles accents and no matches', async ({
  page,
}) => {
  await gotoAppReady(page);
  await recordShortTake(page);
  await page.getByRole('button', { name: 'Rename: Untitled take' }).click();
  await page.getByRole('textbox', { name: 'New title' }).fill('Étude du soir');
  await page.getByRole('textbox', { name: 'New title' }).press('Enter');
  await expect(page.locator('.play-header__title')).toHaveText('Étude du soir');
  await page.getByRole('button', { name: 'Rename: Étude du soir' }).click();
  await page.getByRole('textbox', { name: 'New title' }).fill('Discard this');
  await page.getByRole('textbox', { name: 'New title' }).press('Escape');
  await expect(page.locator('.play-header__title')).toHaveText('Étude du soir');
  await page.reload();
  await expect(page.locator('.play-header__title')).toHaveText('Étude du soir');
  await nav(page).getByRole('button', { name: 'Takes' }).click();
  await page.getByRole('searchbox', { name: 'Search takes' }).fill('etude');
  await expect(page.getByRole('button', { name: 'Open Étude du soir' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search takes' }).fill('no match');
  await expect(page.getByText('No takes match your search.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByRole('button', { name: 'Open Étude du soir' })).toBeVisible();
});

for (const theme of ['dark', 'light']) {
  test(`desktop controls fit in ${theme} theme and tooltips work with focus`, async ({ page }) => {
    await gotoAppReady(page);
    if (theme === 'light') {
      await nav(page).getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('radio', { name: 'Ivory recital — light' }).check();
      await nav(page).getByRole('button', { name: 'Play', exact: true }).click();
    }
    await expect(page.getByRole('button', { name: 'Listen', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Practice right', exact: true }).click();
    await expect(page.getByText('Playback waits for your notes.')).toBeVisible();
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Return to beginning' }).focus();
    await expect(page.getByRole('tooltip')).toHaveText('Return to beginning');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    const keyboard = await page.locator('.piano__keys').boundingBox();
    expect(keyboard!.y + keyboard!.height).toBeLessThanOrEqual(900);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
    await page.screenshot({ path: `test-results/daily-${theme}.png` });
  });
}

test('narrow phones retain compact modes and usable piano controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await gotoAppReady(page);
  await expect(page.getByRole('combobox', { name: 'Piano', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toHaveCount(0);
  await transport(page).getByRole('button', { name: 'Modes' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Training — right hand' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  const keyboard = await page.locator('.piano__keys').boundingBox();
  expect(keyboard!.y + keyboard!.height).toBeLessThanOrEqual(740);
  await page.screenshot({ path: 'test-results/daily-phone.png' });
});
