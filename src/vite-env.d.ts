/// <reference types="vite/client" />

/** Injected at build time from package.json (vite.config.ts define). */
declare const __APP_VERSION__: string;

/** Short commit SHA of the build, or '' when git metadata is unavailable. */
declare const __BUILD_COMMIT__: string;

/** Commit date of the build as YYYY-MM-DD, or '' when unavailable. */
declare const __BUILD_DATE__: string;
