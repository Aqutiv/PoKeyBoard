# Learn — the course roadmap

The Learn tab is a 30-chapter piano course: three levels of ten, each in three
named parts. Chapters ship one at a time; unwritten ones still appear in the
outline, because seeing where this goes is most of why someone starts.

This file is the plan of record. The code in `src/features/learn/` is the
implementation of it — `chapters.ts` is the catalog, and it and this document
must agree.

## Status

|              | Built | Remaining |
| ------------ | ----- | --------- |
| Beginner     | 6     | 4         |
| Intermediate | 0     | 10        |
| Advanced     | 0     | 10        |

---

## Beginner

_Never touched a piano → a simple piece, hands together._

### Part 1 — The instrument

| #   | Chapter                                         | Teaches                                                                                        | Exercises validate                                                                                             |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | **Meet the Keyboard** ✅                        | Sound; low left / high right; black keys in 2s and 3s; C left of every pair; octaves; middle C | 3 distinct keys · a rising leap · a group of 2 and of 3 · three different Cs · an octave held                  |
| 2   | **The Musical Alphabet** ✅                     | A–G and how it wraps; the landmark map for every white key; octave numbering                   | walk up C→C · name a highlighted key ×5 · D then F then A · walk down C→C · two different As                   |
| 3   | **Half Steps, Whole Steps & the Black Keys** ✅ | Semitone vs. tone; the two places white keys touch; sharps, flats and enharmonics              | any two touching keys · any two a whole step apart · E F B C · name a black key ×5 · find a named black key ×5 |

### Part 2 — Reading music

| #   | Chapter                                 | Teaches                                                                                                            | Exercises validate                                                                                                 |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 4   | **Reading the Treble Staff** ✅         | Staff, lines and spaces, treble clef; middle C on its ledger line; right-hand five-finger position; finger numbers | play middle C off the stave · name a written note ×5 · play a written note ×5 · the five-note run up and back down |
| 5   | **The Bass Staff & the Grand Staff** ✅ | Bass clef and its own lines and spaces; left hand below middle C; how the staves join                              | read and play bass-clef notes; a grand-staff pair, one note per hand                                               |
| 6   | **Rhythm & the Beat** ✅                | Pulse; 4/4 and the time signature; whole/half/quarter/eighth and rests; bar lines; the metronome                   | tap a steady pulse with the click; play a written rhythm on one pitch, in time                                     |

### Part 3 — Playing

| #   | Chapter                        | Teaches                                                                                                 | Exercises validate                                                                     |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 7   | Your First Melody              | Pitch and rhythm together; phrases; following notation left to right                                    | an 8-bar melody from the page, in tempo → hand off to Play                             |
| 8   | The C Major Scale              | W-W-H-W-W-W-H; why C major is all white keys; the thumb tuck; degrees 1–8                               | the scale up and down, one octave, in order                                            |
| 9   | Triads: Major and Minor        | Stacking thirds; root/third/fifth; C, F, G major and A, D, E minor; the third decides the mood          | named triads as blocks; turn a major triad minor by moving one note                    |
| 10  | Chords, Pedal & Hands Together | I–V–vi–IV; the sustain pedal and changing it on the harmony; left-hand chords under a right-hand melody | the progression with pedal changes; a short piece hands together → hand off to Library |

---

## Intermediate

_One piece in C → several keys, with real accompaniment._

### Part 1 — Getting serious

| #   | Chapter                               | Teaches                                                                                                  | Exercises validate                                       |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | How to Practise                       | Slow practice, hands separate, chunking, spaced repetition; the metronome and the record button as tools | the same passage at 60, 80 and 100 bpm against the click |
| 2   | Key Signatures & the Circle of Fifths | Why sharps/flats sit at the clef; their order; finding the tonic; the circle                             | name the key from a signature; play its tonic and scale  |
| 3   | Scales Beyond C                       | G, F and D major; where the black keys land; why the fingering shifts                                    | each scale, one octave, with the right shape             |

### Part 2 — Harmony's building blocks

| #   | Chapter                       | Teaches                                                                               | Exercises validate                                                        |
| --- | ----------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 4   | Minor Keys                    | Relative vs. parallel minor; natural, harmonic and melodic; the raised leading tone   | the three minor scales from one root; the relative minor of a given major |
| 5   | Intervals — By Eye and By Ear | 2nd through octave; major/minor/perfect; how each looks and sounds                    | play a named interval above a note; hear one and play it back             |
| 6   | Inversions & Voice Leading    | Root position, 1st, 2nd; why inversions smooth a progression; move the least distance | a triad in all three positions; re-voice a progression                    |

