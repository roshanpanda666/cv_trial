// Packs the built extension as cv-trial-extension/ inside a zip, so users can
// unzip it and point "Load unpacked" at that one folder.
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const out = join(root, '.output', `cv-trial-extension-v${version}.zip`);
const tmp = await mkdtemp(join(tmpdir(), 'cvtrial-'));

await cp(join(root, '.output', 'chrome-mv3'), join(tmp, 'cv-trial-extension'), { recursive: true });
await rm(out, { force: true });
execFileSync('zip', ['-qr', out, 'cv-trial-extension'], { cwd: tmp, stdio: 'inherit' });
await rm(tmp, { recursive: true, force: true });
console.log(`[zip] ${out}`);
