# Architecture

## Principles

1. **The audio clock owns time.** `AudioContext.currentTime` is the only timing authority. React never schedules sound; components read clocks on one shared animation-frame loop (`app/frameClock.ts`), which runs only while something on screen is moving — key lights (each in its hand's shade, as deep as its note is played) and the pedal cue are drawn straight onto the keys from it, the falling notes onto their canvas, and React renders only when a readout changes.
2. **Services are module singletons outside React.** The audio engine, transport controller, metronome, scrub controller, persistence, and lifecycle services are plain objects; React subscribes via `useSyncExternalStore` with referentially stable subscribe functions and stable snapshots.
3. **One piano, two contexts.** Live playback and offline export share the same sample bank (decoded `AudioBuffer`s), the same graph factory, and the same envelope constants — so exports sound like the performance.
4. **Structured events are the source of truth.** A take is JSON note/pedal events (see TAKE_FORMAT.md); audio is always derived, never recorded from a microphone.

## Module map

```
src/
  audio/        AudioEngine (facade singleton), instruments (the piano
                registry), SampleBank (+ velocityCurve, and the generated
                velocityCalibration and toneCalibration, each with its
                maths), sampleVoice, VoiceManager,
                PianoGraphFactory, reverbImpulse (the reverb's procedural
                rooms), MetronomeEngine,
                OfflineTakeRenderer, AudioExportService, loudness (BS.1770
                loudness, true peak, look-ahead limiter), id3,
                audioCapabilities, iosAudioSession
  workers/      audioEncoder.worker (mastering + LAME wasm or the FLAC encoder, transferred PCM)
  domain/       takeTypes, takeSchema (Zod, migrate→repair→validate→normalize),
                takeMigrations, noteEvents, takeHash (export cache key),
                takeLink (a whole take in a share link, and back),
                tempoMap (piecewise beats↔ms; shared by import, library, score),
                hands (which hand plays a note), fingering (pure: which finger
                plays each note, the score's own or worked out), midiExport
                (Standard MIDI File writer), musicXmlImport and mxlContainer
                (MusicXML and MXL to a take), smfReader and midiImport (MIDI
                bytes, then MIDI to a take), importedTake (the last step both
                imports share: ids, rounding, limits, title, tempo changes),
                trainingGate (pure)
  data/         db (Dexie v1), takeRepository, settingsRepository,
                audioCacheRepository, metadataRepository, persistence (autosave)
  features/
    keyboard/   geometry, velocityResponse (every input's velocity curve),
                per-pointer tracker, computer keyboard, game controller, Web
                MIDI (shared access service, input, and the shell-level
                useMidiInput), soundingNotes and keyShading (what the key
                lights show, and how deep), PianoKeyboard
    learn/      chapter catalog, pure exercise spec + matcher, useExercise,
                LearnPage (outline), ChapterRunner, KeyboardDiagram,
                StaffSnippet, CircleOfFifths, per-locale lesson content
    notation/   staffMapping, pitchSpelling (letters in context), keyDetection
                (key and mode), scoreSpelling (the score's spelling of every
                note, for names shown elsewhere), quantization, notationLayout,
                scoreRenderer
                (canvas), MusicScore (rAF + scrub gestures), scrubMath,
                scrubController, sheetLayout (pure paginated engraving),
                accidentalStacking (accidental columns from the glyph
                boxes), sheetRenderer (print-style page on a DrawSurface),
                sheetText (title accidentals as glyphs), glyphs/ (the Bravura
                subset the live score and the sheet draw: generated metrics
                and outlines, drawGlyph, engravingGlyphs — see SHEET_EXPORT.md)
    transport/  transportMachine (pure), transportClock, transportController,
                practiceEvents (what a practice run reports), sustainPedal,
                modes, TransportControls, ModeMenu
    practice/   trainingReport (pure: a "wait for me" run's events read into
                its report), resultCells (pure: a run told in four-bar
                sections or passes round a loop, each graded),
                practiceSession (results collected outside React),
                PracticeResults (the card under the transport)
    metronome/  MetronomeControls
    takes/      takesService, TakesPage, ImportInbox (the import preview and
                its failure alert, over any route), ImportTakeDialog,
                ImportUrlDialog, remoteImportMessage
    export/     ShareMenu, AudioExportDialog, SheetExportDialog, ShareLinkDialog,
                sheetPdfService,
                sheetPdfWriter (vector PDF via pdfSurface/vectorSurface and
                pdf-lib, dynamic import — see SHEET_EXPORT.md), midiFile
    settings/   SettingsPage (a switch over its Sound, Playing, Display and
                App sections, and the update banner), PianoSection (piano
                choice with its own offline pack, kept by packStates; levels,
                room, tone), MidiSection, ChoiceSwitch
    waterfall/  waterfallLayout (pure: where each note falls at one moment,
                folded round a loop, with the bar lines and the notes a hold
                waits for), waterfallPalette (the lit keys' colours, mixed in
                OKLab as keyboard.css mixes them), waterfallPainter (canvas:
                bars, finger numbers and names, the hold's glow), WaterfallView (on the frame clock
                while the notes move or a hold glows; fall speed, and a
                vertical drag to scrub), fallSpeed (the fall-time steps)
    play/       PlayPage, PlayViewSwitch and playView (score or falling notes),
                SaveStatusBadge
  pwa/          service-worker (Workbox injectManifest), updateManager,
                install, cacheNames
  state/        zustand stores: take, settings, export-ui, import-ui, practice
                results
  app/          hash router, providers (service wiring), lifecycle, hooks,
                ImportDialogs (the shell's import inbox), hashLinks and
                hooks/useHashLinkIntake (share links in the address bar)
  ui/           shared controls: MenuButton, TooltipButton, SegmentedSwitch
                (the library's folders, Learn's levels, Settings' sections)
```

## Audio clock ownership

`TransportClock` maps audio seconds ↔ take milliseconds with an anchor pair, a rate (playback speed: take ms per audio ms) and optionally a loop. Looping folds take time back on itself, so the clock also keeps the run's unwrapped timeline ("virtual time", which keeps growing through every pass); the note scheduler, the metronome grid and the training holds all schedule ahead in virtual time, where the loop's next pass is simply further on and the seam needs no special case. Recording anchors beat zero slightly ahead on the audio clock (count-in aligned); input events carry `AudioContext.currentTime` and are converted through the anchor, so UI latency never skews recorded timing. Playback schedules notes 150 ms ahead on a 25 ms tick; the metronome schedules clicks the same way. Nothing audible is driven by `setTimeout` timestamps.

Clicks come from a `ClickGrid`, not from one bpm: while the transport moves, the grid puts beat _n_ where the take's tempo map puts it, so clicks land on the same bar lines the score draws and follow every tempo change; stopped, it is a steady grid at the tempo in force under the playhead; a count-in is a steady grid at the tempo recording will start in, whose last click lands on the record anchor. The exported click track (`scheduleClicksForRange`) walks the same map. The BPM field edits the tempo _at the playhead_: at the start it is the take's tempo, and stopped further in — the record-a-part, change-tempo, record-again flow — it writes a tempo change on the nearest bar line and parks the playhead there.

## Transport state machine

`transportMachine.ts` is a pure `(state, event) → state|null` table over
`idle, countIn, recording, playing, paused, scrubbing, renderingAudio, encodingAudio, audioReady, error`. The controller sends events; invalid transitions are no-ops, which is what makes rapid transport taps and duplicate schedulers impossible (the scheduler interval exists only inside `playing`).

## Recording

The engine emits input events (`on/off/sustain`, audio-clock stamped) for live sources. The controller keeps per-`sourceId` open notes, commits each on release (prompt score display), finalizes leftovers on stop, appends pedal events, and tracks the pass's note ids for undo. Overdub is the default; replace deletes-from-playhead only after explicit confirmation. A recording interrupted by backgrounding finalizes, saves, and explains itself. Overdub/replace and the playback mode share one menu on the transport row (two selects do not fit a phone), and both are ordinary settings rather than component state.

## Training playback

Training stops playback at every note the chosen hand has to play and waits for
the user to play it. `nextTrainingGate` (`domain/trainingGate.ts`) is pure: given
the sorted notes, a time, and left/right/both it returns the next onset and the
pitches due there, gathered over a 50 ms window because a chord a human played
never lands on one millisecond. Which hand a note belongs to is `noteHand`'s
answer — the staff an import wrote it on, or the middle-C split for a recorded
take — so the key bed, the score and training all agree.

The controller owns the gate because the clamp has to happen inside the private
scheduler: the lookahead horizon is capped just under the gate, so nothing past
it is scheduled early, and the tick that crosses it pauses at the gate's own
millisecond rather than wherever the 25 ms tick landed. Waiting is an ordinary
`paused` plus a flag, not a new transport state — nothing that switches on
`TransportState` has to learn about training. The hold pauses with `ringOut`, as
a take's natural end does. The keys the player holds keep sounding and stay lit.
The take's notes already struck end where they were written to: nothing past the
gate was queued, so every key-up is already scheduled. Stop still silences
everything.

From the moment a gate is armed, not only once it holds, the controller listens
to the same input stream recording uses. A key the gate asks for counts from
`EARLY_PRESS_MS` (150 ms of real time, whatever the speed) before its note is
due, because people play a hair ahead. That also catches a press between the
note falling due and the tick that would stop for it. A press counts toward the
one gate armed, so nothing played earlier is banked for later. If every key is
in before the hold, playback never stops. The take leaves those notes to the
player, and the next gate is armed past the chord, though no further than a
loop's end, so the next pass's top is still asked for.

At a hold, presses accumulate, including keys played on the way in (a mouse is
one pointer and cannot hold a chord). Extra keys flash and are ignored rather
than blocking. The notes the user just sounded are skipped by id in the pass
they fall in, or the take would echo them a beat later; a loop asks for them
again every time round. A resumed run leads in by 20 ms rather than a fresh
start's 60, so the other hand comes in with the player's note. Pressing Play at
a hold lets that note through, so the feature can never wedge the transport.

Only plain playback gates. An overdub pass sounds its backing through the same
scheduler and must never stop to ask for a note.

A practice run is one stretch of training, kept by the controller from the
playback that starts it to whatever ends it. Play under a training mode starts
one from the playhead, unless nothing is left to play, and so does a training
mode chosen mid-playback. Holds are never its boundaries: a run goes on through
every hold and every resume from one. It ends once, and says why: the take
played to its `end`; a `pause` or a `stop`; a `seek` or a scrub; a `loop` set or
cleared, even at a hold; another hand or none chosen (`mode`; the same hand
again carries the run on); `navigation` to another page, which drops the holds
while playback plays on; an `interrupted` page, or a take swapped for another;
a `record`; or a `failed` transport. Clearing the gate ends any run still under
way, as a backstop.

`subscribePractice` tells listeners what happens in a run, each event carrying
its run's id (`practiceEvents.ts`): `run-start`, with what the run practises —
the hand, where from, the speed and the loop, its clock's anchor, and every note
it will ask for (`askedNotes`); `hold`, with when its notes fell due; `hold-key`
for every key pressed at a hold, wanted or not; `hold-cleared`, played or
skipped by Play; `step`, for a hold whose keys all came early, so playback never
stopped; `speed`; and `run-end`. Listeners are told synchronously, from inside
the command, and one that throws is reported and passed over: nothing a listener
does can stop the transport finishing what it started.

### Practice results

A card under the transport says how the last run went (`features/practice`). The
results are collected outside React: `practiceSession`, started with the other
services, buffers the run under way's events from `subscribePractice` and, as
the run ends, reads a "wait for me" run into its report (`trainingReport`), or a
Keep-time run into its own (see Keep-time results), and hands it to
`usePracticeStore`. So a card mounted twice under StrictMode, or not at all on
another route, reads nothing twice and misses nothing. The listener only writes
the store and never calls the transport back. A run of fewer than two steps, or
two notes kept in time, leaves no card. The next run puts the card away,
whichever way it is practised, as do Dismiss and opening another take; a result
for a run since overtaken is dropped. So does anything
that makes the result describe a take that is no longer there: a new tempo, time
signature or tempo change, which moves the bars its sections name (compared by
value, so a count-in keeps it), and new notes, from a recording pass, a clear or
an undo. The same edits made while a run is under way, a tempo set at a hold or
an Undo pass, leave it no card at all. While a recording counts in or runs, the
card stands aside.

A step is right first time when no wrong key was pressed at it and Play did not
let it through, so every step played early is. The card adds the wrong keys
pressed at holds, the holds let through, those the player took more than two
seconds over, the steps played without the music stopping, and the slowest
speed. A hold still open when the run ended counts neither way. A desktop has
room for every fact on one line, a phone keeps to the mistakes, and short
landscape keeps the card to one line. It is not a dialog, since an
`aria-modal` would stand the computer keyboard and MIDI down. A status kept
mounted beside it tells a screen reader each result in one sentence.

Then the run part by part (`resultCells`, built for a run kept in time to
reuse). A run through the take is told in sections of four of its bars, by the
tempo map's own bar lines: 1–4, 5–8 and so on, so a run started in bar 6 opens
on 5–8 and the last section ends with the take. A run round a loop is told in
passes, the latest eight, a new one wherever a step is no more than a chord
after the last, since a hold's next step is always looked for past the chord.
Each cell is graded good from 90% right and fair from 60%, and shows its share
rounded down, never counts, which would read as a time signature. A section's
cell is a button: tapped, it loops those bars (`loopBetween`) and parks the
playhead at their start.

## Keep time

Keep time is the other way to practise a hand: the music never waits, and the
hand's notes are left for the player to play in time with the rest. The style
lives in the playback mode itself (`playalong-left|right|both`, beside the
`training-*` modes of Wait for me), not in a setting of its own, because the
mode is what everything else already reads. A Learn hand-off sets a `training-*`
mode, so it opens in Wait for me as its copy promises, whatever style the player
last chose on Play. That last choice (`practiceStyle`) is only the Modes menu's
memory, the style a hand picked from Listen starts in; the transport never reads
it.

Play under a Keep-time mode starts a practice run as a training mode does, with
`style: 'playAlong'`, and the run is what mutes the hand. `playAlongMutedIds`
lists the notes it asks for, with any hidden copy struck on the same key at the
same moment, and the scheduler skips those ids beside the silent notes. A hidden
trill beside a written note still sounds: nothing on the page asks the player
for it. There is no gate, and the transport listens to no key: judging what the
player plays is the practice session's (below). The muting ends with the run, so
playback that carries on without it, after a change of page say, plays the take
whole, as a run that waits leaves its holds behind.

A fresh Keep-time run is counted in, never less than a bar
(`keepTimeCountInMs`: the take's count-in at the tempo in force where the run
starts, stretched by the practice speed). The music will not wait, so the player
has to have heard the beat to come in on it. The count-in is a pre-roll inside
`playing`, not a state of its own: the clock is anchored past it and runs toward
the run's start, the playhead is held there (`getPlayheadMs`), `isCountingIn`
says so, and the falling notes fall in to meet it as they do for a recording's
count-in. Its clicks are a steady grid that stops short of the anchor, joined to
the take's own grid when the metronome is on, so the run's first beat is queued
ahead like any other click and lands with the music. The handover comes on the
scheduler tick that finds the audio clock past the anchor rather than on a
timeout, which a background tab would hold back; the metronome then clicks the
take's grid if it is on and stops queuing if not. A loop's passes are one run,
so only the first is counted in. A change of speed during the count-in starts
the run again (`restart`), since the clicks count the speed it will play at;
after it, the speed changes as it does for any run.

Neither the muting nor the count-in can change under music already moving, so
choosing another style or another hand, to or from Keep time, ends the run
(`mode`) and pauses where playback is; at a hold, the hold is dropped rather
than let through. The Modes menu does nothing for a choice already made, so a
second click on it never pauses a run or lets a hold through. A run that would
sound nothing (both hands, or the hand of a piece written for one) turns the
metronome on at its start, visibly, for the player to turn off: without it,
nothing would keep the beat. It goes off again when that run ends, unless the
player has touched its switch in the meantime, which makes the choice theirs.

### Keep-time results

A Keep-time run is judged by the keys pressed while it plays, which the practice
session listens to from its start to its end (`playAlongSession`), outside React
like every result. When each note falls due is read from the run's events, not
from the transport's clock (`runTimeline`): the run reaches `fromMs` at its
anchor, past the count-in, at its speed, and each `speed` event starts a stretch
at the new speed from wherever the run had got to. The clock starts its
unwrapped timeline again from the playhead at every change of speed, so it can
no longer place a note before the change, and the last notes are judged after it
has stopped. The run's timeline is unwrapped as the clock's virtual time is:
round a loop, each pass is a loop's length further on, and the notes asked for
(`dueNotes`) come pass by pass, a unison, or a key struck again within a chord's
width, asked for once.

A press is placed at the music the player heard: the engine stamps it on the
audio clock, and the output's latency (`getOutputLatencyMs`, read once as the
run starts) is taken off, so a player in time through Bluetooth headphones is in
time. Each note's window reaches 200 ms either side in real time at any speed,
or halfway to the next or last strike of its key, so a repeated note or a trill
keeps each press to its own (`playAlongScorer`). The nearest press in a window
plays the note, on time within 60 ms and early or late beyond; another press in
it is a second strike, counted neither way. A press in no window is a wrong
note, and flashes on the keys as it is played (`flashWrongKey`), worked out from
the notes asked for and the timeline rather than from what has been scheduled.
Presses before the first note's window, the run counting in, count for nothing.
Accuracy weighs the wrong notes against the notes played, so playing every key
at once does not pay. Off the beat by more than 30 ms on average over six notes,
the player rushes or drags; late by more than 90 ms in the middle, within 40 ms
of each other, over eight, the lateness is steadier than a player's, and the
card says the sound may be reaching them late.