### Part 3 — Playing with style

| #   | Chapter                           | Teaches                                                                     | Exercises validate                                                                  |
| --- | --------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 7   | Rhythm Beyond 4/4                 | 3/4 and 6/8; simple vs. compound; ties, dotted notes, triplets; syncopation | written syncopated and triplet rhythms against the click                            |
| 8   | Arpeggios & Broken Chords         | Chords spread over two octaves; the hand crossing; wide left-hand shapes    | a two-octave arpeggio, both hands separately                                        |
| 9   | Accompaniment Patterns            | Block chords, broken chords, Alberti bass, waltz bass, pop eighths          | an Alberti bass under a given melody                                                |
| 10  | Dynamics, Articulation & Phrasing | p/mf/f, crescendo and diminuendo; legato vs. staccato; shaping an arc       | a phrase with a dynamic contour (pointer input); the same line legato then staccato |

---

## Advanced

_Playing correctly → playing musically, and inventing._

### Part 1 — Richer harmony

| #   | Chapter                       | Teaches                                                                                          | Exercises validate                                 |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 1   | Seventh Chords & Extensions   | maj7 / m7 / dominant 7 / diminished; colour and tension                                          | named seventh chords                               |
| 2   | Cadences & Functional Harmony | Tonic, subdominant, dominant; roman numerals; perfect, plagal and deceptive cadences; the ii–V–I | a ii–V–I in a given key; identify a cadence by ear |
| 3   | Modes & Colour                | Dorian, Mixolydian, Lydian and the rest; borrowing; how a mode changes the mood                  | three modes from the same root                     |

### Part 2 — Independence and control

| #   | Chapter               | Teaches                                                                                  | Exercises validate                            |
| --- | --------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| 4   | Two-Hand Independence | Different rhythms per hand; simple counterpoint; keeping one hand steady                 | two rhythms at once against the click         |
| 5   | Ornaments             | Grace notes, trills, mordents, turns; how they are written and how they are played       | a written trill, mordent and grace note       |
| 6   | Sight-Reading         | Scanning ahead; recognising shapes not notes; not looking down; carrying on after a slip | an unseen 4-bar line, first attempt, in tempo |

### Part 3 — Making it your own

| #   | Chapter                      | Teaches                                                                     | Exercises validate                                                     |
| --- | ---------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 7   | Playing by Ear & Transposing | Finding a melody you can hear; moving it to another key                     | play back a heard phrase; transpose it                                 |
| 8   | Song Form & Structure        | Verse/chorus, AABA, the twelve-bar blues; building an arrangement           | build a 12-bar blues; identify a form                                  |
| 9   | Reading a Lead Sheet         | Chord symbols to performance; choosing a voicing and a pattern              | realise a lead sheet from symbols                                      |
| 10  | Improvise Over a Progression | Pentatonic and blues scales; target notes; call and response; leaving space | stay in scale over a looping progression, then record a chorus on Play |

---

## What the app can and cannot teach

This shapes every chapter and is not negotiable.

**Can validate exactly:** which key (pitch), which keys held together, the order
of a sequence, timing against the metronome (input is audio-clock stamped), and
sustain-pedal state. Velocity too, but only from pointer input — the computer
keyboard is fixed-velocity, so dynamics exercises must be pointer-only or
ungated.

**Cannot validate:** fingering, hand shape, wrist height, posture, arm weight.
There is no camera and no per-finger signal.

So the course teaches _musicianship at the keyboard_ — reading, rhythm, harmony,
ear. Technique appears as guidance inside theory cards and is never a gate.

---

## Adding a chapter

Five files, and one of them is a one-line flip.

1. `src/features/learn/chapters/<id>.ts` — the steps (see `meetTheKeyboard.ts`
   and `musicalAlphabet.ts`).
2. `src/features/learn/content/en/<id>.ts` — the prose, keyed by step id.
3. `src/features/learn/content/index.ts` — register the prose module.
4. `src/features/learn/chapters.ts` — change that chapter's `load: null` to the
   dynamic import. **That single edit is what ships it.**
