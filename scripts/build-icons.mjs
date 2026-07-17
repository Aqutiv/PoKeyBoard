/**
 * Generates every PWA icon size from the master brand asset
 * (assets/branding/pokeyboard-icon-master.png) into public/icons/.
 *
 * Maskable icons scale the artwork to ~66% on the theme background so the
 * content stays inside the launcher safe zone. Requires ffmpeg on PATH.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const MASTER = path.join('assets', 'branding', 'pokeyboard-icon-master.png');
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

function plain(size, name) {
  return runFfmpeg([
    '-i',
    MASTER,
    '-vf',
    `scale=${size}:${size}:flags=lanczos`,
    path.join(OUT_DIR, name),
  ]);
}

function maskable(size, name) {
  const inner = Math.round(size * 0.66);
  return runFfmpeg([
    '-i',
    MASTER,
    '-vf',
    `scale=${inner}:${inner}:flags=lanczos,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=${THEME_BG}`,
    path.join(OUT_DIR, name),
  ]);
}

await mkdir(OUT_DIR, { recursive: true });
await plain(512, 'icon-512.png');
await plain(192, 'icon-192.png');
await plain(180, 'apple-touch-icon.png');
await plain(64, 'favicon-64.png');
await plain(32, 'favicon-32.png');
await maskable(512, 'maskable-512.png');
await maskable(192, 'maskable-192.png');
console.log('Icons written to public/icons/');
