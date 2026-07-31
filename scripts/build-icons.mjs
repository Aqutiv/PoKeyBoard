/**
 * Generates every PWA icon size from the brand assets into public/icons/.
 *
 * Standard desktop/web icons use the transparent emblem. Apple touch and
 * maskable icons retain the opaque tile for platform compatibility. Maskable
 * icons scale the artwork to ~66% on the theme background so the content stays
 * inside the launcher safe zone. Requires ffmpeg on PATH.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const OPAQUE_MASTER = path.join('assets', 'branding', 'pokeyboard-icon-master.png');
const TRANSPARENT_MASTER = path.join('assets', 'branding', 'pokeyboard-emblem-transparent.png');
const OUT_DIR = path.join('public', 'icons');
const THEME_BG = '0x171412';

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

function resize(source, size, name, preserveAlpha = false) {
  return runFfmpeg([
    '-i',
    source,
    '-vf',
    `scale=${size}:${size}:flags=lanczos${preserveAlpha ? ',format=rgba' : ''}`,
    path.join(OUT_DIR, name),
  ]);
}

function maskable(size, name) {
  const inner = Math.round(size * 0.66);
  return runFfmpeg([
    '-i',
    OPAQUE_MASTER,
    '-vf',
    `scale=${inner}:${inner}:flags=lanczos,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=${THEME_BG}`,
    path.join(OUT_DIR, name),
  ]);
}

await mkdir(OUT_DIR, { recursive: true });
await resize(TRANSPARENT_MASTER, 512, 'icon-transparent-512.png', true);
await resize(TRANSPARENT_MASTER, 192, 'icon-transparent-192.png', true);
await resize(OPAQUE_MASTER, 180, 'apple-touch-icon.png');
await resize(TRANSPARENT_MASTER, 64, 'favicon-transparent-64.png', true);
await resize(TRANSPARENT_MASTER, 32, 'favicon-transparent-32.png', true);
await maskable(512, 'maskable-512.png');
await maskable(192, 'maskable-192.png');
console.log('Icons written to public/icons/');
