# Release asset review

Reviewed November 7, 2026 against the release source based on `68df58c`.

## MusicXML library

The publisher chose to retain straightforward transcriptions of public-domain
compositions under the upstream library's public-domain designation, while
investigating arrangements separately. A missing LICENSE file alone is not an
exclusion. Neither a new typesetting date nor a computer export establishes new
copyright in the underlying composition.

[score-rights.json](score-rights.json) records all 60 imported files, original
hashes, embedded rights statements, credits, source links, and the decision for
each file. The source is [MuseTrainer's library](https://github.com/musetrainer/library)
at commit `9128876f6164d96997c877a2be843349a32bdabb`.

- **38 retained:** historical piano repertoire or straightforward transcriptions
  with the upstream public-domain designation and no contrary arrangement claim
  identified during this review. Three files also carry an embedded public-domain
  statement (Petzold Minuet, Chopin Prelude, and Joplin Entertainer).
- **22 excluded:** unresolved piano reductions, simplified adaptations, or files
  explicitly naming modern arrangers without documented permission. Their original
  compositions are not being declared copyrighted by this decision.
- The nine modern/misattributed works excluded by the original importer remain
  excluded. The vendor script cannot silently reintroduce these 31 exclusions.

This ledger records evidence and release decisions, not a guarantee of rights in
every jurisdiction. A retained file should be re-reviewed if contrary evidence
appears. Reinstating an excluded arrangement requires source-level permission or
an independently authored replacement, with its own stable track identity.

## Authored music

The eight Originals tracks are project-authored music; the source modules record
their credits. Für Elise, Gymnopédie No. 1, and Ode to Joy are project transcriptions
or teaching arrangements of historical compositions. Moonlight Sonata uses the
public-domain Dukas/Durand 1915 note text via Craig Stuart Sapp's
[Humdrum encoding](https://github.com/craigsapp/beethoven-piano-sonatas/blob/main/kern/sonata14-1.krn).
The app normalizes pitch spelling and uses its own performance dynamics and pedal
timing; it does not reproduce the source edition's page layout.

`canon-in-d-first-steps` is a new nine-bar teaching arrangement entered directly
from Pachelbel's ground bass and opening melody. It uses no withdrawn piano
arrangement or MusicXML file. It replaces the Scales Beyond C lesson handoff,
without reusing the withdrawn edition's ID.

## Sounds, fonts, and code

[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) records authors, licenses,
source links, and adaptations for Salamander (CC BY 3.0), Headroom (CC BY 4.0),
bitKlavier/Steinway (CC BY 4.0), Wurlitzer (CC BY 3.0), Fraunces and Bravura (OFL),
pdf-lib (MIT), wasm-media-encoders (MIT), and LAME (LGPL).

The app's About page exposes piano source/license links and software credits.
Original piano recordings are not imported from arbitrary commercial tracks.
Room reverb is generated procedurally. Existing logo artwork is reused unchanged.

## User data

Withdrawing bundled files removes those files and their catalog entries from the
website. The prior library-score cache is retired on service-worker activation.
No takes, imports, practice results, backups, settings, or other IndexedDB records
are deleted. Old links to withdrawn library IDs report an unavailable track;
personal copies remain personal copies.
