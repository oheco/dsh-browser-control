import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket } from '../tpr/ws/wrapper.mjs';
import { BrowserBridge, loadConnection } from '../server.js';
import { createOperations } from '../operations.js';

const TOKEN = 'a'.repeat(64), ORIGIN = 'chrome-extension://' + 'b'.repeat(32);
async function directory(t) {
  const root = process.env.TMPDIR; assert.ok(root, 'TMPDIR must be application-private storage');
  const dir = await mkdtemp(path.join(root, 'dsh-browser-test-'));
  t.after(async () => { const resolved = await realpath(dir); assert.ok(resolved.startsWith(path.resolve(root) + path.sep + 'dsh-browser-test-')); await rm(resolved, { recursive: true }); });
  return dir;
}
async function bridge(t) {
  const b = await new BrowserBridge({ port: 0, token: TOKEN, requestTimeout: 2000 }).start(); t.after(() => b.close()); return b;
}
async function peer(b, token = TOKEN) {
  const ws = new WebSocket(`ws://127.0.0.1:${b.port}/browser`, { origin: ORIGIN });
  await once(ws, 'open');
  const result = once(ws, token === TOKEN ? 'message' : 'close');
  ws.send(JSON.stringify({ type: 'hello', protocol: 1, token, browser: { capabilities: ['debugger'] } }));
  await result; return ws;
}
test('credentials persist only in permission-enforcing private storage', async t => {
  const dir = await directory(t); const a = await loadConnection({ directory: path.join(dir, 'config') });
  const b = await loadConnection({ directory: path.join(dir, 'config') }); assert.equal(a.token, b.token); assert.equal(a.port, 9227);
  await assert.rejects(loadConnection({ directory: path.join(dir, 'config'), port: 9999 }), { code: 'PORT_CONFIG_MISMATCH' });
});
test('webpage origins and wrong credentials cannot connect; valid extension advertises capabilities', async t => {
  const b = await bridge(t);
  const bad = new WebSocket(`ws://127.0.0.1:${b.port}/browser`, { origin: 'https://example.com' });
  const error = await once(bad, 'error'); assert.match(error[0].message, /403/);
  const malformed = new WebSocket(`ws://127.0.0.1:${b.port}/browser`, { origin: ORIGIN }); await once(malformed, 'open');
  const closed = once(malformed, 'close'); malformed.send('null'); await closed; assert.equal(b.status().listening, true);
  const wrong = await peer(b, 'c'.repeat(64)); assert.equal(wrong.readyState, 3); assert.equal(b.status().connected, false);
  const ws = await peer(b); assert.equal(b.status().connected, true); assert.deepEqual(b.status().browser.capabilities, ['debugger']); ws.close();
});
test('correlates out-of-order results and never replays commands after disconnect', async t => {
  const b = await bridge(t), ws = await peer(b), commands = [];
  ws.on('message', raw => { const msg = JSON.parse(raw); if (msg.type === 'command') commands.push(msg); });
  const a = b.request('browser_evaluate', { tabId: 1 }), c = b.request('browser_snapshot', { tabId: 2 });
  while (commands.length < 2) await once(ws, 'message');
  ws.send(JSON.stringify({ type: 'result', id: commands[1].id, ok: true, value: { second: true } }));
  ws.send(JSON.stringify({ type: 'result', id: commands[0].id, ok: true, value: { first: true } }));
  assert.deepEqual(await a, { first: true }); assert.deepEqual(await c, { second: true });
  const disconnected = b.request('browser_action', { tabId: 1, action: 'click' });
  const rejection = assert.rejects(disconnected, { code: 'CONNECTION_LOST' });
  const serverClosed = once(ws, 'close'); ws.close(); await serverClosed; await rejection;
  const newer = await peer(b); assert.equal(b.pending.size, 0); assert.equal(commands.length, 3); newer.close();
});
test('cancellation and timeout send cancellation and clean pending requests', async t => {
  const b = await bridge(t), ws = await peer(b), abort = new AbortController();
  const command = once(ws, 'message'); const request = b.request('browser_wait', { tabId: 1 }, { signal: abort.signal });
  await command; const rejection = assert.rejects(request, { code: 'CANCELLED' }); const cancel = once(ws, 'message'); abort.abort();
  await rejection; assert.equal(JSON.parse((await cancel)[0]).type, 'cancel'); assert.equal(b.pending.size, 0);
  await assert.rejects(b.request('browser_snapshot', { tabId: 1 }, { timeout: 15 }), { code: 'BROWSER_TIMEOUT' }); assert.equal(b.pending.size, 0); ws.close();
});
test('local HTML and assets work with spaces; escaping symlinks and HTTP origins are denied', async t => {
  const dir = await directory(t), root = path.join(dir, 'project with spaces'); await mkdir(root);
  await writeFile(path.join(root, 'index.html'), '<link rel="stylesheet" href="/style.css"><script src="/assets/app.js"></script>test'); await writeFile(path.join(root, 'style.css'), 'body{color:red}');
  await writeFile(path.join(dir, 'secret.txt'), 'outside'); await symlink(path.join(dir, 'secret.txt'), path.join(root, 'escape.txt'));
  const b = await bridge(t), mount = await b.mount(root);
  assert.equal((await fetch(mount.url)).status, 200);
  assert.equal(await (await fetch(new URL('/style.css', mount.url))).text(), 'body{color:red}');
  await mkdir(path.join(root, 'assets')); await writeFile(path.join(root, 'assets/app.js'), 'window.testLoaded=true');
  assert.equal(await (await fetch(new URL('/assets/app.js', mount.url))).text(), 'window.testLoaded=true');
  assert.equal((await fetch(new URL('escape.txt', mount.url))).status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${b.port}/rpc`, { method: 'POST', headers: { Origin: 'http://example.com', Authorization: `Bearer ${TOKEN}` }, body: '{}' })).status, 403);
});
test('screenshot saves PNG and refuses to overwrite an existing output', async t => {
  const dir = await directory(t), output = path.join(dir, 'screen.png');
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
  const execute = createOperations({ request: async () => ({ data, cssViewport: { width: 1, height: 1 } }) });
  const value = await execute('browser_screenshot', { tabId: 1, path: output });
  assert.equal(value.width, 1); assert.equal(value.height, 1); assert.ok((await readFile(output)).length > 20);
  await assert.rejects(execute('browser_screenshot', { tabId: 1, path: output }), { code: 'EEXIST' });
  await assert.rejects(execute('browser_navigate', { tabId: 1, action: 'goto' }), { code: 'INVALID_ARGUMENTS' });
});
