import { readFile, readdir, mkdir, cp, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const run = promisify(execFile);
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(process.env.XDG_CACHE_HOME, 'dsh-browser-control', 'artifacts');
const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
const inputs = ['package.json', ...manifest.files], entries = [];
async function inventory(relative) {
  const file = path.join(source, relative), info = await stat(file);
  if (info.isDirectory()) { for (const child of (await readdir(file)).sort()) await inventory(path.join(relative, child)); }
  else entries.push({ relative, data: await readFile(file) });
}
for (const input of inputs) await inventory(input);
entries.sort((a, b) => a.relative.localeCompare(b.relative));
const hasher = createHash('sha256'); for (const { relative, data } of entries) hasher.update(relative + '\0').update(data);
const digest = hasher.digest('hex');
const directory = path.join(cache, digest.slice(0, 16)), staged = path.join(directory, 'package');
await mkdir(staged, { recursive: true, mode: 0o700 });
for (const input of inputs) await cp(path.join(source, input), path.join(staged, input), { recursive: true, force: true });
// Stage under an immutable source digest. Native module identities are fresh when reactivating this version.
await run(process.execPath, ['scripts/check.mjs'], { cwd: staged });
const npm = await run('npm', ['pack', '--offline', '--pack-destination', directory], { cwd: staged, maxBuffer: 2000000 });
const tgz = path.join(directory, npm.stdout.trim().split('\n').at(-1));
const zip = path.join(directory, `dsh-browser-control-extension-${manifest.version}.zip`);
await run('python3', ['-c', 'import pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED) as z:\n for p in sorted(root.rglob("*")):\n  if p.is_file():\n   info=zipfile.ZipInfo(p.relative_to(root).as_posix(),(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16;z.writestr(info,p.read_bytes())', path.join(staged, 'extension'), zip]);
const outputs = [];
for (const file of [tgz, zip]) { const data = await readFile(file); outputs.push({ path: file, size: data.length, sha256: createHash('sha256').update(data).digest('hex') }); }
await writeFile(path.join(directory, 'SHA256SUMS'), outputs.map(x => `${x.sha256}  ${path.basename(x.path)}`).join('\n') + '\n');
const result = { version: manifest.version, sourceSha256: digest, staged, outputs };
await writeFile(path.join(cache, 'latest-build.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
