/** The semver from package.json. Bumped by hand at milestones only — see the
 * "App version" section of DEPLOYMENT.md. Individual deploys are identified by
 * the build stamp below, not by this number. */
export const APP_VERSION = __APP_VERSION__;

/** Composes the diagnostic label shown in About: the semver plus whatever build
 * metadata the build had. Falls back to the bare semver outside a checkout. */
export function formatBuildLabel(version: string, commit: string, date: string): string {
  const stamp = [commit, date].filter(Boolean).join(' · ');
  return stamp ? `${version} (${stamp})` : version;
}

/** e.g. "0.2.0 (a1b2c3d · 2026-08-02)". */
export const APP_BUILD_LABEL = formatBuildLabel(APP_VERSION, __BUILD_COMMIT__, __BUILD_DATE__);
