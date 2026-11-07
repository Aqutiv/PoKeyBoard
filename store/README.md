# Microsoft Store release

Publisher: Idan Robbins. Product: PoKeyBoard, `9PGS4N7RZWFF`.

The first submission is a draft. Do not submit it for certification without the
publisher's separate review. [Open Partner Center](https://partner.microsoft.com/en-us/dashboard/products/9PGS4N7RZWFF/overview).

## Reproducible inputs

- `identity.json`: exact Partner Center identity, version, URLs, and intended settings.
- `listings.json`: English, French, and Spanish copy, including the English lesson-text limitation.
- `reviewer-notes.txt`: first-run, hardware, offline, export, language, and update instructions.
- `RIGHTS.md` and `score-rights.json`: retained/withdrawn music decisions and provenance.
- `../THIRD_PARTY_NOTICES.md`: sounds, fonts, and software attributions.
- `artifacts/` (ignored): screenshots, downloaded packages, package configuration,
  hashes, and installed-package/WACK results. Keep the directory with release records.

## Source validation on Windows, November 7, 2026

- Formatting, ESLint, TypeScript, and production build passed.
- Vitest: 211 files, 3,313 tests passed; the app-hook subset also passed after
  aligning the page readiness marker with the recording controls.
- Playwright: all 263 browser tests passed against the production build,
  including real service-worker install/update/offline checks. The suite covers
  playback, recording/reopening, imports, exports, backups, simulated Bluetooth
  MIDI, and offline piano samples. Simulated hardware does not establish physical
  device compatibility.
- Added regression checks for offline public documents with query strings,
  retiring the old score cache without deleting unrelated data, withdrawn links,
  and preservation of a personal imported take.

Commands: `npm ci`, `npm run format:check`, `npm run lint`,
`npm run typecheck`, `npm test`, `npm run build`, and
`npm run test:e2e:fast -- --workers=4`.
For isolated Windows runs, set `POKEYBOARD_E2E_PORT` to a free port and point
`PLAYWRIGHT_BROWSERS_PATH` to the installed Playwright browsers if a sandbox
redirects LocalAppData. The test browser needs access to the local preview server.

## Packaging sequence

1. Merge only after CI passes, then verify the deployed build commit.
2. Analyze `https://aqutiv.github.io/PoKeyBoard/` in PWABuilder and package for Windows
   with the exact identity in `identity.json`, starting at `1.0.0.0`.
3. Retain the generated archive, settings, and SHA-256 hashes in `artifacts/`.
4. Install the test package and validate actual Windows launch, audio, persistence,
   imports/exports/sharing, languages, device permissions, offline playback, and
   safe updates. Run the Windows App Certification Kit. Record observed results
   separately from browser automation and unresolved hardware checks.
5. Upload the Store package and five genuine 1920×1080 PNG screenshots per listing
   locale (playing, practice, lessons, library, takes). Confirm all required draft
   sections and package validation pass. Leave certification submission to review.

Public PWA identity, start URL, and scope remain `/PoKeyBoard/`. No storage keys or
take formats are migrated. Old score-cache removal does not touch personal data.
