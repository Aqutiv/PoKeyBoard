/*! @license
 * Copyright © 2026, Steinberg Media Technologies GmbH (http://www.steinberg.net/),
 * with Reserved Font Name "Bravura".
 *
 * This subset is a Modified Version of the font and is not named Bravura.
 *
 * This Font Software is licensed under the SIL Open Font License, Version 1.1.
 * This license is copied below, and is also available with a FAQ at:
 * http://scripts.sil.org/OFL
 *
 * -----------------------------------------------------------
 * SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
 * -----------------------------------------------------------
 *
 * PREAMBLE
 * The goals of the Open Font License (OFL) are to stimulate worldwide
 * development of collaborative font projects, to support the font creation
 * efforts of academic and linguistic communities, and to provide a free and
 * open framework in which fonts may be shared and improved in partnership
 * with others.
 *
 * The OFL allows the licensed fonts to be used, studied, modified and
 * redistributed freely as long as they are not sold by themselves. The
 * fonts, including any derivative works, can be bundled, embedded,
 * redistributed and/or sold with any software provided that any reserved
 * names are not used by derivative works. The fonts and derivatives,
 * however, cannot be released under any other type of license. The
 * requirement for fonts to remain under this license does not apply
 * to any document created using the fonts or their derivatives.
 *
 * DEFINITIONS
 * "Font Software" refers to the set of files released by the Copyright
 * Holder(s) under this license and clearly marked as such. This may
 * include source files, build scripts and documentation.
 *
 * "Reserved Font Name" refers to any names specified as such after the
 * copyright statement(s).
 *
 * "Original Version" refers to the collection of Font Software components as
 * distributed by the Copyright Holder(s).
 *
 * "Modified Version" refers to any derivative made by adding to, deleting,
 * or substituting -- in part or in whole -- any of the components of the
 * Original Version, by changing formats or by porting the Font Software to a
 * new environment.
 *
 * "Author" refers to any designer, engineer, programmer, technical
 * writer or other person who contributed to the Font Software.
 *
 * PERMISSION AND CONDITIONS
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of the Font Software, to use, study, copy, merge, embed, modify,
 * redistribute, and sell modified and unmodified copies of the Font
 * Software, subject to the following conditions:
 *
 * 1) Neither the Font Software nor any of its individual components,
 * in Original or Modified Versions, may be sold by itself.
 *
 * 2) Original or Modified Versions of the Font Software may be bundled,
 * redistributed and/or sold with any software, provided that each copy
 * contains the above copyright notice and this license. These can be
 * included either as stand-alone text files, human-readable headers or
 * in the appropriate machine-readable metadata fields within text or
 * binary files as long as those fields can be easily viewed by the user.
 *
 * 3) No Modified Version of the Font Software may use the Reserved Font
 * Name(s) unless explicit written permission is granted by the corresponding
 * Copyright Holder. This restriction only applies to the primary font name as
 * presented to the users.
 *
 * 4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
 * Software shall not be used to promote, endorse or advertise any
 * Modified Version, except to acknowledge the contribution(s) of the
 * Copyright Holder(s) and the Author(s) or with their explicit written
 * permission.
 *
 * 5) The Font Software, modified or unmodified, in part or in whole,
 * must be distributed entirely under this license, and must not be
 * distributed under any other license. The requirement for fonts to
 * remain under this license does not apply to any document created
 * using the Font Software.
 *
 * TERMINATION
 * This license becomes null and void if any of the above conditions are
 * not met.
 *
 * DISCLAIMER
 * THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
 * OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
 * COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
 * DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
 * OTHER DEALINGS IN THE FONT SOFTWARE.
 */

