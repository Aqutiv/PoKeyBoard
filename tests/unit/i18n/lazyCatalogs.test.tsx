import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCatalog, loadedCatalog } from '@/i18n';
import { useI18n } from '@/i18n/i18nContext';
import { I18nProvider } from '@/i18n/I18nProvider';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

function Label() {
  const { language, m } = useI18n();
  return (
    <p data-testid="label" lang={language}>
      {m.nav.play}
    </p>
  );
}

const label = () => screen.getByTestId('label');

beforeEach(() => {
  useSettingsStore.setState({ ...SETTINGS_DEFAULTS, language: 'en' });
});

afterEach(cleanup);

describe('catalogs fetched on first use', () => {
  it('has English to hand, and fetches each other catalog once', async () => {
    expect(loadedCatalog('en')).toBeDefined();
    const first = loadCatalog('fr');
    expect(loadCatalog('fr')).toBe(first);
    const fr = await first;
    expect(fr.nav.play).toBe('Jouer');
    expect(loadedCatalog('fr')).toBe(fr);
    await expect(loadCatalog('fr')).resolves.toBe(fr);
  });

  it('keeps showing the language it was in until the new one has arrived', async () => {
    render(
      <I18nProvider>
        <Label />
      </I18nProvider>,
    );
    expect(label()).toHaveTextContent('Play');

    await act(async () => {
      useSettingsStore.setState({ language: 'es' });
    });
    // Asked for, maybe not here yet: never a blank, never a stray key.
    expect(['Play', 'Tocar']).toContain(label().textContent);
    await screen.findByText('Tocar');
    expect(label()).toHaveAttribute('lang', 'es');
    expect(document.documentElement.lang).toBe('es');

    await act(async () => {
      useSettingsStore.setState({ language: 'mg' });
    });
    expect(label().textContent).not.toBe('Play');
    await act(async () => {
      await loadCatalog('mg');
    });
    expect(label()).toHaveAttribute('lang', 'mg');
  });
});
