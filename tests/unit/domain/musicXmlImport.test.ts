import { describe, expect, it } from 'vitest';
import { musicXmlToTake } from '@/domain/musicXmlImport';
import { parseTakeJson } from '@/domain/takeSchema';
import { ScoreImportError } from '@/utils/errors';

const DEFAULT_VELOCITY = 90 / 127; // forte at 100% dynamics

const DIV1 =
  '<attributes><divisions>1</divisions>' +
  '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>';

function note(step: string, octave: number, duration: number, extra = ''): string {
  return (
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
    `<duration>${duration}</duration>${extra}</note>`
  );
}

function alteredNote(step: string, octave: number, alter: number, duration: number): string {
  return (
    `<note><pitch><step>${step}</step><alter>${alter}</alter><octave>${octave}</octave></pitch>` +
    `<duration>${duration}</duration></note>`
  );
}

function rest(duration: number): string {
  return `<note><rest/><duration>${duration}</duration></note>`;
}

function measure(number: number, content: string): string {
  return `<measure number="${number}">${content}</measure>`;
}

function scoreWithParts(partsMeasures: string[], titlesXml = ''): string {
  const partList = partsMeasures
    .map((_, i) => `<score-part id="P${i + 1}"><part-name>P${i + 1}</part-name></score-part>`)
    .join('');
  const parts = partsMeasures
    .map((measures, i) => `<part id="P${i + 1}">${measures}</part>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<score-partwise version="3.1">${titlesXml}<part-list>${partList}</part-list>${parts}</score-partwise>`
  );
}

function scoreWith(measuresXml: string, titlesXml = ''): string {
  return scoreWithParts([measuresXml], titlesXml);
}

describe('musicXmlToTake basics', () => {
  it('converts a single quarter note at the default 120 BPM', () => {
    const take = musicXmlToTake(
      scoreWith(measure(1, DIV1 + note('C', 4, 1)), '<movement-title>Tune</movement-title>'),
    );
    expect(take.title).toBe('Tune');
    expect(take.notes).toHaveLength(1);
    expect(take.notes[0]!.midi).toBe(60);
    expect(take.notes[0]!.startMs).toBe(0);
    expect(take.notes[0]!.durationMs).toBe(500);
    expect(take.notes[0]!.velocity).toBeCloseTo(DEFAULT_VELOCITY, 5);
    expect(take.tempo.bpm).toBe(120);
    expect(take.durationMs).toBe(500);
  });

  it('produces a take that re-imports through parseTakeJson without repairs', () => {
    const take = musicXmlToTake(scoreWith(measure(1, DIV1 + note('C', 4, 1))));
    const { repairs } = parseTakeJson(take);
    expect(repairs).toEqual([]);
  });

  it('prefers the work-title over the movement-title', () => {
    const take = musicXmlToTake(
      scoreWith(
        measure(1, DIV1 + note('C', 4, 1)),
        '<work><work-title>Sonata</work-title></work><movement-title>I. Allegro</movement-title>',
      ),
    );
    expect(take.title).toBe('Sonata');
  });

  it('falls back to the file name when the score has no title', () => {
    const take = musicXmlToTake(scoreWith(measure(1, DIV1 + note('C', 4, 1))), 'my song.mxl');
    expect(take.title).toBe('my song');
  });

  it('respects divisions, including a mid-part change', () => {
    const xml = scoreWith(
      measure(
        1,
        '<attributes><divisions>2</divisions></attributes>' + note('C', 4, 2) + note('D', 4, 2),
      ) + measure(2, '<attributes><divisions>4</divisions></attributes>' + note('E', 4, 8)),
    );
    const take = musicXmlToTake(xml);
    expect(take.notes.map((n) => n.startMs)).toEqual([0, 500, 1000]);
    expect(take.notes[2]!.durationMs).toBe(1000);
  });

  it('throws when durations appear before any divisions declaration', () => {
    expect(() => musicXmlToTake(scoreWith(measure(1, note('C', 4, 1))))).toThrow(ScoreImportError);
  });
});