/**
 * How big the printed sheet's music symbols are and where they attach: each
 * glyph's advance and bounding box, the anchors the page places stems, flags
 * and dynamics by, and the engraving defaults of the font they come from. All
 * in staff spaces, y up, measured from the glyph's SMuFL origin — the point a
 * glyph is drawn at (`drawGlyph`). The outlines are musicGlyphOutlines.ts, kept
 * apart so layout code can read these without loading them.
 *
 * GENERATED — do not edit. Read from the font metadata by
 * scripts/extract-music-glyphs.mjs, from Bravura 1.482 (tag bravura-1.482,
 * commit 37b194378b710cc40e406ab6c4b07608bb9548ae) and the glyph names of
 * SMuFL 1.4, each source pinned in scripts/lib/music-glyphs.pins.json.
 * Regenerate with:
 *
 *   node scripts/extract-music-glyphs.mjs
 */

/** Every glyph the sheet draws, by its SMuFL name. */
export const MUSIC_GLYPH_NAMES = [
  'gClef',
  'fClef',
  'gClefChange',
  'fClefChange',
  'brace',
  'noteheadBlack',
  'noteheadHalf',
  'noteheadWhole',
  'augmentationDot',
  'flag8thUp',
  'flag8thDown',
  'flag16thUp',
  'flag16thDown',
  'flag32ndUp',
  'flag32ndDown',
  'flag64thUp',
  'flag64thDown',
  'accidentalFlat',
  'accidentalNatural',
  'accidentalSharp',
  'accidentalDoubleSharp',
  'accidentalDoubleFlat',
  'restWhole',
  'restHalf',
  'restQuarter',
  'rest8th',
  'rest16th',
  'rest32nd',
  'rest64th',
  'timeSig0',
  'timeSig1',
  'timeSig2',
  'timeSig3',
  'timeSig4',
  'timeSig5',
  'timeSig6',
  'timeSig7',
  'timeSig8',
  'timeSig9',
  'tuplet0',
  'tuplet1',
  'tuplet2',
  'tuplet3',
  'tuplet4',
  'tuplet5',
  'tuplet6',
  'tuplet7',
  'tuplet8',
  'tuplet9',
  'dynamicPiano',
  'dynamicForte',
  'dynamicPPP',
  'dynamicPP',
  'dynamicMP',
  'dynamicMF',
  'dynamicFF',
  'dynamicFFF',
  'ottavaAlta',
  'ottavaBassaVb',
  'metNoteQuarterUp',
] as const;

export type MusicGlyphName = (typeof MUSIC_GLYPH_NAMES)[number];

/** Font units to a staff space: a SMuFL font's em is four of them. */
export const GLYPH_UNITS_PER_SPACE = 250;

export interface MusicGlyphMetrics {
  /** How far the glyph advances, in staff spaces. */
  advance: number;
  /** Its bounding box, `[left, bottom, right, top]` in staff spaces, y up. */
  bbox: readonly [number, number, number, number];
}

