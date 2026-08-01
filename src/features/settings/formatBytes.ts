/** Byte sizes as the settings page shows them: sample packs and storage quota. */
export function formatMB(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