describe('voices, chords, and gaps', () => {
  it('gives chord notes the same onset', () => {
    const take = musicXmlToTake(
      scoreWith(measure(1, DIV1 + note('C', 4, 1) + note('E', 4, 1, '<chord/>'))),
    );
    expect(take.notes.map((n) => [n.midi, n.startMs, n.durationMs])).toEqual([
      [60, 0, 500],
      [64, 0, 500],
    ]);
  });

  it('overlaps voices separated by backup', () => {
    const take = musicXmlToTake(
      scoreWith(
        measure(
          1,
          DIV1 + note('C', 4, 4) + '<backup><duration>4</duration></backup>' + note('G', 4, 4),
        ),
      ),
    );
    expect(take.notes.map((n) => [n.midi, n.startMs])).toEqual([
      [60, 0],
      [67, 0],
    ]);
    expect(take.durationMs).toBe(2000);
  });

  it('advances over forward elements and rests', () => {
    // Measure 1 spans only 3 quarters, so measure 2 starts at the furthest
    // position reached (the pickup-measure rule), not the nominal 4 quarters.
    const take = musicXmlToTake(
      scoreWith(
        measure(
          1,
          DIV1 + note('C', 4, 1) + '<forward><duration>1</duration></forward>' + note('E', 4, 1),
        ) + measure(2, note('F', 4, 1) + rest(2) + note('G', 4, 1)),
      ),
    );
    expect(take.notes.map((n) => n.startMs)).toEqual([0, 1000, 1500, 3000]);
  });

  it('advances an empty measure by its nominal length', () => {
    const take = musicXmlToTake(scoreWith(measure(1, DIV1) + measure(2, note('C', 4, 1))));
    expect(take.notes[0]!.startMs).toBe(2000);
  });

  it('merges parallel parts onto one timeline, seeding divisions forward', () => {
    const take = musicXmlToTake(
      scoreWithParts([measure(1, DIV1 + note('C', 3, 4)), measure(1, note('E', 5, 4))]),
    );
    expect(take.notes.map((n) => [n.midi, n.startMs])).toEqual([
      [48, 0],
      [76, 0],
    ]);
  });

  it('skips grace notes without advancing time', () => {
    const graceNote = '<note><grace/><pitch><step>B</step><octave>3</octave></pitch></note>';
    const take = musicXmlToTake(scoreWith(measure(1, DIV1 + graceNote + note('C', 4, 1))));
    expect(take.notes).toHaveLength(1);
    expect(take.notes[0]!.startMs).toBe(0);
  });

  it('skips out-of-range pitches but keeps their duration', () => {
    const take = musicXmlToTake(scoreWith(measure(1, DIV1 + note('C', 10, 1) + note('E', 4, 1))));
    expect(take.notes.map((n) => [n.midi, n.startMs])).toEqual([[64, 500]]);
  });
});