A run played to its end listens on for 230 ms past the latency, for its last
notes played late. A run stopped short is judged at once, and a note whose
window was still open, with nothing played in it yet, is left out. The result
carries the tempo it was scored on, and is put away, or never shown, for the
same changes to the take as any run's (above), one made while the run listens
on for its last notes included. The cells show each section's
share on time, or each pass's round a loop, the notes told apart by the pass
they came in (`passCells`), since notes kept in time share moments; a section
tapped loops as any does, music still playing paused first. While the run lasts,
the card's status carries `data-keep-time-origin-ms`, the moment on the page's
clock a press lands on the run's start, rendered from the store for the
end-to-end tests to play in time from, as Learn's runner publishes
`data-click-origin-ms`.

## Choosing a piano

`audio/instruments.ts` lists the selectable pianos, each one a versioned sample
pack directory under `public/piano/`: three grands (Salamander, a Yamaha C5, the
default; Headroom, a Yamaha C3; Steinway, the bitKlavier Grand's Steinway D,
whose id and pack keep the library's name) and the Wurlitzer electric piano.
The engine keeps a `SampleBank` per
instrument but lets only the sounding one hold decoded buffers — plus, for the
moment a switch takes, the one about to replace it. A full pack of stereo float32
PCM is ~300 MB (its core ~130 MB), and ~100 MB more with a pianissimo layer (~45 MB
of it in the core's keys), so resident packs are not an option on a phone, and a
downloaded piano still has to be decoded before it can play.

Switching (`AudioEngine.setInstrument`) keeps two ids: the piano _selected_
(`activeInstrument`, which takes are stamped with, synchronously) and the one
_sounding_ (`bank`, which every note is struck from). While the sounding piano is
ready the switch is seamless: it plays on while the new bank decodes its core, the
remembered keyboard range, and the `cover` the transport passes — the loaded
take's key span, so every note it plays sounds on the new piano from its first.
The range is re-read after each load, so a keyboard that moves meanwhile is
covered too. Then the new piano takes over in one synchronous step, and plays from
the next note struck: nothing is released or cross-faded, because a voice holds a
buffer of the piano it began on and finishes there — notes ringing, and those
already queued in playback's 150 ms look-ahead. Only then are every other bank's
buffers freed, so a rapid A→B→A toggle never re-decodes (choosing the sounding
piano again just calls the switch off). If the new core cannot be loaded, the
sounding piano is selected again, `getSwitchState().failed` names the one that
failed, and persistence writes the store back so the pickers and the take's stamp
follow. With nothing playable to keep — the first load, or a failed piano — the
switch is immediate as before: sounding notes are released and the progress
fan-out points at the new bank (which is why `data-piano-ready` drops to false).
A generation counter stops an out-of-order switch from taking over or freeing the
bank that just became active, and `SampleBank.releaseBuffers` calls off a load
wherever it has got to — its manifest, the files in flight and those still queued
— so a switch called off leaves nothing decoded behind.

The transport never pauses for a switch. Play and Resume need only the sounding
piano (`isPianoPlayable`); Record waits for the selected one (`isPianoReady`), so a
pass is played on one piano. An export awaits `whenSwitchSettled()`, then reads the
open take again, so it renders, names and caches the piano the take is stamped
with — the one that plays on, if the new one failed.

The pickers draw a switch on themselves (`PianoSwitchRing`): an SVG ring over the
control's border, its dash a percentage via `pathLength`, run from
`getSwitchState().progress` — the pending bank's decoded bytes over what the
switch must decode (`SampleBank.bytesFor`: the core and every key it must cover),
never running back if that widens. It glows once when `sounding` becomes the
pending piano, flashes red when it fails, and simply goes when a switch is called
off or overtaken. The words ("Loading the new piano…") are for screen readers only.

Progress subscription lives on the engine, not the bank: `useSyncExternalStore`
captures its subscribe callback once, so a per-bank subscription would go deaf
the first time the piano changed.

On a cold start `loadCoreSamples` waits (≤1.5 s, then gives up) for the
persistence layer to apply the stored instrument, so a user on the second piano
never decodes 5.7 MB of the first one first.

Packs are mastered at different levels — Headroom sits ~15 dB below Salamander,
and the Steinway's source 5–7 dB below, though its build raises each layer toward
Salamander before the 16-bit quantisation so its dither floor stays put —
and within a pack each recording at its own, note by note. So a grand plays by a
velocity calibration: every one of its recordings is measured once
(`tests/tools/generateVelocityCalibration.ts`, K-weighted over the 300 ms after
its onset) into `velocityCalibration.ts`, keyed by pack version — in code, since
a published pack and its manifest never change — and `SampleBank` gives a voice
the gain that takes its recording from that level to where its velocity asks:
one decibel curve for every pack (`velocityCurve.ts`), tilted from bass to
treble as the pack's medium layer is, and anchored so C3–B5 at the computer
keyboard's velocity plays exactly as loudly as before. The layers then change
the timbre and never the loudness. The gain is keyed on the recording actually
resolved rather than the one requested, because a stand-in during a partial
load was recorded at its own level. A pack without a table falls back to
per-layer trims (`velocityGain`) times the per-layer `levelMatch` the build
script writes into its manifest; the Wurlitzer keeps its own region gains.

A grand's manifest names its layers rather than numbering them by kind
(`velocityLayers.ts`): `pianissimo`, `soft`, `medium` and `loud`, softest first
from index 0, a pack having any of them but always a medium one — a bad label
refuses the manifest (the piano reports an error rather than loading forever).
Each kind takes over at its own velocity (soft 0.30, medium 0.45, loud 0.78,
each a little above where its recording naturally sounds on the curve), and a
pack's softest layer plays everything under the next, so a pack of soft,
medium and loud splits at 0.45 and 0.78 as it always did, and one with a
pianissimo layer under those at 0.30 too. Salamander and the Steinway have one:
upstream's v2 and v5 of their sixteen, each playing at about 0.25–0.30 on the
curve. Headroom's source has nothing softer than its soft layer, and the
Wurlitzer maps its own velocities. Their packs (salamander-grand-v4,
bitklavier-grand-v2) re-use the three layers the generation before published,
listing them by relative path (`../salamander-grand-v3/C4v5.sample`), so those
play exactly as they did, at the URLs players already have. During a partial
load a note looks for a stand-in in the nearest layer, the softer of two as
near. The velocity table names the medium layer (`tiltLayer`) where it is not
layer 1.

A pianissimo layer is **deferred**: the piano is ready, and its first note
plays, on the core it always waited for, and the pianissimo recordings follow
(`SampleBank.loadDeferred`). Only the piano that sounds fetches them — after
its first core load, or once a switch has taken over — so a piano still
decoding for a switch neither fetches nor holds them, and they count toward
no progress (`bytesFor`, the core bytes). A range load resolves once the
range plays, its pianissimo recordings following behind it. Until a note's
own is decoded, the soft recording at the same root plays for it, at the
bottom of its tone ramp and on the curve, marked `standIn`; a deferred layer
never lends a recording pitched from a further root. One that cannot be
fetched — the pack saved for offline use before the layer existed, say — is
logged and left to that stand-in, never raising the piano's error. An export
waits for the pianissimo recordings its own soft notes ask for
(`loadRecordingsFor`), and a render that still had to use a stand-in is
handed over but not kept in the MP3 cache.

Those background loads give way to every load someone is waiting for
(`sampleTraffic.ts`): a piano's core from its manifest on (the next piano's,
during a switch), the keys a range needs, an export's recordings and a
download for offline use, each fetching four files at a time at full priority
(`FETCH_CONCURRENCY`). The engine's banks share one `SampleTraffic`, because a
switch decodes one piano while the other plays on and fetches its own. The
background takes a turn for each file it starts. No turn is given while any of
those loads is under way, and never more than two are out at once across the
pianos. With a foreground load's four, that makes the six connections a
browser opens to a host over HTTP/1.1. Each background file is asked for at
`priority: 'low'` (the Fetch Priority API, a hint where the browser takes it).
Without the turns, two background loads (the piano's own and a range's) could
take all six connections between them, and a switch or a download would queue
behind recordings nobody was waiting for.

A file already started is left to finish, because an export may be waiting on
the very file a background load is fetching. So the background waits between
files, never with one in hand. A release ends its bank's hold as well, so a
load called off never keeps the background waiting.

The timbre then follows the touch too, rather than stepping where the layers
meet: a harder blow brings the upper partials out, and on their own the
recordings jump in brightness at every switch, by 200 to 900 cents of spectral
centroid around middle C, the Steinway least and Headroom most. So each voice
of a layer above a grand's softest plays through a lowpass (`toneCalibration.ts`,
from `tests/tools/generateToneCalibration.ts`, keyed by pack version the same
way): at its layer's bottom, the cutoff that brings its recording down to the
brightness of the layer below at the same root, opening evenly in log
frequency to its layer's top. The softest layer plays open, and so does a ramp
whose layer below is the brighter already, which no lowpass can meet: two
pianissimo roots, brighter than their soft ones by 15 and 23 cents. The filter's
K-weighted loss is given back as make-up, less as it opens, so the loudness
stays on the curve. Brightness is measured as the voice plays (from its onset,
under its attack, at 48 kHz), and the cutoffs, per root, climb from half a
kilohertz to two in the bass, by the piano, to several at the top; there, a
match would take the note's own fundamental, so no ramp starts below 2.5 times
it, and the top keys keep a smaller correction. A stand-in from a brighter layer
plays at its ramp's bottom, and one from a darker layer open. The cutoff is
scaled by the playback rate, so a note pitched from its root keeps the root's
tone. Settings → Sound → Tone follows touch, on by default, switches the ramps
off: `getSample` with `tone: false` leaves out the cutoff and its make-up
together, and every recording plays open, as all of them did before exporter
version 9. The engine takes the setting from the next note it plays, and an
export from its own options, which its hash carries too.

