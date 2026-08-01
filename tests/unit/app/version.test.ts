import { describe, expect, it } from 'vitest';
import { APP_BUILD_LABEL, APP_VERSION, formatBuildLabel } from '@/app/version';

describe('formatBuildLabel', () => {
  it('appends both the commit and the date when the build has them', () => {
    expect(formatBuildLabel('0.2.0', 'a1b2c3d', '2026-08-02')).toBe('0.2.0 (a1b2c3d · 2026-08-02)');
  });

  it('drops the separator when only one part is available', () => {
    expect(formatBuildLabel('0.2.0', 'a1b2c3d', '')).toBe('0.2.0 (a1b2c3d)');
    expect(formatBuildLabel('0.2.0', '', '2026-08-02')).toBe('0.2.0 (2026-08-02)');
  });

  it('falls back to the bare version outside a git checkout', () => {
    expect(formatBuildLabel('0.2.0', '', '')).toBe('0.2.0');
  });
});

describe('build-time defines', () => {
  it('injects a real semver, not the old npm_package_version placeholder', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('starts the About label with the version', () => {
    expect(APP_BUILD_LABEL.startsWith(APP_VERSION)).toBe(true);
  });
});
