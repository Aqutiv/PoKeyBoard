/**
 * How the vendored classics are named in the Library.
 *
 * Hand-curated: upstream files are named after MuseScore uploads, so their
 * embedded titles are inconsistent, sometimes mojibake, and occasionally
 * misattributed. Seeded once from each score's own metadata and edited since;
 * the generator never overwrites this file.
 *
 * Where the pack ships the same work more than once, the qualifier says what
 * actually differs (note count and duration, per classicsManifest.ts) rather
 * than numbering them. "(score edition)" marks the three that also exist as
 * hand-authored tracks in this library.
 *
 * Keyed by the trackId in classicsManifest.ts — a manifest entry with no name
 * here is a test failure, not a silent fallback.
 */
export interface ClassicScoreName {
  title: string;
  composer: string;
}

export const CLASSIC_SCORE_NAMES: Record<string, ClassicScoreName> = {
  'score-12-variations-of-twinkle-twinkle-little-star': {
    title: 'Twelve Variations on “Twinkle, Twinkle, Little Star”, K. 265',
    composer: 'Wolfgang Amadeus Mozart',
  },
  'score-arabesque-l-66-no-1-in-e-major': {
    title: 'Arabesque No. 1',
    composer: 'Claude Debussy',
  },
  'score-ave-maria-d839-schubert-solo-piano-arrg': {
    title: 'Ave Maria, D. 839',
    composer: 'Franz Schubert',
  },
  'score-bach-minuet-in-g-major-bwv-anh-114': {
    // Long credited to Bach; the Notebook for Anna Magdalena piece is Petzold's.
    title: 'Minuet in G major, BWV Anh. 114',
    composer: 'Christian Petzold',
  },
  'score-minuet-in-g-major-bach': {
    title: 'Minuet in G major, BWV Anh. 114 (alternate edition)',
    composer: 'Christian Petzold',
  },
  'score-bach-toccata-and-fugue-in-d-minor-piano-solo': {
    title: 'Toccata and Fugue in D minor, BWV 565',
    composer: 'Johann Sebastian Bach',
  },
  'score-j-s-bach-air-on-the-g-string-piano-arrangement': {
    title: 'Air on the G String',
    composer: 'Johann Sebastian Bach',
  },
  'score-prelude-i-in-c-major-bwv-846-well-tempered-clavier-first-book': {
    title: 'Prelude in C major, BWV 846',
    composer: 'Johann Sebastian Bach',
  },
  'score-prelude-no-2-bwv-847-in-c-minor': {
    title: 'Prelude in C minor, BWV 847',
    composer: 'Johann Sebastian Bach',
  },
  'score-beethoven-symphony-no-5-1st-movement-piano-solo': {
    title: 'Symphony No. 5 — first movement',
    composer: 'Ludwig van Beethoven',
  },
  'score-danse-villageoise-beethoven': {
    title: 'Danse villageoise',
    composer: 'Ludwig van Beethoven',
  },
  'score-fur-elise': {
    title: 'Für Elise (complete)',
    composer: 'Ludwig van Beethoven',
  },
  'score-fur-elise-fingered': {
    title: 'Für Elise (fingered)',
    composer: 'Ludwig van Beethoven',
  },
  'score-fur-elise-beethoven-for-beginner-piano': {
    title: 'Für Elise (beginner)',
    composer: 'Ludwig van Beethoven',
  },
  'score-fur-elise-easy-piano': {
    title: 'Für Elise (easy)',
    composer: 'Ludwig van Beethoven',
  },
  'score-ode-to-joy-easy-variation': {
    title: 'Ode to Joy (easy)',
    composer: 'Ludwig van Beethoven',
  },
  'score-sonate-no-14-moonlight-1st-movement': {
    title: 'Moonlight Sonata — first movement (score edition)',
    composer: 'Ludwig van Beethoven',
  },
  'score-sonate-no-14-moonlight-3rd-movement': {
    title: 'Moonlight Sonata — third movement',
    composer: 'Ludwig van Beethoven',
  },
  'score-moonlight-sonata-3rd-movement': {
    title: 'Moonlight Sonata — third movement (alternate edition)',
    composer: 'Ludwig van Beethoven',
  },
  'score-sonate-no-8-pathetique-2nd-movement': {
    title: 'Pathétique Sonata — second movement',
    composer: 'Ludwig van Beethoven',
  },
  'score-bella-ciao': {
    title: 'Bella ciao',
    composer: 'Traditional',
  },
  'score-canon-in-d': {
    title: 'Canon in D',
    composer: 'Johann Pachelbel',
  },
  'score-canon-in-d-3': {
    title: 'Canon in D (shorter setting)',
    composer: 'Johann Pachelbel',
  },
  'score-canon-in-d-easy': {
    title: 'Canon in D (easy)',
    composer: 'Johann Pachelbel',
  },
  'score-carol-of-the-bells': {
    title: 'Carol of the Bells',
    composer: 'Mykola Leontovych',
  },
  'score-carol-of-the-bells-easy-piano': {
    title: 'Carol of the Bells (easy)',
    composer: 'Mykola Leontovych',
  },
  'score-chopin-ballade-no-1-in-g-minor-op-23': {
    title: 'Ballade No. 1 in G minor, Op. 23',
    composer: 'Frédéric Chopin',
  },
  'score-chopin-nocturne-op-9-no-1': {
    title: 'Nocturne in B♭ minor, Op. 9 No. 1',
    composer: 'Frédéric Chopin',
  },
  'score-chopin-nocturne-op-9-no-2-e-flat-major': {
    title: 'Nocturne in E♭ major, Op. 9 No. 2',
    composer: 'Frédéric Chopin',
  },
  'score-nocturne-in-e-flat-major-op-9-no-2-easy': {
    title: 'Nocturne in E♭ major, Op. 9 No. 2 (easy)',
    composer: 'Frédéric Chopin',
  },
  'score-nocturne-no-20-in-c-minor': {
    title: 'Nocturne No. 20',
    composer: 'Frédéric Chopin',
  },
  'score-nocturne-in-c-sharp-minor': {
    title: 'Nocturne in C♯ minor',
    composer: 'Frédéric Chopin',
  },
  'score-prlude-no-4-in-e-minor-op-28-frdric-chopin': {
    title: 'Prélude in E minor, Op. 28 No. 4',
    composer: 'Frédéric Chopin',
  },
  'score-prlude-opus-28-no-4-in-e-minor-chopin': {
    title: 'Prélude in E minor, Op. 28 No. 4 (slower edition)',
    composer: 'Frédéric Chopin',
  },
  'score-waltz-opus-64-no-2-in-c-minor': {
    title: 'Waltz, Op. 64 No. 2',
    composer: 'Frédéric Chopin',
  },
  'score-waltz-in-a-minorchopin': {
    title: 'Waltz in A minor, B. 150',
    composer: 'Frédéric Chopin',
  },
  'score-clair-de-lune-debussy': {
    title: 'Clair de lune',
    composer: 'Claude Debussy',
  },
  'score-clair-de-lune-claude-debussy': {
    title: 'Clair de lune (alternate edition)',
    composer: 'Claude Debussy',
  },
  'score-erik-satie-gymnopedie-no-1': {
    title: 'Gymnopédie No. 1 (short setting)',
    composer: 'Erik Satie',
  },
  'score-gymnopdie-no-1-satie': {
    title: 'Gymnopédie No. 1 (score edition)',
    composer: 'Erik Satie',
  },
  'score-gnossienne-no-1': {
    title: 'Gnossienne No. 1',
    composer: 'Erik Satie',
  },
  'score-flight-of-the-bumblebee': {
    title: 'Flight of the Bumblebee',
    composer: 'Nikolai Rimsky-Korsakov',
  },
  'score-greensleeves-for-piano-easy-and-beautiful': {
    title: 'Greensleeves',
    composer: 'Traditional',
  },
  'score-happy-birthday-to-you-piano': {
    title: 'Happy Birthday to You',
    composer: 'Traditional',
  },
  'score-happy-birthday-to-you-c-major': {
    title: 'Happy Birthday to You (C major)',
    composer: 'Traditional',
  },
  'score-hungarian-dance-no-5-in-g-minor': {
    title: 'Hungarian Dance No. 5',
    composer: 'Johannes Brahms',
  },
  'score-la-campanella-grandes-etudes-de-paganini-no-3-franz-liszt': {
    title: 'La campanella',
    composer: 'Franz Liszt',
  },
  'score-liebestraum-no-3-in-a-major': {
    title: 'Liebesträume No. 3',
    composer: 'Franz Liszt',
  },
  'score-schubert-serenade-standchen-by-lizst': {
    // The arranger belongs in the title: as a composer string it would strand
    // the piece in a group of one and sort the list under "Liszt".
    title: 'Ständchen (Serenade), arr. Liszt',
    composer: 'Franz Schubert',
  },
  'score-lacrimosa-requiem': {
    title: 'Lacrimosa, from the Requiem',
    composer: 'Wolfgang Amadeus Mozart',
  },
  'score-mozart-piano-sonata-no-16-allegro': {
    title: 'Piano Sonata No. 16, K. 545 — Allegro',
    composer: 'Wolfgang Amadeus Mozart',
  },
  'score-sonata-no-16-1st-movement-k-545': {
    title: 'Piano Sonata No. 16, K. 545 — Allegro (alternate edition)',
    composer: 'Wolfgang Amadeus Mozart',
  },
  'score-piano-sonata-no-11-k-331-3rd-movement-rondo-alla-turca': {
    title: 'Rondo alla turca',
    composer: 'Wolfgang Amadeus Mozart',
  },
  'score-wa-mozart-marche-turque-turkish-march-fingered': {
    title: 'Rondo alla turca (fingered)',
    composer: 'Wolfgang Amadeus Mozart',
  },
  'score-maple-leaf-rag-scott-joplin': {
    title: 'Maple Leaf Rag',
    composer: 'Scott Joplin',
  },
  'score-the-entertainer-scott-joplin': {
    title: 'The Entertainer',
    composer: 'Scott Joplin',
  },
  'score-the-entertainer-scott-joplin-1902': {
    title: 'The Entertainer (1902 edition)',
    composer: 'Scott Joplin',
  },
  'score-dance-of-the-sugar-plum-fairy': {
    title: 'Dance of the Sugar Plum Fairy',
    composer: 'Pyotr Ilyich Tchaikovsky',
  },
  'score-waltz-of-the-flowers': {
    title: 'Waltz of the Flowers',
    composer: 'Pyotr Ilyich Tchaikovsky',
  },
  'score-swan-lake': {
    title: 'Swan Lake (theme)',
    composer: 'Pyotr Ilyich Tchaikovsky',
  },
};