describe('staves and voices', () => {
  const GRAND_DIV1 =
    '<attributes><divisions>1</divisions>' +
    '<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>';

  it('sends the lower staff to the bass clef however high it is written', () => {
    // The shape of Mozart K. 545's opening: a right-hand C5 over a left-hand
    // Alberti figure written at C4/E4/G4 — every note at or above middle C.
    const take = musicXmlToTake(
      scoreWith(
        measure(
          1,
          GRAND_DIV1 +
            note('C', 5, 4, '<voice>1</voice><staff>1</staff>') +
            '<backup><duration>4</duration></backup>' +
            note('C', 4, 1, '<voice>5</voice><staff>2</staff>') +
            note('G', 4, 1, '<voice>5</voice><staff>2</staff>') +
            note('E', 4, 1, '<voice>5</voice><staff>2</staff>') +
            note('G', 4, 1, '<voice>5</voice><staff>2</staff>'),
        ),
      ),
    );
    expect(take.notes.map((n) => [n.midi, n.staff])).toEqual([
      [60, 'bass'],
      [72, 'treble'],
      [67, 'bass'],
      [64, 'bass'],
      [67, 'bass'],
    ]);
    // Each staff renumbers its own voices from 0, so "1" and "5" both land there.
    expect(take.notes.every((n) => n.voice === 0)).toBe(true);
  });

  it('treats an omitted staff element as the top staff', () => {
    const take = musicXmlToTake(scoreWith(measure(1, GRAND_DIV1 + note('C', 4, 1))));
    expect(take.notes[0]!.staff).toBe('treble');
  });

  it('leaves a single-staff part without staff or voice hints', () => {
    const take = musicXmlToTake(scoreWith(measure(1, DIV1 + note('C', 4, 1))));
    expect(take.notes[0]).not.toHaveProperty('staff');
    expect(take.notes[0]).not.toHaveProperty('voice');
  });

  it('numbers a second voice on the same staff separately', () => {
    const take = musicXmlToTake(
      scoreWith(
        measure(
          1,
          GRAND_DIV1 +
            note('C', 5, 4, '<voice>1</voice><staff>1</staff>') +
            '<backup><duration>4</duration></backup>' +
            note('E', 4, 1, '<voice>2</voice><staff>1</staff>'),
        ),
      ),
    );
    expect(take.notes.map((n) => [n.midi, n.staff, n.voice])).toEqual([
      [64, 'treble', 1],
      [72, 'treble', 0],
    ]);
  });

  it('records a clef only where it is not the staff’s own', () => {
    // Mozart K. 545 gives its lower staff a G clef where the left hand climbs.
    const gClefOnStaff2 =
      '<attributes><divisions>1</divisions>' +
      '<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>' +
      '<clef number="1"><sign>G</sign><line>2</line></clef>' +
      '<clef number="2"><sign>G</sign><line>2</line></clef></attributes>';
    const take = musicXmlToTake(
      scoreWith(
        measure(
          1,
          gClefOnStaff2 +
            note('C', 5, 4, '<staff>1</staff>') +
            '<backup><duration>4</duration></backup>' +
            note('C', 4, 4, '<staff>2</staff>'),
        ),
      ),
    );
    const [lower, upper] = take.notes as [(typeof take.notes)[0], (typeof take.notes)[0]];
    // The upper staff's G clef is its own, so it says nothing.
    expect(upper).not.toHaveProperty('clef');
    // The lower staff's is not, so it is carried.
    expect(lower.staff).toBe('bass');
    expect(lower.clef).toBe('treble');
  });

  it('turns a clef back when the score does', () => {
    const clefFor = (sign: string): string =>
      `<attributes><clef number="2"><sign>${sign}</sign><line>${sign === 'G' ? 2 : 4}</line></clef></attributes>`;
    const take = musicXmlToTake(
      scoreWith(
        measure(1, GRAND_DIV1 + clefFor('G') + note('C', 4, 4, '<staff>2</staff>')) +
          measure(2, clefFor('F') + note('C', 3, 4, '<staff>2</staff>')),
      ),
    );
    expect(take.notes.map((n) => n.clef)).toEqual(['treble', undefined]);
  });

  it('drops a clef override when a C clef takes over from it', () => {
    // G on the lower staff, then alto: the G must not stand after the alto
    // replaced it, or every later note reads under a clef the score dropped.
    const clefFor = (sign: string, line: number): string =>
      `<attributes><clef number="2"><sign>${sign}</sign><line>${line}</line></clef></attributes>`;
    const take = musicXmlToTake(
      scoreWith(
        measure(1, GRAND_DIV1 + clefFor('G', 2) + note('C', 4, 4, '<staff>2</staff>')) +
          measure(2, clefFor('C', 3) + note('C', 4, 4, '<staff>2</staff>')),
      ),
    );
    expect(take.notes[0]!.clef).toBe('treble');
    expect(take.notes[1]).not.toHaveProperty('clef');
  });

  it('ignores a C clef, leaving the staff reading its own', () => {
    const take = musicXmlToTake(
      scoreWith(
        measure(
          1,
          GRAND_DIV1 +
            '<attributes><clef number="2"><sign>C</sign><line>3</line></clef></attributes>' +
            note('C', 4, 4, '<staff>2</staff>'),
        ),
      ),
    );
    expect(take.notes[0]).not.toHaveProperty('clef');
  });

  it('keeps the staff of the note a tie chain started on', () => {
    const take = musicXmlToTake(
      scoreWith(
        measure(
          1,
          GRAND_DIV1 +
            note('C', 4, 4, '<voice>5</voice><staff>2</staff><tie type="start"/>') +
            '<backup><duration>4</duration></backup>' +
            rest(4),
        ) +
          measure(
            2,
            note('C', 4, 4, '<voice>5</voice><staff>2</staff><tie type="stop"/>') +
              '<backup><duration>4</duration></backup>' +
              rest(4),
          ),
      ),
    );
    expect(take.notes).toHaveLength(1);
    expect(take.notes[0]!.staff).toBe('bass');
    expect(take.notes[0]!.durationMs).toBe(4000);
  });
});

