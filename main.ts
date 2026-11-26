// main.ts — entry point for the Garuda Senja make.fun entry.
// Copies game/ and screenshots/ from the input directory into the output
// directory, then writes dossier.json there with buildDossier from the
// vendored kit library (vendor/makefun-game.ts, copied byte-for-byte).
// Node 22, standard library only; run as: node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-game.ts';

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

const inputDir = process.env.MAKEFUN_INPUT_DIR || '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const gameSrc = join(inputDir, 'game');
const shotsSrc = join(inputDir, 'screenshots');
if (!existsSync(gameSrc)) {
  throw new Error(`main.ts: no game/ under ${inputDir}`);
}
if (!existsSync(join(gameSrc, 'index.html'))) {
  throw new Error(`main.ts: no game/index.html under ${inputDir} (a game needs its page)`);
}
if (!existsSync(shotsSrc)) {
  throw new Error(`main.ts: no screenshots/ under ${inputDir}`);
}

/** A screenshot must be a PNG or a JPEG, by its magic bytes. */
function isImageFile(path: string): boolean {
  const b = readFileSync(path);
  const png = b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const jpeg = b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  return png || jpeg;
}
const shotNames = readdirSync(shotsSrc).filter((n) => !n.startsWith('.')).sort();
if (shotNames.length === 0) {
  throw new Error(`main.ts: screenshots/ under ${inputDir} holds no images`);
}
for (const name of shotNames) {
  const p = join(shotsSrc, name);
  if (!statSync(p).isFile() || !isImageFile(p)) {
    throw new Error(`main.ts: screenshots/${name} is not a PNG or JPEG image`);
  }
  if (statSync(p).size > CAPS.screenshots.max_bytes) {
    throw new Error(`main.ts: screenshots/${name} is over the ${CAPS.screenshots.max_bytes}-byte cap`);
  }
}

mkdirSync(outputDir, { recursive: true });
cpSync(gameSrc, join(outputDir, 'game'), { recursive: true });
cpSync(shotsSrc, join(outputDir, 'screenshots'), { recursive: true });

const dossier = buildDossier(outputDir, CAPS);
writeFileSync(join(outputDir, 'dossier.json'), dossier);

const gameBytes = readdirSync(join(outputDir, 'game'), { recursive: true })
  .map((n) => join(outputDir, 'game', String(n)))
  .filter((p) => statSync(p).isFile())
  .reduce((sum, p) => sum + statSync(p).size, 0);
console.log(`main.ts: copied game/ (${gameBytes} bytes) and ${shotNames.length} screenshot(s) from ${inputDir} to ${outputDir}`);
console.log(`main.ts: wrote ${join(outputDir, 'dossier.json')} (${dossier.length} bytes)`);
