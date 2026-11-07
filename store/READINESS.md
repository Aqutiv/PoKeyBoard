# PoKeyBoard Microsoft Store draft readiness

As of November 7, 2026, the Partner Center draft is complete and both final Store
packages are validated. Certification has **not** been submitted. Local validation
of the final package still has the outstanding items listed below.

[Open the draft](https://partner.microsoft.com/en-us/dashboard/products/9PGS4N7RZWFF/overview).

## Completed

- Publisher **Idan Robbins**, product **PoKeyBoard**, Store ID **9PGS4N7RZWFF**.
- Pricing and availability, properties, age ratings, packages, Store listings,
  and submission options all show **Complete**. The certification submission
  button is available and has not been clicked.
- Free, Music category, public discoverability, 240 eligible markets and future
  markets. Packages target Windows PCs; other device families are unchecked.
- English (US), French (France), and Spanish (Spain) listings, each with five
  genuine 1920×1080 PNG screenshots: playing, practice, lessons, library, takes.
- Age ratings saved after the publisher explicitly approved the IARC terms and
  legal-age declaration. General-audience ratings are saved in the draft.
- Public privacy and support pages are deployed, linked from About with translated
  labels, and covered by offline routing tests. MIDI/Bluetooth, local data,
  sharing, backups, deletion, and GitHub Pages logging are disclosed.
- Reviewer instructions and the required `runFullTrust` explanation are saved.
  Microsoft will review capability approval during certification.
- Source release [PR 147](https://github.com/Aqutiv/PoKeyBoard/pull/147) merged;
  deployed commit `08ea2e1c9ce0c2e4f675aadfe4996ce5dd11f45e` verified before packaging.
- Score audit retains 38 documented public-domain transcriptions, removes 22
  unresolved editions/arrangements, and records sources, hashes, and decisions.
  Original/authored tracks remain; an authored Canon lesson replaces the removed
  arrangement. Stale links fail gracefully without deleting personal takes.
- Formatting, lint, types, production build, 3,313 unit tests, and all 263 browser
  tests passed. Browser coverage includes offline launch, complete piano samples,
  recording/reopening, import/export, backup, update safety, and simulated MIDI.
- PWABuilder reports no required fixes and passing offline support.
- Installed sideload version `1.0.1.0` launched in Microsoft Edge. A seven-note
  "Windows Store validation take" was recorded, saved, and reopened from Takes.
- The final sideload package `1.0.3.0` installed successfully as an update, using
  `Add-AppxPackage -AllowUnsigned -ForceUpdateFromAnyVersion`; no uninstall or
  personal-data reset was performed.

## Final Store files

| File in `artifacts/windows-optimized/`  | Version | Partner Center                |
| --------------------------------------- | ------- | ----------------------------- |
| `PoKeyBoard.1.0.3.0.msixbundle`         | 1.0.3.0 | Validated                     |
| `PoKeyBoard.classic.1.0.2.0.appxbundle` | 1.0.2.0 | Validated                     |
| `PoKeyBoard.sideload.msix`              | 1.0.3.0 | Local test only; never upload |

All final manifests were checked for exact publisher identity, languages, device
family, and version. All final PNG resources are below 200 KiB. Exact SHA-256
values are in `artifacts/final-package-manifests.json` and
`artifacts/final-package-hashes.json`.

PWABuilder initially generated classic `1.0.0.0` and modern `1.0.1.0` packages.
Microsoft requires a unique version for changed uploaded contents, so the image
correction uses the versions above. Earlier candidates remain as evidence only.

## Windows certification results and remaining checks

The first installed-package Windows App Certification Kit run reports overall
**PASS**, `PARTIAL_RUN=FALSE`, kit version `10.0.26100.8249`, on Windows 11 Pro
`10.0.26300.0`. Of 24 tests, 23 passed and the optional App resources test reported
four generated tile PNGs over 200 KiB. Those images were subsequently reduced,
visually inspected, repacked with MakeAppx, and accepted by Partner Center.

The final WACK rerun has **not** completed: Windows reported that the elevation
request was canceled. `artifacts/run-wack.ps1` is prepared to test the currently
installed PoKeyBoard package. The existing `wack-report.xml` and
`wack-before-image-optimization.xml` are the **initial** report, not evidence of a
final-version rerun.

Still to verify on the final installed package:

- Reopen the saved take after the package update and check actual audio output.
- Imports, exports, sharing, language switching, and MIDI/Bluetooth permission
  cancellation/denial in the installed Edge host.
- Download a complete piano, relaunch offline, and check the full keyboard range.
- Confirm update behavior during recording in the installed host. Automated web
  tests already pass, but they are not a substitute for this installed-app check.
- Physical MIDI/Bluetooth hardware compatibility has not been established.

## Evidence and reproduction

`artifacts/store-draft-complete.jpg` shows all six sections complete and both
packages validated. The artifacts directory also holds original captures, PNG
listing screenshots, original/generated/rebuilt archives, image-size records,
installation output, manifests, hashes, and WACK logs.

`pwabuilder-settings.json`, `optimize-windows-package.py`, `identity.json`,
`listings.json`, `reviewer-notes.txt`, `capability-justification.txt`, `RIGHTS.md`,
and `score-rights.json` retain the reproducible inputs. See `README.md` for the
workflow and original source checks. Keep the ignored `artifacts/` directory with
the release records.