describe('ties', () => {
  const tieStart = '<tie type="start"/>';
  const tieStop = '<tie type="stop"/>';

  it('merges a tie across the barline into one note', () => {
    const take = musicXmlToTake(
      scoreWith(
        measure(1, DIV1 + note('C', 4, 4, tieStart)) + measure(2, note('C', 4, 4, tieStop)),
      ),
    );
    expect(take.notes).toHaveLength(1);
    expect(take.notes[0]!.startMs).toBe(0);
    expect(take.notes[0]!.durationMs).toBe(4000);
  });

  it('follows a three-note tie chain', () => {
    const take = musicXmlToTake(
      scoreWith(
        measure(1, DIV1 + note('C', 4, 4, tieStart)) +
          measure(2, note('C', 4, 4, tieStop + tieStart)) +
          measure(3, note('C', 4, 4, tieStop)),
      ),
    );
    expect(take.notes).toHaveLength(1);
    expect(take.notes[0]!.durationMs).toBe(6000);
  });

  it('honors notation-only tied elements', () => {
    const take = musicXmlToTake(
      scoreWith(
        measure(1, DIV1 + note('C', 4, 4, '<notations><tied type="start"/></notations>')) +
          measure(2, note('C', 4, 4, '<notations><tied type="stop"/></notations>')),
      ),
    );
    expect(take.notes).toHaveLength(1);
    expect(take.notes[0]!.durationMs).toBe(4000);
  });

  it('emits an orphan tie stop as a plain note', () => {
    const take = musicXmlToTake(scoreWith(measure(1, DIV1 + note('C', 4, 1, tieStop))));
    expect(take.notes).toHaveLength(1);
    expect(take.notes[0]!.durationMs).toBe(500);
  });

  it('flushes a tie that never closes at part end', () => {
    const take = musicXmlToTake(scoreWith(measure(1, DIV1 + note('C', 4, 4, tieStart))));
    expect(take.notes).toHaveLength(1);
    expect(take.notes[0]!.durationMs).toBe(2000);
  });
});