The selected piano is authoritative everywhere, including export: `setTake`
stamps the take's `samplePackVersion` from the active instrument, so live
playback and the rendered MP3 always agree, and since `takeHash` already hashes
that field, a switch invalidates cached exports on its own.

## Live/offline engine reuse

`PianoGraphFactory` builds `voices → bus → (dry + convolver send) → master → output gain → limiter → soft clip → destination`, the live metronome joining after the limiter, which starts out with a fast release to be over its first moments' duck at once, for **any** `BaseAudioContext`. `OfflineTakeRenderer` constructs an `OfflineAudioContext` and replays sustain-applied notes through the same factory with the same attack/release constants and the same `SampleBank` buffers. Two things differ, both about level: the piano plays at the default volume (the volume slider is for the room, not the file), and without the graph's live peak guard (`peakGuard: false`) — a compressor has to react to peaks it cannot see coming, while an export can look ahead. The metronome travels as a click track: its two click sounds, rendered once, and where every beat falls. The encoder worker then masters the render (`loudness.masterExport`: BS.1770 loudness to −16 LUFS, or the played level, then a true-peak look-ahead limiter at −1 dBTP) before encoding; see AUDIO_EXPORT.md.

A voice behaves like the string it stands for, the same way live and offline (`sampleVoice.ts`). It starts at its recording's onset rather than the top of the file (`onsetOffsetOf`, found once at decode), which takes the libraries' lead-in silence out of every note. It starts on a whole frame of its context's clock, too: the one nearest the time asked for (`nearestFrameTime`), at most 10 µs away at 48 kHz. A buffer source started between two frames reads its recording from between two samples, which the browser does by linear interpolation. That makes a lowpass that changes note by note: in Chromium, half a frame late costs 2 dB at 10 kHz and 12 dB at 20 kHz. So a key played at its recording's own pitch sounds exactly as recorded. Keys played live were always on a frame, since the audio clock only moves in whole frames; playback, scrubbing and exports are what this changed. The two keys in every three that play a recording a semitone up or down still go through the browser's interpolation, via `playbackRate`. `VoiceManager.strike` and `scheduleTakeVoices` work from that frame as well, so the strikes they compare meet at the instants they sound. Its damper falls more slowly in the bass than the treble (`releaseTcFor`), and above F6 there is none, so a released key there rings on. Striking a key that still sounds fades the old voice from the new one's start (`VoiceManager.restrike`, `scheduleTakeVoices` for exports) instead of stacking a second copy of one string, which would build up level and comb-filter. So of two copies of one key struck at one moment — two voices sharing a note — only the one struck last is heard, and playback, scrubbing and exports strike in `sortStrikes` order, quieter copy first, so it is always the louder; the stored order, which the notation reads, is left alone. A note with velocity 0 is written but not played (`isSilentNote`, a score's `dynamics="0"`): none of them sounds it, though the score still draws it. A hidden note is the reverse, played but not written (`isHiddenNote`, a score's `print-object="no"`): all of them sound it, and the notation, which lays out only `writtenNotes`, never draws it. A voice whose selection carries a tone cutoff runs source → lowpass → envelope, the envelope holding its gain plus the make-up; any other has no filter node at all. However a live voice ends — let go, struck again, stolen, called off, stopped — `disconnectSampleVoice` takes it out of the graph, filter and all.

