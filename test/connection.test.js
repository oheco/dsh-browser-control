import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from '../tpr/ws/wrapper.mjs';
import { BrowserBridge } from '../server.js';
import { AutoConnection, RETRY_ALARM, validateEndpoint } from '../extension/connection.js';
const TOKEN = 'a'.repeat(64), ORIGIN = 'chrome-extension://' + 'b'.repeat(32);
class BrowserSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
function chromeFixture(saved = {}) {
  const data = { ...saved }, alarms = new Map();
  return { data, alarms,
    runtime: { getManifest: () => ({ version: '0.1.0' }), lastError: undefined },
    storage: { local: { get: (keys, cb) => cb(Object.fromEntries(keys.map(k => [k, data[k]]))), set: (values, cb) => { Object.assign(data, values); cb(); } } },
    alarms: { get: (key, cb) => cb(alarms.get(key)), create: (key, value) => alarms.set(key, value) },
    action: { setBadgeText: (_value, cb) => cb(), setTitle: (_value, cb) => cb() },
    debugger: { attach() {}, sendCommand() {} },
  };
}
async function until(predicate) { const end = Date.now() + 4000; while (!predicate()) { if (Date.now() >= end) throw new Error('Condition did not complete'); await delay(10); } }
test('starts and reconnects automatically, recreates worker from persisted config, no manual page connection', async t => {
  const b = await new BrowserBridge({ port: 0, token: TOKEN }).start();
  const chrome = chromeFixture({ connection: { endpoint: `ws://127.0.0.1:${b.port}/browser`, token: TOKEN, enabled: true } });
  let calls = 0;
  const client = new AutoConnection({ chrome, WebSocketClass: BrowserSocket, controller: { execute: async () => ({ call: ++calls }) } });
  t.after(async () => { client.disconnect(); await b.close(); });
  await client.initialize(); await until(() => client.ready);
  assert.equal(chrome.data.connectionStatus.status, 'connected');
  assert.deepEqual(await b.request('browser_open', { url: 'http://example.test' }), { call: 1 });
  b.peer.terminate(); await until(() => !client.ready); await until(() => client.ready);
  assert.equal(calls, 1, 'reconnection does not replay the operation');
  client.disconnect(); await until(() => !b.peer);
  const recreated = new AutoConnection({ chrome, WebSocketClass: BrowserSocket, controller: { execute: async () => ({ restored: true }) } });
  t.after(() => recreated.disconnect()); await recreated.initialize(); await until(() => recreated.ready);
  assert.deepEqual(await b.request('browser_tabs', { action: 'list' }), { restored: true });
  assert.ok(!JSON.stringify(chrome.data.connectionStatus).includes(TOKEN));
});
test('offline startup retains alarm wakeup and connects after dsh appears', async t => {
  const reserve = await new BrowserBridge({ port: 0, token: TOKEN }).start(), port = reserve.port; await reserve.close();
  const chrome = chromeFixture({ connection: { endpoint: `ws://127.0.0.1:${port}/browser`, token: TOKEN, enabled: true } });
  const client = new AutoConnection({ chrome, WebSocketClass: BrowserSocket, controller: { execute: async () => null } });
  t.after(() => client.disconnect()); await client.initialize();
  await until(() => chrome.data.connectionStatus.status === 'reconnecting');
  const b = await new BrowserBridge({ port, token: TOKEN }).start(); t.after(() => b.close());
  // Chrome's alarm handler calls connect even after a worker restart.
  client.connect(); await until(() => client.ready); assert.equal(b.status().connected, true);
});
test('endpoint validation refuses remote bridges and embedded credentials', () => {
  assert.equal(validateEndpoint('ws://127.0.0.1:9227/browser'), 'ws://127.0.0.1:9227/browser');
  for (const url of ['ws://example.com:9227/browser', 'ws://127.0.0.1:9227/elsewhere', 'ws://secret@127.0.0.1:9227/browser', 'ws://127.0.0.1:9227/browser?token=secret']) assert.throws(() => validateEndpoint(url));
  assert.equal(RETRY_ALARM, 'oheco-dsh-browser-reconnect');
});
