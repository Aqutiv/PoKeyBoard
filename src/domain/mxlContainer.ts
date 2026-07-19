import { unzipSync } from 'fflate';
import { ScoreImportError } from '@/utils/errors';

/** File names the score importer accepts: compressed MXL or raw MusicXML. */
export function isScoreFileName(name: string): boolean {
  return /\.(mxl|musicxml|xml)$/i.test(name);
}

/** Per-entry decompressed cap; anything larger is treated as hostile. */
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 256;
const MAX_TOTAL_DECOMPRESSED_BYTES = 50 * 1024 * 1024;

/** Decode score bytes as text, honoring a UTF-16 BOM (old Finale exports). */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Score path inside an MXL archive, per META-INF/container.xml when present. */
function resolveRootPath(entries: Record<string, Uint8Array>): string | null {
  const container = entries['META-INF/container.xml'];
  if (container) {
    const doc = new DOMParser().parseFromString(decodeText(container), 'application/xml');
    const rootfile = doc.getElementsByTagName('rootfile')[0];
    const path = rootfile?.getAttribute('full-path');
    if (path && entries[path]) return path;
  }
  for (const name of Object.keys(entries)) {
    const normalized = name.replace(/\\/g, '/');
    if (!normalized.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(normalized)) return name;
  }
  return null;
}

/**
 * The MusicXML text carried in `bytes`: unpacks an MXL (zip) container, or
 * passes raw XML through. Throws ScoreImportError when no score is found.
 */
export function extractMusicXmlText(bytes: Uint8Array): string {
  if (!isZip(bytes)) {
    if (bytes.byteLength > MAX_TOTAL_DECOMPRESSED_BYTES) {
      throw new ScoreImportError(['The MusicXML file is too large.']);
    }
    return decodeText(bytes);
  }
  let entries: Record<string, Uint8Array>;
  let entryCount = 0;
  let cumulativeBytes = 0;
  let limitError: string | null = null;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        entryCount += 1;
        cumulativeBytes += file.originalSize;
        if (entryCount > MAX_ARCHIVE_ENTRIES) {
          limitError = `The archive contains more than ${MAX_ARCHIVE_ENTRIES} entries.`;
        } else if (file.originalSize > MAX_ENTRY_BYTES) {
          limitError = 'An archive entry is too large.';
        } else if (cumulativeBytes > MAX_TOTAL_DECOMPRESSED_BYTES) {
          limitError = 'The archive expands beyond the safe size limit.';
        }
        return limitError === null;
      },
    });
  } catch (error) {
    throw new ScoreImportError([
      `The archive could not be unpacked${error instanceof Error ? `: ${error.message}` : ''}.`,
    ]);
  }
  if (limitError !== null) throw new ScoreImportError([limitError]);
  const rootPath = resolveRootPath(entries);
  const entry = rootPath === null ? undefined : entries[rootPath];
  if (!entry) {
    throw new ScoreImportError(['No MusicXML document was found inside the archive.']);
  }
  return decodeText(entry);
}
