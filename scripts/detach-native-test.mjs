import { loadConnection } from '../server.js';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const config = await loadConnection(), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = { startedAt: new Date().toISOString(), steps: [] }; let tabId;
async function rpc(tool, args = {}) {
  const response = await fetch(`http://127.0.0.1:${config.port}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` }, body: JSON.stringify({ tool, args }) });
  const result = await response.json(); if (!result.ok) throw new Error(`${tool}: ${result.error.code}: ${result.error.message}`); return result.value;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function debugging() { return (await rpc('browser_tabs', { action: 'list' })).debugging; }
function actual(state) { assert.ok(Array.isArray(state.targets), 'Native getTargets must be supported'); return state.targets.find(t => t.tabId === tabId)?.attached ?? false; }
try {
  const status = await rpc('browser_status'); assert.equal(status.connected, true); assert.equal(status.browser.extensionVersion, '0.1.1'); assert.ok(status.browser.capabilities.includes('autoDetach'));
  tabId = (await rpc('browser_open', { path: path.join(root, 'test/fixtures'), active: true })).id;
  await rpc('browser_wait', { tabId, text: '页面和根路径资源已加载' });
  assert.equal(actual(await debugging()), true); report.steps.push('native debugger attached on page request'); console.log('PASS native debugger attached');
  await delay(32000);
  let state = await debugging(); assert.equal(actual(state), false); assert.ok(!state.attachedTabIds.includes(tabId)); report.idle = state; report.steps.push('idle target detaches after 30 seconds while tab remains open'); console.log('PASS actual debugger released after idle');
  await rpc('browser_snapshot', { tabId }); assert.equal(actual(await debugging()), true); report.steps.push('next request automatically reattaches'); console.log('PASS automatic reattachment');
  await rpc('browser_evaluate', { tabId, expression: "(setTimeout(() => { const p = document.createElement('p'); p.textContent = 'long-wait-lifecycle-finished'; document.body.append(p); }, 40000), true)" });
  const longWait = rpc('browser_wait', { tabId, text: 'long-wait-lifecycle-finished', timeoutMs: 45000 });
  // Hold a rejection handler while checking the concurrently running wait.
  longWait.catch(() => {});
  await delay(32000); state = await debugging(); assert.equal(actual(state), true); assert.ok(state.busyTabIds.includes(tabId));
  await longWait; report.steps.push('40-second real wait remains attached beyond idle deadline'); console.log('PASS long wait protected from idle release');
  await delay(32000); state = await debugging(); assert.equal(actual(state), false);
  const logs = await rpc('browser_logs', { tabId }); assert.ok(logs.entries.some(e => e.text?.includes('fixture-start-error'))); assert.equal(actual(await debugging()), false);
  report.steps.push('completed wait detaches; cached log read remains detached'); report.afterWait = state; console.log('PASS idle after wait and passive cached logs');
  report.ok = true;
} catch (error) { report.ok = false; report.error = error.message; process.exitCode = 1; }
finally {
  if (tabId !== undefined) try { await rpc('browser_tabs', { action: 'close', tabId }); } catch {}
  report.finishedAt = new Date().toISOString();
  const directory = path.join(process.env.XDG_CACHE_HOME, 'dsh-browser-control/verification'); await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'detach-native-test.json'); await writeFile(file, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ok: report.ok, report: file, error: report.error }));
}