## Scrubbing

`getCrossedNoteOnsets(prev, next, sortedNotes)` is pure and binary-searched with asymmetric boundaries — forward `(prev, next]`, backward `(next, prev)` — so chords travel together and boundary jitter can't double-fire. The scrub controller adds hysteresis (3 ms), a per-move audition cap, clamped preview voices, and a key-flash set (each flash lights its key in the note's hand, as deep as the take plays it); `MusicScore` translates drags into times (playhead visually fixed, score moves) and continues feeding the controller during inertial coasting.

`MusicScore`'s render loop runs only while something on the score moves — playback, recording, a scrub or its coast, a fading ghost note — and sleeps otherwise; the transport, the take, the theme, a resize, a key played or a finger on the score wakes it. Each pass of `scoreRenderer` finds its place in the take by binary search (`firstAtOrAfter`; beams through a per-layout index, since they are in bar order but not time order within a bar), so a frame costs the same twenty minutes into a take as at its start. Spacing is time-proportional, stretched per take (`scoreZoom.basePxPerMsFor`, at most 3×) so its closest common onsets stand 16 px apart, then scaled by the take's `display.zoom`.

## Learn

A chapter is data, not code: an ordered list of steps, each either theory (prose
plus an optional keyboard diagram, staff snippet, circle of fifths, or Listen
demo) or an exercise
carrying an `ExerciseSpec`. `exerciseMatcher.ts` is a pure reducer over that spec
— no React, no `AudioContext` — so the whole matching suite runs headless;
`useExercise` adds only the `subscribeInput` subscription, the held-note
bookkeeping the engine does not do for us, and the hint/skip timers. Adding a
chapter should add content, not engine.