export const MUSIC_GLYPH_METRICS: Readonly<Record<MusicGlyphName, MusicGlyphMetrics>> = {
  gClef: { advance: 2.684, bbox: [0, -2.632, 2.684, 4.392] },
  fClef: { advance: 2.736, bbox: [-0.02, -2.54, 2.736, 1.048] },
  gClefChange: { advance: 1.76, bbox: [0, -1.82, 1.76, 2.828] },
  fClefChange: { advance: 1.848, bbox: [-0.06, -1.656, 1.852, 0.68] },
  brace: { advance: 0.28, bbox: [0, -0.002531, 0.277415, 4.00244] },
  noteheadBlack: { advance: 1.18, bbox: [0, -0.5, 1.18, 0.5] },
  noteheadHalf: { advance: 1.18, bbox: [0, -0.5, 1.18, 0.5] },
  noteheadWhole: { advance: 1.688, bbox: [0, -0.5, 1.688, 0.5] },
  augmentationDot: { advance: 0.4, bbox: [0, -0.2, 0.4, 0.2] },
  flag8thUp: { advance: 1.056, bbox: [0, -3.24, 1.056, 0.036] },
  flag8thDown: { advance: 1.224, bbox: [0, -0.056, 1.224, 3.232] },
  flag16thUp: { advance: 1.116, bbox: [0, -3.252, 1.116, 0.008] },
  flag16thDown: { advance: 1.168, bbox: [0, -0.036, 1.164, 3.248026] },
  flag32ndUp: { advance: 1.048, bbox: [0, -3.248, 1.044, 0.596] },
  flag32ndDown: { advance: 1.096, bbox: [0, -0.688, 1.092, 3.248] },
  flag64thUp: { advance: 1.048, bbox: [0, -3.248, 1.044, 1.388] },
  flag64thDown: { advance: 1.1, bbox: [0, -1.504, 1.092, 3.248] },
  accidentalFlat: { advance: 0.904, bbox: [0, -0.7, 0.904, 1.756] },
  accidentalNatural: { advance: 0.672, bbox: [0, -1.34, 0.672, 1.364] },
  accidentalSharp: { advance: 0.996, bbox: [0, -1.392, 0.996, 1.4] },
  accidentalDoubleSharp: { advance: 1, bbox: [0, -0.5, 0.988, 0.508] },
  accidentalDoubleFlat: { advance: 1.652, bbox: [0, -0.7, 1.644, 1.748] },
  restWhole: { advance: 1.132, bbox: [0, -0.54, 1.128, 0.036] },
  restHalf: { advance: 1.132, bbox: [0, -0.008, 1.128, 0.568] },
  restQuarter: { advance: 1.08, bbox: [0.004, -1.5, 1.08, 1.492] },
  rest8th: { advance: 1, bbox: [0, -1.004, 0.988, 0.696] },
  rest16th: { advance: 1.28, bbox: [0, -2, 1.28, 0.716] },
  rest32nd: { advance: 1.452, bbox: [0, -2, 1.452, 1.704] },
  rest64th: { advance: 1.696, bbox: [0, -3.012, 1.692, 1.72] },
  timeSig0: { advance: 1.88, bbox: [0.08, -1, 1.8, 1.004] },
  timeSig1: { advance: 1.336, bbox: [0.08, -1, 1.256, 1.004] },
  timeSig2: { advance: 1.784, bbox: [0.08, -1.028, 1.704, 1.016] },
  timeSig3: { advance: 1.684, bbox: [0.08, -1.004, 1.604, 0.996] },
  timeSig4: { advance: 1.88, bbox: [0.08, -1, 1.8, 1.004] },
  timeSig5: { advance: 1.612, bbox: [0.08, -1.004, 1.532, 0.984] },
  timeSig6: { advance: 1.736, bbox: [0.08, -0.996, 1.656, 1.004] },
  timeSig7: { advance: 1.764, bbox: [0.08, -1, 1.684, 0.996] },
  timeSig8: { advance: 1.744, bbox: [0.08, -1.036, 1.664, 1.036] },
  timeSig9: { advance: 1.736, bbox: [0.08, -0.996, 1.656, 1.004] },
  tuplet0: { advance: 1.276, bbox: [0, -0.032, 1.272, 1.5] },
  tuplet1: { advance: 0.984, bbox: [0.04, 0, 1.024, 1.488] },
  tuplet2: { advance: 1.276, bbox: [0.04, -0.024, 1.316, 1.5] },
  tuplet3: { advance: 1.184, bbox: [0.04, -0.032, 1.224, 1.5] },
  tuplet4: { advance: 1.212, bbox: [0.04, 0, 1.252, 1.488] },
  tuplet5: { advance: 1.268, bbox: [0.04, -0.032, 1.308, 1.492] },
  tuplet6: { advance: 1.216, bbox: [0.04, -0.032, 1.256, 1.5] },
  tuplet7: { advance: 1.212, bbox: [0.12, -0.016, 1.332, 1.488] },
  tuplet8: { advance: 1.252, bbox: [0.04, -0.032, 1.292, 1.5] },
  tuplet9: { advance: 1.216, bbox: [0.04, -0.032, 1.256, 1.5] },
  dynamicPiano: { advance: 1.46, bbox: [-0.356, -0.568, 1.464, 1.096] },
  dynamicForte: { advance: 1.456, bbox: [-0.564, -0.608, 1.456, 1.776] },
  dynamicPPP: { advance: 4.288, bbox: [-0.368, -0.568, 4.292, 1.096] },
  dynamicPP: { advance: 2.908, bbox: [-0.328, -0.568, 2.912, 1.096] },
  dynamicMP: { advance: 3.304, bbox: [-0.08, -0.568, 3.3, 1.096] },
  dynamicMF: { advance: 3.188, bbox: [-0.08, -0.66, 3.272, 1.724] },
  dynamicFF: { advance: 2.436, bbox: [-0.54, -0.608, 2.44, 1.776] },
  dynamicFFF: { advance: 3.324, bbox: [-0.62, -0.608, 3.32, 1.776] },
  ottavaAlta: { advance: 3.54, bbox: [0, -0.04, 3.54, 1.852] },
  ottavaBassaVb: { advance: 3.184, bbox: [0, -0.04, 3.184, 1.852] },
  metNoteQuarterUp: { advance: 1.328, bbox: [0, -0.564, 1.328, 2.752] },
};

