// main.ts — entry point for the Garuda Senja make.fun entry.
// Copies game/ and screenshots/ from the input directory into the output
// directory, then writes dossier.json there with buildDossier from the
// vendored kit library (vendor/makefun-game.ts, copied byte-for-byte).
// Node 22, standard library only; run as: node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
if (!existsSync(shotsSrc)) {
  throw new Error(`main.ts: no screenshots/ under ${inputDir}`);
}

mkdirSync(outputDir, { recursive: true });
cpSync(gameSrc, join(outputDir, 'game'), { recursive: true });
cpSync(shotsSrc, join(outputDir, 'screenshots'), { recursive: true });

const dossier = buildDossier(outputDir, CAPS);
writeFileSync(join(outputDir, 'dossier.json'), dossier);

console.log(`main.ts: wrote ${join(outputDir, 'dossier.json')} (${dossier.length} bytes)`);
console.log(`main.ts: game/ and screenshots/ copied from ${inputDir} to ${outputDir}`);