5. Tests — extend `tests/unit/learn/catalog.test.ts` and
   `tests/e2e/learn.spec.ts`.

Chapter titles and blurbs already exist in all four locales; only the prose is
English-first, with a per-string fallback (`content/index.ts`).

**Chapter ids are permanent.** Progress is keyed by id and chapters have already
moved between levels once, so re-levelling costs nobody their place. Changing an
id would.

---

## Step kinds and exercise specs

Four step kinds (`src/features/learn/types.ts`):

- `theory` — prose, plus an optional keyboard diagram, staff snippet, or Listen
  demo.
- `exercise` — carries an `ExerciseSpec`; the user plays it.
- `quiz` — recognition instead of production; the app shows something and the
  user names it. Question kinds: `nameTheKey`, `readNote`.
- `drill` — the mirror of a quiz: the app names something and the user plays
  it, over several rounds. Not an `ExerciseSpec` kind — rounds cannot live in a
  spec, since the matcher is a pure reducer with no notion of them. A drill is
  a _sequencer over_ specs: each round hands `useExercise` a fresh
  `ExerciseSpec`, whose new identity is exactly what resets the matcher, so all
  the matching, hints and timers come free. Round order is shared with the quiz
  (`rounds.ts`). Pool kinds: `namedKey`, `readNote`.

A correct answer is **held on screen for 500ms** before the next round replaces
it (`HOLD_MS` in `useDrill.ts`). Advancing on the same render that satisfied a
round meant the moment being celebrated never painted — the note just found
never got to light up. The readout ticks immediately, so the confirmation is
instant and only the question waits.

Both `quiz` and `drill` render inline in the chapter card, never as a dialog —
see the `aria-modal` constraint below. Either can ask its question with a
**staff** rather than a keyboard: `readNote` on a quiz, `readNote` on a drill
pool. A reading round carries no written note name, because that would be the
answer — which also means it cannot be completed by screen reader. See the
limitations below.

A reading round grades on `exactKeys`, not `pitchClass`: the drawing is
octave-pinned and the whole subject is _which line the note sits on_, so the
octave above is a different answer rather than a near-miss. It would also
complete the round with the drawn head still dark, teaching the opposite of
the lesson.

The click a rhythm lesson is judged against is Learn's own `MetronomeEngine`
(`lessonClick.ts`), not `transportController.metronome`. Sharing that one would
mean sharing its hazards — every transport stop path calls `stop()` on it — but
the sharper problem is that a Play metronome left switched on while the
transport sits _idle_ is already running when a chapter opens, which the
runner's stop-a-busy-transport guard does not cover. A module singleton rather
than one per mount, because `MetronomeEngine` has no `dispose()` and `attach`
connects a `GainNode` nothing ever disconnects.

A step gets the click if its spec is a `rhythm` or if it says `click: true`.
Derived with an override, so a rhythm spec can never be authored without the
click it is graded against, while a theory card can still start one early —
which chapter 6 does, so the pulse is heard a step before it is graded.

Notation for a lesson is drawn low-chrome, on whichever staves it asks for:
`ScoreView` takes `staves: 'treble' | 'bass' | 'grand'` and
`chrome: 'bare' | 'full'`, and `computeScoreGeometry(layout, { staves })`
collapses the height to match. Both default to the grand staff with full
chrome, so the Play page is untouched. `StaffSnippet` takes `staves` as a prop
and hands it to _both_ the geometry and the draw view — if those two disagree,
a one-staff picture lands in a two-staff canvas.

`chrome` has three values, not two. `'lesson'` keeps the time signature but
still leaves off the measure number and the empty spill bar — chapter 6 teaches
the time signature, and `'full'` would have brought a floating measure number
with it. The checks read through `chromeOf(view)`, which defaults to `'full'`,
because the Play page passes no `chrome` at all: compared raw, every piece of
furniture would have quietly switched off for the live score.

`StaffSnippet` blanks derived rests by default and takes `showRests` to keep
them. `deriveRests` answers "what silence did this performance leave over", and
a worked example is not a performance — except in the chapter where the silence
_is_ the subject. Note it fills **both** staves, so a rhythm phrase must stay
treble-only or a grand snippet sprouts a bar of bass whole rests.

