import { loadConnection } from '../server.js';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const config = await loadConnection();
async function status() {
  const response = await fetch(`http://127.0.0.1:${config.port}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` }, body: JSON.stringify({ tool: 'browser_status', args: {} }) });
  const result = await response.json(); if (!result.ok) throw new Error('Connection status request failed.'); return result.value;
}
const before = await status(); assert.equal(before.connected, true);
console.log('Started 90-second browser idle observation.');
await new Promise(resolve => setTimeout(resolve, 90000));
const after = await status();
assert.equal(after.connected, true); assert.ok(after.lastSeen > before.lastSeen); assert.ok(Date.now() - after.lastSeen < 30000);
const report = { ok: true, observedSeconds: 90, stayedConnected: before.connectedAt === after.connectedAt, before, after };
const file = path.join(process.env.XDG_CACHE_HOME, 'dsh-browser-control', 'verification', 'idle-test.json');
await writeFile(file, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ok: true, stayedConnected: report.stayedConnected, report: file }));
