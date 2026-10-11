import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserController, callChrome } from '../extension/controller.js';
function fixture() {
  const commands = [], tab = { id: 17, windowId: 3, url: 'http://example.test', title: 'Test' };
  const listener = { addListener() {} };
  const chrome = { runtime: {}, tabs: { onRemoved: listener, get: (_id, cb) => cb(tab), create: (args, cb) => cb({ ...tab, ...args }), query: (_args, cb) => cb([tab]) }, debugger: { onEvent: listener, onDetach: listener, attach: (_target, _version, cb) => cb(), detach: (_target, cb) => cb(), sendCommand: (_target, method, params, cb) => { commands.push({ method, params });
    if (method === 'Runtime.evaluate') cb({ result: { type: 'object', value: { x: 50, y: 40, editable: true, inputType: 'text' } } });
    else cb({});
  } } };
  return { controller: new BrowserController(chrome), commands };
}
test('fill uses native keyboard events and insertText; pointer click uses native input', async () => {
  const { controller, commands } = fixture();
  await controller.execute('browser_action', { tabId: 17, action: 'fill', ref: 's-e1', text: '测试输入' });
  assert.ok(commands.some(x => x.method === 'Input.dispatchKeyEvent' && x.params.modifiers === 2 && x.params.code === 'KeyA'));
  assert.ok(commands.some(x => x.method === 'Input.insertText' && x.params.text === '测试输入'));
  commands.length = 0;
  await controller.execute('browser_action', { tabId: 17, action: 'click', x: 50, y: 40 });
  assert.deepEqual(commands.map(x => x.params.type), ['mouseMoved', 'mousePressed', 'mouseReleased']);
});
test('canceling a delayed element lookup prevents late key input', async () => {
  const { controller, commands } = fixture(); let release, started;
  const begun = new Promise(resolve => { started = resolve; });
  controller.page = async () => { started(); return new Promise(resolve => { release = resolve; }); };
  const abort = new AbortController();
  const operation = controller.execute('browser_action', { tabId: 17, action: 'press', ref: 'e1', key: 'Enter' }, abort.signal);
  await begun; abort.abort(); release({ x: 50, y: 40 });
  await assert.rejects(operation, { name: 'AbortError' });
  assert.ok(!commands.some(x => x.method.startsWith('Input.')));
});
test('a stalled Chrome callback has a finite deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const operation = callChrome({ runtime: {} }, { stalled() {} }, 'stalled');
  const rejected = assert.rejects(operation, { code: 'BROWSER_API_TIMEOUT' });
  t.mock.timers.tick(15001); await rejected;
});
test('logs keep bounded console and request failures, clear only when requested', async () => {
  const { controller } = fixture();
  for (let i = 0; i < 550; i++) controller.event({ tabId: 17 }, 'Runtime.consoleAPICalled', { type: 'error', args: [{ value: `error${i}` }] });
  controller.event({ tabId: 17 }, 'Network.responseReceived', { response: { url: 'http://example.test/missing', status: 404 } });
  const value = await controller.execute('browser_logs', { tabId: 17, limit: 2 }); assert.equal(value.entries.length, 2); assert.equal(value.entries[1].status, 404);
  await controller.execute('browser_logs', { tabId: 17, clear: true }); assert.equal(controller.logs.get(17).length, 0);
});
