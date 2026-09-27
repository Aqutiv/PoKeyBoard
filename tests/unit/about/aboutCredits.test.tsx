import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AboutPage } from '@/features/about/AboutPage';
import { catalogs, SUPPORTED_LANGUAGES } from '@/i18n';
import { I18nContext } from '@/i18n/i18nContext';
import { en } from '@/i18n/en';

afterEach(cleanup);

describe('the About credits', () => {
  it('credit the music font the printed sheet is drawn in, with its licence', () => {
    render(
      <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
        <AboutPage />
      </I18nContext.Provider>,
    );
    const link = screen.getByRole('link', { name: 'Bravura' });
    expect(link).toHaveAttribute('href', 'https://github.com/steinbergmedia/bravura');
    const row = link.closest('li')!;
    expect(row).toHaveTextContent(en.about.software.musicFont);
    expect(row).toHaveTextContent(/· OFL$/);
    // Next to the other font the app ships.
    const software = within(row.parentElement!)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(software.indexOf('Bravura')).toBe(software.indexOf('Fraunces') + 1);
  });

  it('say what the font is for in every language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(catalogs[lang].about.software.musicFont.length, lang).toBeGreaterThan(0);
      expect(catalogs[lang].about.software.musicFont, lang).toContain('Steinberg');
    }
  });
});
