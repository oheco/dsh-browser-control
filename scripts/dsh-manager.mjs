// Development/install helper for the official authenticated DSH manager API.
// Credentials remain in memory; this never prints argv, token, Cookie or login URL.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const [pid, method, args = '{}'] = process.argv.slice(2);
if (!/^\d+$/.test(pid || '') || !/^pluginManager\/\w+$/.test(method || '')) throw new Error('Usage: node scripts/dsh-manager.mjs <DSH-host-pid> pluginManager/<method> <JSON-args>');
const base = process.env.DSH_WEB_URL;
if (!base || new URL(base).hostname !== '127.0.0.1') throw new Error('DSH_WEB_URL must name the existing loopback GUI.');
const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
const index = argv.indexOf('--token'); if (index < 0) throw new Error('DSH launch authentication unavailable.');
const loginUrl = new URL('/', base); loginUrl.searchParams.set('token', argv[index + 1]);
const login = await fetch(loginUrl, { redirect: 'manual' });
if (login.status !== 303) throw new Error(`DSH authentication returned ${login.status}.`);
const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]; if (!cookie) throw new Error('DSH did not return its authentication cookie.');
const response = await fetch(new URL('/api/' + method, base), { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args: JSON.parse(args) } }) });
const result = await response.json();
if (method === 'pluginManager/listBundles' || method === 'pluginManager/listPlugins') {
  const value = result.result?.value;
  const rows = Array.isArray(value) ? value : value?.bundles || value?.plugins || value?.entries || [];
  result.result.value = rows.filter(b => b.name === '@oheco/dsh-browser-control' || b.patchId === 'oheco-browser-control' || b.moduleName?.includes('dsh-browser-control') || b.name?.includes('dsh-browser-control'));
}
console.log(JSON.stringify(result, null, 2));
if (!result.result?.ok || result.result.value?.application === 'failed') process.exitCode = 1;
