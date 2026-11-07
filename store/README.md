# Microsoft Store release

Publisher: Idan Robbins. Product: PoKeyBoard, `9PGS4N7RZWFF`.

The publisher authorized certification submission on November 7, 2026. Partner
Center accepted the submission and shows **In certification**, with automatic
publishing after approval. See `READINESS.md` for validation results and remaining
manual checks. [Open Partner Center](https://partner.microsoft.com/en-us/dashboard/products/9PGS4N7RZWFF/overview).

## Reproducible inputs

- `identity.json`: exact Partner Center identity, versions, URLs, and intended settings.
- `pwabuilder-settings.json`: request body for the official PWABuilder packaging API.
- `optimize-windows-package.py`: Windows SDK repack step that reduces oversized
  generated PNG resources while retaining the existing logo and image dimensions.
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
   with the exact identity in `identity.json`. PWABuilder's paired workflow uses
   classic version `1.0.0.0` and modern version `1.0.1.0`; the modern package must
   have a higher version. The public packaging API is documented in
   [PWABuilder's repository](https://github.com/pwa-builder/PWABuilder/blob/main/apps/pwabuilder-microsoft-store/readme.md).
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

## Generated package records

Release source was merged in [PR 147](https://github.com/Aqutiv/PoKeyBoard/pull/147).
GitHub Pages build `08ea2e1c9ce0c2e4f675aadfe4996ce5dd11f45e` was verified in the
live About page before packaging. PWABuilder reported zero required fixes and
passing offline support.

The browser's first archive contained placeholder identity values and was rejected
locally before upload. Use `artifacts/PoKeyBoard-store.zip`, generated with the
explicit API settings, as the original package input. Do not use
`artifacts/PoKeyBoard.zip` or `artifacts/windows/` for distribution.

The first installed-package WACK run passed overall but flagged four oversized
tile images in its optional App resources test. `optimize-windows-package.py`
uses Pillow 12.2.0 to encode generated resources over 200 KiB as indexed PNGs and
Windows SDK 10.0.26100.0 MakeAppx to rebuild packages. It preserves manifest
identity, versions, languages, dimensions, and transparency. Original files remain
in `windows-store/`; final package candidates are in `windows-optimized/`.
The sideload package's extra publisher OID intentionally gives it a different
package family suffix from the Store package. Never upload the sideload package.

Partner Center rejected changed contents under the already-uploaded modern
`1.0.1.0` package identity. The corrected draft therefore uses unique versions:
modern `1.0.3.0` and classic `1.0.2.0`, as recorded in `identity.json`. The API
settings preserve the original generator input; the repack script applies the
final version values from `identity.json` to each package manifest and bundle.
Final upload filenames include their version numbers to distinguish them from
earlier candidates.
