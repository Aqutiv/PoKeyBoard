export const WURLITZER_REVISION: string;
export function readFlacMetadata(bytes: Buffer): {
  sampleRate: number;
  channels: number;
  bits: number;
  totalSamples: number;
  loop: { start: number; end: number };
};
export function parseWurlitzerRegions(sfz: string): {
  regions: Array<{
    file: string;
    lowKey: number;
    highKey: number;
    root: number;
    lowVelocity: number;
    highVelocity: number;
    layer: number;
    tune: number;
    gain: number;
  }>;
  velocityLayers: Array<{ index: number; sourceLayer: number; label: string }>;
};
export function buildWurlitzer(): Promise<void>;