describe('tempo and dynamics', () => {
  it('integrates a mid-piece tempo change into note onsets', () => {
    const take = musicXmlToTake(
      scoreWith(
        measure(
          1,
          DIV1 +
            '<direction><sound tempo="120"/></direction>' +
            note('C', 4, 1) +
            note('D', 4, 1) +
            '<direction><sound tempo="60"/></direction>' +
            note('E', 4, 1) +
            note('F', 4, 1),
        ),
      ),
    );
    expect(take.notes.map((n) => n.startMs)).toEqual([0, 500, 1000, 2000]);
    expect(take.tempo.bpm).toBe(120);
    // The change rides along so the notation can draw bar 1's new tempo.
    expect(take.tempo.changes).toEqual([{ atMs: 1000, bpm: 60 }]);
  });

  it('leaves a single-tempo score without a tempo map', () => {
    const take = musicXmlToTake(
      scoreWith(measure(1, DIV1 + '<sound tempo="90"/>' + note('C', 4, 1))),
    );
    expect(take.tempo.bpm).toBe(90);
    expect(take.tempo.changes).toBeUndefined();
  });

  it('reads sound tempo as a direct measure child', () => {
    const take = musicXmlToTake(
      scoreWith(measure(1, DIV1 + '<sound tempo="60"/>' + note('C', 4, 1))),
    );
    expect(take.notes[0]!.durationMs).toBe(1000);
    expect(take.tempo.bpm).toBe(60);
  });

  it('falls back to metronome marks when no sound tempo exists', () => {
    const metronome =
      '<direction><direction-type><metronome>' +
      '<beat-unit>half</beat-unit><per-minute>60</per-minute>' +
      '</metronome></direction-type></direction>';
    const take = musicXmlToTake(scoreWith(measure(1, DIV1 + metronome + note('C', 4, 1))));
    expect(take.tempo.bpm).toBe(120);
    expect(take.notes[0]!.durationMs).toBe(500);
  });

  it('applies note-level dynamics and the running sound dynamics', () => {
    const take = musicXmlToTake(
      scoreWith(
        measure(
          1,
          DIV1 +
            `<note dynamics="50"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>` +
            '<direction><sound dynamics="80"/></direction>' +
            note('D', 4, 1) +
            note('E', 4, 1),
        ),
      ),
    );
    expect(take.notes[0]!.velocity).toBeCloseTo(0.5 * DEFAULT_VELOCITY, 5);
    expect(take.notes[1]!.velocity).toBeCloseTo(0.8 * DEFAULT_VELOCITY, 5);
    expect(take.notes[2]!.velocity).toBeCloseTo(0.8 * DEFAULT_VELOCITY, 5);
  });

  it('applies a sounding direction offset to a tempo change', () => {
    // An explicit tempo at q0 keeps this independent of the first-mark back-fill.
    const tempo120 = '<direction><sound tempo="120"/></direction>';
    // Written at the q1 cursor, but its offset defers the change to q2.
    const tempo60 = '<direction><sound tempo="60"/><offset sound="yes">1</offset></direction>';
    const take = musicXmlToTake(
      scoreWith(
        measure(
          1,
          DIV1 +
            tempo120 +
            note('C', 4, 1) +
            tempo60 +
            note('D', 4, 1) +
            note('E', 4, 1) +
            note('F', 4, 1),
        ),
      ),
    );
    // Tempo 60 takes effect at q2, so q0–q2 stay at 120 BPM (500 ms each).
    expect(take.notes.map((n) => n.startMs)).toEqual([0, 500, 1000, 2000]);
  });

  it("lets a <sound>'s own offset override the direction offset", () => {
    const tempo120 = '<direction><sound tempo="120"/></direction>';
    // The direction offset says q3, but the sound's own offset (q2) wins.
    const tempo60 =
      '<direction><sound tempo="60"><offset sound="yes">1</offset></sound>' +
      '<offset sound="yes">2</offset></direction>';
    const take = musicXmlToTake(
      scoreWith(
        measure(
          1,
          DIV1 +
            tempo120 +
            note('C', 4, 1) +
            tempo60 +
            note('D', 4, 1) +
            note('E', 4, 1) +
            note('F', 4, 1),
        ),
      ),
    );
    // Tempo 60 takes effect at q2 (sound offset), so q0–q2 stay at 120 BPM.
    expect(take.notes.map((n) => n.startMs)).toEqual([0, 500, 1000, 2000]);
  });
});

