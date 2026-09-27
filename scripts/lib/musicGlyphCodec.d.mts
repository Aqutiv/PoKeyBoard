export type OutlineCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

export function encodeOutline(commands: readonly OutlineCommand[]): string;
export function decodeOutline(text: string): OutlineCommand[];
export function controlBox(commands: readonly OutlineCommand[]): {
  left: number;
  bottom: number;
  right: number;
  top: number;
};
