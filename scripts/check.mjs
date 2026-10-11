import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'tpr'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await check(file);
    else if (/\.(js|mjs)$/.test(entry.name)) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    else if (entry.name.endsWith('.json')) JSON.parse(await readFile(file, 'utf8'));
  }
}
await check(root);
const manifest = JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3 || manifest.background.type !== 'module' || !manifest.permissions.includes('debugger') || !manifest.permissions.includes('alarms')) throw new Error('Invalid browser manifest.');
console.log('JavaScript syntax, JSON and extension manifest checks passed.');
