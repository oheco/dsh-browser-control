import { BrowserBridge, loadConnection } from '../server.js';
import { createOperations } from '../operations.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const run = promisify(execFile), config = await loadConnection();
const manage = async enabled => { const result = await run(process.execPath, ['scripts/dsh-manager.mjs', process.argv[2] || '18515', 'pluginManager/setBundleEnabled', JSON.stringify({ name: '@oheco/dsh-browser-control', enabled })]); if (!JSON.parse(result.stdout).result.ok) throw new Error('Bundle toggle failed'); };
async function rpc(tool, args = {}) { const response = await fetch(`http://127.0.0.1:${config.port}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` }, body: JSON.stringify({ tool, args }) }); const r = await response.json(); if (!r.ok) throw new Error(`${tool} failed`); return r.value; }
let tabId, temporary, disabled = false; const report = { startedAt: new Date().toISOString() };
try {
  tabId = (await rpc('browser_open', { url: 'about:blank', active: false })).id;
  assert.ok((await rpc('browser_tabs', { action: 'list' })).debugging.targets.find(t => t.tabId === tabId)?.attached);
  await manage(false); disabled = true;
  temporary = await new BrowserBridge({ port: config.port, token: config.token }).start();
  const execute = createOperations(temporary);
  const deadline = Date.now() + 15000;
  while (!temporary.status().connected) { if (Date.now() > deadline) throw new Error('Extension did not reconnect to verification bridge'); await new Promise(resolve => setTimeout(resolve, 250)); }
  const state = (await execute('browser_tabs', { action: 'list' })).debugging;
  assert.equal(state.targets.find(t => t.tabId === tabId)?.attached, false);
  report.ok = true; report.debugging = state; console.log('PASS dsh disconnect releases actual native debugger before automatic reconnection');
  await execute('browser_tabs', { action: 'close', tabId }); tabId = undefined;
} catch (error) { report.ok = false; report.error = error.message; process.exitCode = 1; }
finally {
  if (temporary) await temporary.close();
  if (disabled) await manage(true);
  if (tabId !== undefined) { try { await rpc('browser_tabs', { action: 'close', tabId }); } catch {} }
  report.finishedAt = new Date().toISOString();
  const file = path.join(process.env.XDG_CACHE_HOME, 'dsh-browser-control/verification/disconnect-native-test.json'); await writeFile(file, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ok: report.ok, report: file, error: report.error }));
}