Three facts about the engine shape the design. `scheduleNote` emits no input
events, so a Listen demo can never be mistaken for the user playing — that is
what makes the "press Listen, the exercise stays at 0 of 3" guarantee free.
`noteOn` emits nothing when no sample is decoded, so the runner gates exercises
on `subscribeLoadProgress` and reports readiness through the same
`data-piano-ready` attribute Play uses. `noteOff` emits unconditionally, so the
matcher tolerates orphan releases.

A chapter runs full-screen on the Learn route rather than as a dialog over Play,
because two mounted `PianoKeyboard`s would each attach a `ComputerKeyboardInput`
to `window` — doubling every keypress into two voices under one source id — and
the second unmount would clear the first one's sustain. The runner keeps its own
keyboard anchor (`anchorMidi` / `onAnchorChange`) so a lesson never relocates the
Play keyboard, and re-parks the computer keyboard's octave on every step
(`parkId`), so a Z/X shift ends with the step it was made in. `targetMidis`
lights the keys a step is asking for, styled
apart from the keys the user is holding. Simultaneity specs always allow a short
onset window as well as a true overlap: a mouse is one pointer and physically
cannot hold two keys.

Chapter titles and blurbs live in `Messages`, translated in all four locales;
lesson prose lives in per-locale modules under `features/learn/content/` with a
per-string English fallback. Prose in the catalog would ship every locale's text
to every user (`i18n/index.ts` imports all four eagerly) and length-lock every
paragraph across locales (the parity test walks arrays by index). The level
toggle is an ordinary setting; chapter progress is a metadata row, Zod-parsed on
read and therefore device-local rather than part of the settings backup.