A single staff is drawn in the treble slot whichever clef it carries, so
`bassTop` collapses onto `trebleTop`. That makes filtering by staff a
correctness matter rather than an optimisation: `drawChords` now skips a chord
`drawsStaff` says this view does not show, because otherwise it would be drawn
on the staff that _is_ shown, measured from the other clef's reference line —
the wrong line, silently. `drawTies` and `computeBeamLines` still do not
filter; neither can fire for a lesson snippet, which is whole notes with no
ties.
`StaffSnippet` also blanks `rests`, because `deriveRests` answers "what silence
did this performance leave over" and a worked example is not a performance.

A written note **lights up while the user holds that key**: `ScoreRenderInput`
takes an optional `litMidis`, and `ChapterRunner` feeds it `useLiveActiveNotes()`
— the same hook `PianoKeyboard` lights its own keys from, so the stave and the
keyboard under it agree by construction. It excludes scheduled playback, so a
Listen demo lights nothing, matching the matcher. `QuizPanel` deliberately does
_not_ pass it: in "which note is this?" the stave is the question and the answer
is a letter button, so lighting the played head would let the quiz be
brute-forced on the keyboard.

Note labels come from `noteLabel(midiOrPitchClass, spelling)`
(`src/features/learn/noteLabel.ts`), which wraps the notation engine's own
spelling tables so a lesson and the engraver can never disagree about whether a
key is C♯ or D♭.

`ExerciseSpec` kinds (`src/features/learn/exerciseSpec.ts`), and who needs them:

| Kind            | Means                                                      | Used by        |
| --------------- | ---------------------------------------------------------- | -------------- |
| `distinctKeys`  | any N different keys                                       | B1             |
| `risingLeap`    | a note, then one at least N semitones higher               | B1             |
| `pitchClass`    | one named pitch class, optionally in N octaves             | B1, B2, B3     |
| `blackKeyGroup` | a whole group of 2 or 3 black keys                         | B1             |
| `interval`      | two notes N semitones apart, optionally pitch-class pinned | B1, B3, I5     |
| `exactKeys`     | exactly these midis                                        | B5, B9, A1     |
| `sequence`      | these pitch classes in this order, optionally up/down      | B2, B3, B8, I3 |
| `rhythm`        | these beat offsets, in time with the click                 | B6, I7, A4     |

An `interval` with no `lowerPitchClass` and no `together` reads the cumulative
candidate set, which makes it "any two keys N semitones apart" rather than one
pinned pair — that is what B3's half- and whole-step exercises are, and it is
also what lets a one-pointer mouse play them.

`rhythm` is the only kind judged on _when_ rather than _what_, and the only one
that needs something outside the reducer to mean anything. Its `beats` are
offsets from a bar line rather than absolute positions, so a pattern matches at
any bar and the user can listen for a bar or two before joining in — which is
all that counting in ever means. `ExerciseInput` carries `atBeats`, converted
from the audio clock by the adapter, so the reducer never sees wall time or the
grid and stays as pure as the rest.

It grades in order, against the next target only, exactly as `sequence` does.
That is what distinguishes playing the rhythm from hitting some of the beats,
and it is the only way an extra note can be noticed at all. A press that is not
within tolerance of the next target resets the attempt and is then re-tested as
a possible _start_ — one rule that forgives a late note, forgives a whole bad
bar, and stops the step being passed by mashing, since a press between targets
is on neither the next beat nor a bar line.

Tolerance is `DEFAULT_RHYTHM_TOLERANCE_BEATS`, a quarter of a beat either side,
stated in beats rather than milliseconds so it means the same thing at any
tempo. Two windows must not overlap, so a chapter authoring anything shorter
than an eighth note has to tighten it — a catalog test enforces the relationship
rather than the number.

Still likely: a `playAlong` spec that follows a written line (B7, A6).

---

## Standing constraints

Learned the hard way; violating any of these produces a silent failure.

- **A mouse is one pointer.** `KeyboardPointerTracker` sounds one key per
  pointer id, so a desktop mouse physically cannot hold two keys. Every
  simultaneity spec must set `together: { overlap: true, onsetWindowMs: 400 }`
  so a fast roll counts too. A test enforces this for chapter 1.
- **`scheduleNote` emits no input events.** That is what lets a Listen demo
  exist without completing the exercise for the user. Never drive a demo
  through `noteOn`.
- **`noteOn` emits nothing when no sample is decoded**, so the runner gates
  exercises on `subscribeLoadProgress` and reports through `data-piano-ready`.
  `noteOff` emits unconditionally, so matchers tolerate orphan releases.