describe('pedal, pitch spelling, and time signatures', () => {
  it('converts pedal directions into pedal events', () => {
    const pedal = (type: string) =>
      `<direction><direction-type><pedal type="${type}"/></direction-type></direction>`;
    const take = musicXmlToTake(
      scoreWith(
        measure(1, DIV1 + pedal('start') + note('C', 4, 1) + pedal('stop') + note('D', 4, 1)),
      ),
    );
    expect(take.pedalEvents).toEqual([
      { atMs: 0, down: true },
      { atMs: 500, down: false },
    ]);
  });

  it('defers a pedal event by a sounding direction offset', () => {
    const pedalStart =
      '<direction><direction-type><pedal type="start"/></direction-type>' +
      '<offset sound="yes">2</offset></direction>';
    const take = musicXmlToTake(scoreWith(measure(1, DIV1 + pedalStart + note('C', 4, 4))));
    // q2 at 120 BPM = 1000 ms, versus atMs 0 without the offset.
    expect(take.pedalEvents).toEqual([{ atMs: 1000, down: true }]);
  });

  it('ignores a display-only offset (sound not "yes")', () => {
    const pedalStart =
      '<direction><direction-type><pedal type="start"/></direction-type>' +
      '<offset>2</offset></direction>';
    const take = musicXmlToTake(scoreWith(measure(1, DIV1 + pedalStart + note('C', 4, 4))));
    expect(take.pedalEvents).toEqual([{ atMs: 0, down: true }]);
  });

  it('applies alter values including double accidentals', () => {
    const take = musicXmlToTake(
      scoreWith(
        measure(
          1,
          DIV1 +
            alteredNote('F', 4, 1, 1) +
            alteredNote('B', 3, -1, 1) +
            alteredNote('E', 4, -2, 1),
        ),
      ),
    );
    expect(take.notes.map((n) => n.midi)).toEqual([66, 58, 62]);
  });

  it('captures the first time signature and rejects odd denominators', () => {
    const waltz = scoreWith(
      measure(
        1,
        '<attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>' +
          note('C', 4, 1),
      ),
    );
    expect(musicXmlToTake(waltz).tempo.timeSignature).toEqual({ numerator: 3, denominator: 4 });

    const odd = scoreWith(
      measure(
        1,
        '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>6</beat-type></time></attributes>' +
          note('C', 4, 1),
      ),
    );
    expect(musicXmlToTake(odd).tempo.timeSignature).toEqual({ numerator: 4, denominator: 4 });
  });

  it('captures the key signature the score declares', () => {
    const eFlat = scoreWith(
      measure(
        1,
        '<attributes><divisions>1</divisions><key><fifths>-3</fifths></key>' +
          '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
          note('E', 4, 1),
      ),
    );
    expect(musicXmlToTake(eFlat).tempo.keySignature).toBe(-3);
  });

  it('leaves the key unset when the score never says, so the notes decide', () => {
    const plain = scoreWith(measure(1, DIV1 + note('C', 4, 1)));
    expect(musicXmlToTake(plain).tempo.keySignature).toBeUndefined();
  });

  it('ignores a key signature off the circle of fifths', () => {
    const absurd = scoreWith(
      measure(
        1,
        '<attributes><divisions>1</divisions><key><fifths>19</fifths></key></attributes>' +
          note('C', 4, 1),
      ),
    );
    expect(musicXmlToTake(absurd).tempo.keySignature).toBeUndefined();
  });
});