## Importing

Every import ends in one inbox. Whatever reads the file — the Takes page's
pickers, a dropped file or link, the link dialog — turns it into an
`ImportPreview` and hands it to `useImportUiStore`. The shell's `ImportDialogs`,
mounted once beside the export dialogs, shows it over whichever route is up; it
reads only the stores, and loads `ImportInbox` (and `takesService` behind it)
when there is something to show. Confirming commits the take (`commitImport`)
and opens it on Play; a commit that fails says why in an alert dialog, since the
inbox belongs to no one page. A newer preview replaces one still open and starts
again at Copy, keyed by the store's `previewSeq`, so a choice to replace never
carries over to another take. Living outside the routed view, a preview outlives
a route change, and its modal backdrop keeps the nav out of reach meanwhile. The
dialogs carry their own styles (`importDialog.css`), so they look the same on
every route.

The inbox waits its turn. While an export is under way (`isExportState`) or an
export dialog is open, or a recording is counting in or running, a preview stays
in the store and shows once that clears: two modals never stack, an import never
swaps the active take out from under an export, and no dialog lands in the
middle of a performance. Leaving a route already stops a recording, so only a
file or link that finished loading after the user left Takes can meet one.

### Share links

A share link is an address the inbox reads (TAKE_FORMAT.md, Share links):
`#/s/1.<data>` carries a take, `#/lib/<trackId>` names a Library track. Neither
is a route — `parseHash` opens both on Play — so `app/hashLinks.ts` parses them,
and `useHashLinkIntake`, which `ImportDialogs` runs, takes them in. It reads the
address when the shell mounts, which is after `persistenceService.init()` has
restored the last take, since `RouterProvider` mounts only then; and again on
every `hashchange`. It swaps the address for `#/play` with `replaceState` before
anything else, so a reload, Back or StrictMode's second mount never meets the
link again, and parks the link in the import store's `pendingLink`. The link is
claimed — once — when nothing is busy, by the same condition the inbox holds its
dialogs on. A take link loads takesService and its decoder (`domain/takeLink`)
only then and becomes a preview, never an import by itself. A library link is
checked against the catalog and opened with `openLibraryTrack`; a Classics score
that cannot be fetched says why, and the Library is left showing it, as a Learn
hand-off does. An export or recording that starts while a track is on its way
aborts the open, and the link waits its turn again.

