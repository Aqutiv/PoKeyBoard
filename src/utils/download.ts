/** Trigger a browser download for a blob (the universal fallback path). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the click a beat before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4_000);
}

/**
 * Share a file via the OS share sheet when file sharing is supported,
 * otherwise download it. MUST be called directly from a user click so the
 * share call still holds user activation. Returns how it was delivered.
 */
export async function shareOrDownloadFile(file: File): Promise<'shared' | 'downloaded'> {
  if (
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (error) {
      // AbortError = user closed the sheet; anything else falls back.
      if (error instanceof Error && error.name === 'AbortError') return 'shared';
    }
  }
  downloadBlob(file, file.name);
  return 'downloaded';
}