- **Nothing in the runner may be `aria-modal`.** `computerKeyboard.ts` ignores
  every keystroke while `[aria-modal="true"]` exists anywhere on the page —
  a modal quiz or dialog would silently kill note input for the whole lesson.
- **Space is the sustain pedal** and is `preventDefault`ed, so a focused button
  will not activate on it. Keep Next reachable with Enter; bind nothing to Space.
- **The computer keyboard follows a lesson's anchor, snapped down to a C.**
  `BaseOctave` is what Z/X move and what the letter rows play from; it is not
  the visible range, and before chapter 5 nothing kept the two in the same
  register. A lesson below middle C was therefore unplayable from a computer
  keyboard — `A` sounded C4, which is _on screen_, so `needsRangeShift` stayed
  quiet (it only fires when **no** target is in range). `PianoKeyboard` now
  moves the base with an externally-driven anchor. Snapped down to a C, because
  `KEY_TO_SEMITONE` is chromatic from the base with the black keys on the upper
  row: a base that is not a C puts the black row on white keys. A step anchored
  at E4 therefore keeps the base at C4, exactly as before.
- **A rhythm lesson is unwinnable by ear at `metronomeVolume: 0`.** The setting
  is persisted and user-editable, and the lesson honours it as it stands: the
  click still runs and the exercise still grades, but there is nothing to hear.
  Overriding a volume somebody deliberately set would be the worse failure.
- **`MetronomeEngine` has no `dispose()`,** and `attach` no-ops when the context
  is unchanged — so rebuilding the audio graph under a live context (an
  instrument switch) leaves the click connected to a stale destination. This is
  pre-existing in `transportController.configureMetronome`, and Learn inherits
  it rather than introduces it.
- **A phone shows about one octave.** At 375px the keyboard auto-sizes to ~9
  white keys, so anything needing three of the same note requires the range
  shifter. Design that in as content rather than working around it — chapter 1
  step 8 teaches the shifter for exactly this reason.
- **Only one `PianoKeyboard` may be mounted.** Two would each attach a
  `ComputerKeyboardInput` to `window`, doubling every keypress into two voices
  under one source id. This is why a chapter runs full-screen on its own route
  rather than as a dialog over Play.

## Known limitations

- **Very short screens scroll the lesson card.** At 320×568 the card gets about
  220px once the keyboard, footer and nav have taken theirs, so a quiz's answer
  row sits below the fold and has to be scrolled to. `.piano__keys` has a 130px
  floor, so the key bed cannot give back any more. Fine at 375px and above.
- **Short landscape has no layout.** `PlayPage` solves the same prose-plus-
  keyboard squeeze with a segmented Notation/Keyboard switch
  (`index.css`, `orientation: landscape and max-height: 500px`); the runner
  should reuse that pattern and does not yet.
- **Lesson prose is English-only.** Chapter titles and blurbs are translated;
  the inside of a chapter falls back per string.
- **Reading rounds cannot be done by screen reader.** The staff canvas is
  `role="img"` with a generic label; naming the note would announce the answer.
  A drill that asks you to read a picture is inherently visual, so the skip
  affordance is the honest escape hatch rather than a fake label.
- ~~**Only note heads light, not stems, flags or beams.**~~ Answered by
  chapter 6, and the answer is _deliberately nothing_. A head says which note is
  sounding; a stem and a flag are part of how long it lasts, and a beam belongs
  to the group rather than to any one note — so there is no half-lit beam to
  colour, and lighting one would say something untrue about the others under it.
  A `scoreDraw` test pins it, so a later refactor cannot quietly change its mind.
- ~~**A note below middle C needs an explicit `staff` hint.**~~ Answered by
  chapter 5. `midiToStaffPosition` still splits on `TREBLE_SPLIT_MIDI = 60`, but
  a lesson no longer relies on it: `LearnVisual` carries `staves`, a `readNote`
  quiz or drill pool carries `staff`, and chapter 5 states the staff on every
  note it writes — because the note the split gets wrong is middle C itself,
  which the chapter draws on both staves on purpose.

---

## Growth room

Deliberately not in the 30: Ear Training as its own thread, Pedalling in depth,
Repertoire Studies, Duets, Composition. The level toggle and part headings scale
to more cards without redesign.