/**
 * The anchors the sheet places by, as SMuFL defines them, in staff spaces from
 * the glyph's origin: where a stem meets a notehead (`stemUpSE`,
 * `stemDownNW`), how far a stem is lengthened to meet its flag (`stemUpNW`,
 * `stemDownSW`), and a dynamic's optical centre.
 */
export const MUSIC_GLYPH_ANCHORS = {
  noteheadBlack: { stemUpSE: [1.18, 0.168], stemDownNW: [0, -0.168] },
  noteheadHalf: { stemUpSE: [1.18, 0.168], stemDownNW: [0, -0.168] },
  flag8thUp: { stemUpNW: [0, -0.04] },
  flag8thDown: { stemDownSW: [0, 0.132] },
  flag16thUp: { stemUpNW: [0, -0.088] },
  flag16thDown: { stemDownSW: [0, 0.128] },
  flag32ndUp: { stemUpNW: [0, 0.376] },
  flag32ndDown: { stemDownSW: [0, -0.448] },
  flag64thUp: { stemUpNW: [0, 1.172] },
  flag64thDown: { stemDownSW: [0, -1.244] },
  dynamicPiano: { opticalCenter: [1.22, 0] },
  dynamicForte: { opticalCenter: [1.256, 0] },
  dynamicPPP: { opticalCenter: [2.368, 0] },
  dynamicPP: { opticalCenter: [1.708, 0] },
  dynamicMP: { opticalCenter: [1.848, 0] },
  dynamicMF: { opticalCenter: [1.796, 0] },
  dynamicFF: { opticalCenter: [1.852, 0] },
  dynamicFFF: { opticalCenter: [2.472, 0] },
} as const satisfies Partial<Record<MusicGlyphName, Record<string, readonly [number, number]>>>;

/** The font's engraving defaults — line thicknesses and the like — in staff spaces. */
export const ENGRAVING_DEFAULTS = {
  arrowShaftThickness: 0.16,
  barlineSeparation: 0.4,
  beamSpacing: 0.25,
  beamThickness: 0.5,
  bracketThickness: 0.5,
  dashedBarlineDashLength: 0.5,
  dashedBarlineGapLength: 0.25,
  dashedBarlineThickness: 0.16,
  hBarThickness: 1,
  hairpinThickness: 0.16,
  legerLineExtension: 0.4,
  legerLineThickness: 0.16,
  lyricLineThickness: 0.16,
  octaveLineThickness: 0.16,
  pedalLineThickness: 0.16,
  repeatBarlineDotSeparation: 0.16,
  repeatEndingLineThickness: 0.16,
  slurEndpointThickness: 0.1,
  slurMidpointThickness: 0.22,
  staffLineThickness: 0.13,
  stemThickness: 0.12,
  subBracketThickness: 0.16,
  textEnclosureThickness: 0.16,
  thickBarlineThickness: 0.5,
  thinBarlineThickness: 0.16,
  thinThickBarlineSeparation: 0.4,
  tieEndpointThickness: 0.1,
  tieMidpointThickness: 0.22,
  tupletBracketThickness: 0.16,
} as const;
