import type { SamplePackVelocityLayer } from './audioTypes';

/**
 * A grand's velocity layers: which recording a note's velocity asks for.
 *
 * A grand pack holds a few recordings of every root, each made at its own
 * strength. The manifest names each layer by what it is — `pianissimo`,
 * `soft`, `medium`, `loud` — and numbers them from its softest, 0 up. A pack
 * need not have every kind: the three-layer packs start at `soft`, which then
 * plays everything under `medium`, as the softest layer always does.
 *
 * Only a grand's layers are these. A pack mapped by regions (the Wurlitzer)
 * picks its recordings by its own velocity ranges and names them its own way.
 */
export const LAYER_LABELS = ['pianissimo', 'soft', 'medium', 'loud'] as const;

export type LayerLabel = (typeof LAYER_LABELS)[number];

/**
 * The velocity each kind of layer takes over at, when a softer layer lies
 * under it. Each band ends a little above where its own recording naturally
 * sounds on the velocity curve (velocityCurve.ts), so a layer plays from its
 * own level downwards: Salamander's soft recording sits at a median of 0.42
 * across the keyboard and its band ends at 0.45, the medium one at 0.75 and
 * 0.78, and a pianissimo recording (Salamander's v2 at 0.25, the Steinway's v5
 * at 0.28) takes the band up to 0.30.
 */
const LAYER_FLOOR: Readonly<Record<LayerLabel, number>> = {
  pianissimo: 0,
  soft: 0.3,
  medium: 0.45,
  loud: 0.78,
};

function isLayerLabel(label: string): label is LayerLabel {
  return (LAYER_LABELS as readonly string[]).includes(label);
}

/**
 * A grand manifest's layers, by index: each one's label, checked. Throws
 * unless the indices run 0, 1, 2… and the labels are known ones, softest
 * first, each at most once, with a medium layer among them (every note's
 * level follows its balance; see velocityCalibrationMath.ts) — a pack labelled
 * any other way would play its recordings on the wrong velocities, and is
 * better refused outright.
 */
export function layerLabels(
  layers: readonly Pick<SamplePackVelocityLayer, 'index' | 'label'>[],
): LayerLabel[] {
  const sorted = [...layers].sort((a, b) => a.index - b.index);
  const labels: LayerLabel[] = [];
  for (const [position, { index, label }] of sorted.entries()) {
    if (index !== position) {
      throw new Error(`Velocity layers must be numbered from 0 without gaps; found ${index}.`);
    }
    if (!isLayerLabel(label)) throw new Error(`Unknown velocity layer "${label}".`);
    const previous = labels.at(-1);
    if (previous && LAYER_LABELS.indexOf(label) <= LAYER_LABELS.indexOf(previous)) {
      throw new Error(
        `Velocity layers must go from softest to loudest; "${label}" follows "${previous}".`,
      );
    }
    labels.push(label);
  }
  if (!labels.includes('medium')) throw new Error('A grand pack needs a medium velocity layer.');
  return labels;
}

/**
 * Where each layer above a pack's softest takes over, in velocity: [0.45,
 * 0.78] for soft, medium and loud; [0.3, 0.45, 0.78] with a pianissimo layer
 * under them.
 */
export function velocityThresholds(labels: readonly LayerLabel[]): number[] {
  return labels.slice(1).map((label) => LAYER_FLOOR[label]);
}

/** The layer a note struck at `velocity` asks for, given its pack's thresholds. */
export function velocityToLayer(velocity: number, thresholds: readonly number[]): number {
  let layer = 0;
  while (layer < thresholds.length && velocity >= (thresholds[layer] as number)) layer += 1;
  return layer;
}

/**
 * The order a note looks through a pack's layers for a recording, while some
 * are not decoded yet: the one it asks for, then the nearest, the softer of
 * two as near — for three layers [0, 1, 2], [1, 0, 2] and [2, 1, 0], as the
 * sample bank always has.
 */
export function layerSearchOrder(preferred: number, count: number): number[] {
  return Array.from({ length: count }, (_, layer) => layer).sort(
    (a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b,
  );
}

/**
 * The index of a pack's medium layer: the one whose balance across the
 * keyboard every note's level follows, and the one a note at the computer
 * keyboard's velocity plays.
 */
export function mediumLayer(labels: readonly LayerLabel[]): number {
  const index = labels.indexOf('medium');
  if (index < 0) throw new Error('A grand pack needs a medium velocity layer.');
  return index;
}

/**
 * The layer every calibration table takes for its medium one when it names
 * none: layer 1, where a pack of soft, medium and loud has it. A table for a
 * pack with its medium layer anywhere else says so (`tiltLayer`).
 */
export const DEFAULT_MEDIUM_LAYER = 1;

/**
 * The per-layer trims a pack with no velocity calibration plays by: the
 * velocity each layer's recording stands for, and how far its level is lifted
 * or lowered. Every grand pack the app ships is calibrated; these are what
 * the calibration's anchor keeps the loudness of (see
 * velocityCalibrationMath.ts), and a pack plays by them only until its table
 * is generated. A pianissimo layer borrows the soft layer's.
 */
const UNCALIBRATED_LAYER: Readonly<Record<LayerLabel, { velocity: number; trim: number }>> = {
  pianissimo: { velocity: 0.3, trim: 1.35 },
  soft: { velocity: 0.3, trim: 1.35 },
  medium: { velocity: 0.6, trim: 1.1 },
  loud: { velocity: 0.9, trim: 0.95 },
};

/**
 * Per-voice gain for a pack with no velocity calibration: the layer's static
 * trim scaled by how far the played velocity sits from the layer's reference.
 * One trim per layer cannot match recordings that differ note by note, so this
 * steps in level where the layers meet, by up to 6.6 dB on the grands; a pack
 * with a calibration (velocityCalibration.ts) plays by that instead.
 */
export function velocityGain(velocity: number, label: LayerLabel): number {
  const clamped = Math.min(1, Math.max(0.02, velocity));
  const { velocity: reference, trim } = UNCALIBRATED_LAYER[label];
  const gain = trim * Math.pow(clamped / reference, 0.6);
  return Math.min(1.7, Math.max(0.25, gain));
}