describe('the display grid an import arrives with', () => {
  /** `divisions` per quarter; 8 makes a 32nd one unit and a 64th a half. */
  const DIV8 =
    '<attributes><divisions>8</divisions>' +
    '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>';

  it('leaves an ordinary score on the 1/16 floor', () => {
    // Quarters and sixteenths only: 1/16 writes both, and a coarser grid is
    // never chosen, so takes engrave exactly as they did before short values.
    const take = musicXmlToTake(
      scoreWith(measure(1, DIV8 + note('C', 4, 8) + note('D', 4, 2) + note('E', 4, 2))),
    );
    expect(take.display.quantization).toBe('1/16');
  });

  it('goes to 1/32 for a score that contains 32nds', () => {
    const take = musicXmlToTake(
      scoreWith(measure(1, DIV8 + note('C', 4, 8) + note('D', 4, 1) + note('E', 4, 1))),
    );
    expect(take.display.quantization).toBe('1/32');
  });

  it('goes to 1/64 for a score that contains 64ths', () => {
    const take = musicXmlToTake(
      scoreWith(
        measure(
          1,
          '<attributes><divisions>16</divisions></attributes>' +
            note('C', 4, 16) +
            note('D', 4, 1) +
            note('E', 4, 1),
        ),
      ),
    );
    expect(take.display.quantization).toBe('1/64');
  });

  it('counts a rest as much as a note', () => {
    // The grid has to be fine enough to write the silences too, or a 32nd of
    // rest is rounded away and the bar stops adding up.
    const take = musicXmlToTake(scoreWith(measure(1, DIV8 + note('C', 4, 8) + rest(1))));
    expect(take.display.quantization).toBe('1/32');
  });

  it('re-imports through parseTakeJson without repairs on the finer grids', () => {
    const take = musicXmlToTake(
      scoreWith(measure(1, DIV8 + note('C', 4, 8) + note('D', 4, 1) + note('E', 4, 1))),
    );
    expect(parseTakeJson(take).repairs).toEqual([]);
  });

  it('gives a dotted value the grid that can state it, not the nearest one', () => {
    // A dot is half again, so a dotted value is one and a half grid steps of its
    // own base — and a length rounds to a *whole* number of steps. So the base's
    // own grid rounds it up: a dotted sixteenth on 1/16 becomes an eighth, and a
    // dotted 32nd on 1/32 becomes a sixteenth. Each needs one level finer.
    // divisions=16 per quarter: a sixteenth is 4, a dotted sixteenth 6, a 32nd 2,
    // a dotted 32nd 3.
    const DIV16 = '<attributes><divisions>16</divisions></attributes>';
    const dottedSixteenth = musicXmlToTake(
      scoreWith(measure(1, DIV16 + note('C', 4, 16) + note('D', 4, 6) + note('E', 4, 6))),
    );
    expect(dottedSixteenth.display.quantization).toBe('1/32');

    const dotted32nd = musicXmlToTake(
      scoreWith(measure(1, DIV16 + note('C', 4, 16) + note('D', 4, 3) + note('E', 4, 3))),
    );
    expect(dotted32nd.display.quantization).toBe('1/64');
  });

  it('gives a dotted 64th the finest grid there is', () => {
    // Nothing on offer states it — it would take a 1/128 grid — so it is written
    // as a 32nd either way. 1/64 is still right: the grid places onsets too, and
    // a figure this short puts them on 64ths that a coarser grid would move.
    // divisions=32 per quarter: a 64th is 2, a dotted 64th 3.
    const take = musicXmlToTake(
      scoreWith(
        measure(
          1,
          '<attributes><divisions>32</divisions></attributes>' +
            note('C', 4, 32) +
            note('D', 4, 3) +
            note('E', 4, 3),
        ),
      ),
    );
    expect(take.display.quantization).toBe('1/64');
  });

  it('reads a tuplet score as the nearest grid, since none states a third', () => {
    // divisions=6 per quarter: a triplet eighth is 2 units, a triplet sixteenth
    // 1. No binary grid divides either, so the nearest one wins — which is what
    // the tuplet machinery expects, and what these scores got before.
    const DIV6 = '<attributes><divisions>6</divisions></attributes>';
    const tripletEighths = musicXmlToTake(
      scoreWith(measure(1, DIV6 + note('C', 4, 2) + note('D', 4, 2) + note('E', 4, 2))),
    );
    expect(tripletEighths.display.quantization).toBe('1/16');

    const tripletSixteenths = musicXmlToTake(
      scoreWith(measure(1, DIV6 + note('C', 4, 6) + note('D', 4, 1) + note('E', 4, 1))),
    );
    expect(tripletSixteenths.display.quantization).toBe('1/32');
  });
});

describe('rejections', () => {
  it('rejects score-timewise documents', () => {
    expect(() => musicXmlToTake('<score-timewise version="3.1"></score-timewise>')).toThrow(
      ScoreImportError,
    );
  });

  it('rejects malformed XML', () => {
    expect(() => musicXmlToTake('<score-partwise><part')).toThrow(ScoreImportError);
  });

  it('rejects non-MusicXML documents', () => {
    expect(() => musicXmlToTake('<html><body>nope</body></html>')).toThrow(ScoreImportError);
  });

  it('rejects scores with no playable notes', () => {
    expect(() => musicXmlToTake(scoreWith(measure(1, DIV1 + rest(4))))).toThrow(ScoreImportError);
  });
});
