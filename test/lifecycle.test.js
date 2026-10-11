import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserController } from '../extension/controller.js';
function fixture() {
  let clock = 0, next = 0; const timers = new Map(), attached = new Set(), calls = [], events = {};
  const listener = name => ({ addListener(fn) { events[name] = fn; } });
  const chrome = { runtime: {}, tabs: { onRemoved: listener('removed'), get: (id, cb) => cb({ id, url: 'http://example.test' }), query: (_q, cb) => cb([{ id: 17, url: 'http://example.test' }]) }, debugger: {
    onEvent: listener('event'), onDetach: listener('detach'),
    attach: ({ tabId }, _v, cb) => { calls.push(['attach', tabId]); attached.add(tabId); cb(); },
    detach: ({ tabId }, cb) => { calls.push(['detach', tabId]); attached.delete(tabId); cb(); },
    getTargets: cb => cb([17, 18].map(tabId => ({ tabId, attached: attached.has(tabId) }))),
    sendCommand: (_t, method, _params, cb) => cb(method === 'Runtime.evaluate' ? { result: { type: 'number', value: 1 } } : {}),
  } };
  const scheduler = { setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, at: clock + ms }); return id; }, clearTimeout(id) { timers.delete(id); } };
  const controller = new BrowserController(chrome, { timers: scheduler, now: () => clock });
  async function advance(ms, { fireTimers = true } = {}) { clock += ms; for (const [id, timer] of [...timers]) if (fireTimers && timer.at <= clock) { timers.delete(id); timer.fn(); } for (let i = 0; i < 8; i++) await Promise.resolve(); }
  const evaluate = () => controller.execute('browser_evaluate', { tabId: 17, expression: '1' });
  return { controller, chrome, calls, attached, advance, evaluate, events };
}
test('idle detach is per tab; next request reattaches automatically', async () => {
  const f = fixture(); await f.evaluate(); assert.ok(f.attached.has(17));
  await f.advance(29999); assert.ok(f.attached.has(17));
  await f.advance(1); assert.ok(!f.attached.has(17)); assert.equal(f.controller.contexts.has(17), false);
  await f.evaluate(); assert.ok(f.attached.has(17)); assert.equal(f.calls.filter(c => c[0] === 'attach').length, 2);
});
test('idle deadlines are independent for different tabs', async () => {
  const f = fixture(); await f.evaluate(); await f.advance(20000);
  await f.controller.execute('browser_evaluate', { tabId: 18, expression: '1' });
  await f.advance(10000); assert.ok(!f.attached.has(17)); assert.ok(f.attached.has(18));
  await f.advance(20000); assert.ok(!f.attached.has(18));
});
test('new page activity renews idle deadline; log reads and tab queries do not', async () => {
  const f = fixture(); await f.evaluate(); await f.advance(20000); await f.evaluate();
  await f.advance(20000); assert.ok(f.attached.has(17));
  await f.controller.execute('browser_logs', { tabId: 17 }); await f.controller.execute('browser_tabs', { action: 'list' });
  await f.advance(10000); assert.ok(!f.attached.has(17));
  await f.controller.execute('browser_logs', { tabId: 17 }); assert.ok(!f.attached.has(17));
});
test('long request is protected; disconnect releases only after it finishes', async () => {
  const f = fixture(); await f.evaluate(); let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const original = f.controller.executeCommand.bind(f.controller);
  f.controller.executeCommand = async (method, args, signal) => { if (method === 'browser_wait') { started(); return new Promise(resolve => { release = resolve; }); } return original(method, args, signal); };
  const operation = f.controller.execute('browser_wait', { tabId: 17 }); await ready;
  await f.advance(90000); await f.controller.sweepIdle(); assert.ok(f.attached.has(17));
  await f.controller.releaseAll(); assert.ok(f.attached.has(17));
  release({ matched: true }); await operation; assert.ok(!f.attached.has(17));
});
test('a new operation waits for an already-started native detach', async () => {
  const f = fixture(); await f.evaluate(); let finishDetach;
  f.chrome.debugger.detach = ({ tabId }, cb) => { f.calls.push(['detach', tabId]); finishDetach = () => { f.attached.delete(tabId); cb(); }; };
  await f.advance(30000); assert.ok(f.controller.detaching.has(17));
  const operation = f.evaluate(); for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(f.calls.filter(c => c[0] === 'attach').length, 1);
  finishDetach(); await operation; assert.equal(f.calls.filter(c => c[0] === 'attach').length, 2); assert.ok(f.attached.has(17));
});
test('disconnect releases idle targets; cached logs survive; closed tabs clear timers', async () => {
  const f = fixture(); await f.evaluate(); f.controller.event({ tabId: 17 }, 'Runtime.consoleAPICalled', { type: 'error', args: [{ value: 'kept' }] });
  await f.controller.releaseAll(); assert.ok(!f.attached.has(17)); assert.equal((await f.controller.execute('browser_logs', { tabId: 17 })).entries[0].text, 'kept');
  await f.evaluate(); f.attached.delete(17); f.events.removed(17); await f.advance(30000);
  assert.equal(f.controller.usage.has(17), false); assert.equal(f.controller.logs.has(17), false);
});
test('alarm catches expired timers and a fresh worker releases inherited owned targets', async () => {
  const f = fixture(); f.attached.add(17); await f.controller.releaseOrphans(); assert.ok(!f.attached.has(17));
  await f.evaluate(); await f.advance(31000, { fireTimers: false }); assert.ok(f.attached.has(17)); await f.controller.sweepIdle(); assert.ok(!f.attached.has(17));
});