A link pasted into the Takes link dialog, or dropped on Takes, goes through
`previewImportLink`: a link of ours, on any host, is read where it is — past the
2,048 characters a download is held to — while any other goes on to
`previewImportUrl`, untouched. A library link is handed to the address bar, for
the intake to open as if it had been followed.

**Share → Link…** opens `ShareLinkDialog` among the export dialogs (one at a
time, and the inbox waits for it as for the others). It reads the take with
`snapshotTake`, so playback carries on under it, and makes the link and the JSON
file as it opens, so Copy, Share… and Send as a file each act inside their own
click.

Of the link code, only `hashLinks` and the intake are in the entry chunk (with
the strings, as all strings are). The codec, takesService and fflate load when
there is a link to read or make — which is why the
MusicXML reader loads with the first Classics score (`scoreLoader`): the
catalog is in the entry, and a module lives in one chunk, so a static import
there would have hoisted every part of fflate a lazy chunk uses, the link's
deflate included, into the entry.

## Persistence and cache invalidation

Dexie v1: `takes` (denormalized summary columns + full JSON — lists never parse takes), `audioCache` (MP3 blobs in a separate table so lists never load audio), `settings`, `metadata`. Schema versions are the migration mechanism. The persistence service debounces autosaves (800 ms), forces saves on recording stop / page hide / before export, restores the last take + playhead, and requests persistent storage after the first meaningful save.

Export caching (MP3 only; a FLAC export is never cached): `takeHash` hashes only audible content (notes/pedals/tempo/reverb mix and room/pack + bitrate + metronome + loudness + exporter version, and Tone follows touch when it is off, so an export with the tone on keeps the key it always had); the take store bumps a `contentRevision` only for audible edits, and the autosave layer invalidates the cached MP3 exactly when that moves — renames, playhead changes and the volume slider never rerender audio.

## Theming

Two named themes share one token vocabulary in `src/themes.css`: Conservatory (dark) is the default on `:root`, Ivory recital (light) overrides colors under `html[data-theme='light']`; `color-scheme` flips with them so native controls follow. The preference (`dark | light | system`, default dark) is an ordinary setting (store + zod schema + Dexie row). `src/app/theme.ts` resolves preference × `prefers-color-scheme`, stamps `html[data-theme]`, updates the `theme-color` meta, and mirrors the preference to `localStorage['pokeyboard.theme']`; a tiny inline script in `index.html` reads that mirror **before first paint** so a light-theme user never flashes dark while Dexie loads (the controller deliberately applies nothing at init — the first store emit after hydration reconciles mirror vs Dexie truth, Dexie winning). The live score canvas can't read CSS variables at draw time, so `SCORE_PALETTES` in `scoreRenderer.ts` duplicates both palettes (kept in sync by comment convention) and the theme joins `MusicScore`'s redraw signature; sheet/PDF engraving stays print-monochrome and is untouched by theming. A lit key's tokens (`--key-*-active-*`, `--key-*-left-*`) are the loudest note's colours; `keyboard.css` mixes each toward the key's own colour in OKLab by how hard the note was played (`--live-shade` and `--take-shade`, from `keyShading.ts`: the velocity that sounds, as `SoundingNotes.keysAt`, the scrub flashes and `AudioEngine.getActiveVelocities` report it), inside `@supports (color-mix)` so a browser without it lights keys at full strength. The falling notes' canvas cannot read the tokens either: `WATERFALL_PALETTES` in `waterfallPalette.ts` copies the key colours (a test reads `themes.css` and compares), and `mixOklab` mixes them as `color-mix(in oklab, …)` does — pinned against Chromium's own mixes — so each bar is the colour its key lights with. Display type is a self-hosted Fraunces 600 latin subset (`@fontsource/fraunces`), precached by the existing `woff2` glob.

## Audio encoding

The export service copies the rendered buffer's channels, **transfers** them to a Worker that masters them and encodes MP3 (LAME via wasm-media-encoders) or FLAC (the app's own encoder, `flacEncode.ts`: linear prediction, adaptive stereo, partitioned Rice, MD5 — see AUDIO_EXPORT.md), streams progress (mastering's steps, then each ~2 s chunk or 4096-sample frame; the render's own progress comes from its pauses), validates plausibility (an MP3's size vs duration·bitrate, a FLAC's STREAMINFO vs the render), stores an MP3 in `audioCache`, tags the file (ID3 or Vorbis comments), and hands the UI a `File` for `navigator.share` — called only from a fresh click, with download as the universal fallback. The same encoders run on the main thread, a slice at a time, where the worker cannot.

## PWA

Workbox `injectManifest`: shell precache (~2.0 MB), SPA navigation fallback, Cache First runtime caching for every versioned sample pack in one named cache shared with the explicit per-piano download flow in Settings → Sound (which downloads and deletes per piano, enumerating the cache by pack path). Updates wait until the user applies them (`SKIP_WAITING` message) and the UI refuses to offer them while the transport is busy.
