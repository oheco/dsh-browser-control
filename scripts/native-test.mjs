import { loadConnection } from '../server.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const config = await loadConnection();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = { startedAt: new Date().toISOString(), steps: [], screenshots: [], tabs: [] };
async function call(tool, args = {}) {
  const response = await fetch(`http://127.0.0.1:${config.port}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` }, body: JSON.stringify({ tool, args }) });
  const result = await response.json();
  if (!result.ok) { const error = new Error(result.error.message); error.code = result.error.code; throw error; }
  return result.value;
}
async function step(name, operation) { await operation(); report.steps.push(name); console.log('PASS', name); }
let tab;
try {
  report.browser = (await call('browser_status')).browser;
  await step('local page with root-relative CSS and JavaScript', async () => {
    tab = await call('browser_open', { path: path.join(root, 'test/fixtures'), active: true }); report.tabs.push(tab.id);
    assert.equal(new URL(tab.url).pathname, '/index.html');
    await call('browser_wait', { tabId: tab.id, text: '页面和根路径资源已加载', timeoutMs: 15000 });
  });
  let snapshot = await call('browser_snapshot', { tabId: tab.id, maxElements: 40, maxText: 4000 });
  const firstRef = snapshot.elements.find(e => e.name === '用户名').ref;
  await step('password values omitted from snapshots', async () => { assert.ok(!JSON.stringify(snapshot).includes('fixture-private-value')); });
  await step('Chinese fill, append, selection, checkbox, keyboard and submission', async () => {
    await call('browser_action', { tabId: tab.id, action: 'fill', ref: firstRef, text: '鸿蒙测试' });
    await call('browser_action', { tabId: tab.id, action: 'type', ref: firstRef, text: ' PC' });
    await call('browser_action', { tabId: tab.id, action: 'press', ref: firstRef, key: 'Tab' });
    assert.equal((await call('browser_evaluate', { tabId: tab.id, expression: 'document.activeElement.id' })).value, 'password');
    await call('browser_action', { tabId: tab.id, action: 'select', selector: '#country', value: 'DE' });
    await call('browser_action', { tabId: tab.id, action: 'click', selector: '#subscribe' });
    await call('browser_action', { tabId: tab.id, action: 'click', selector: '#submit' });
    await call('browser_wait', { tabId: tab.id, text: '欢迎，鸿蒙测试 PC；地区 DE；订阅 true' });
  });
  await step('native hover and double click events', async () => {
    await call('browser_action', { tabId: tab.id, action: 'hover', selector: '#hover' });
    await call('browser_wait', { tabId: tab.id, text: '悬停成功' });
    await call('browser_action', { tabId: tab.id, action: 'doubleClick', selector: '#double' });
    await call('browser_wait', { tabId: tab.id, text: '双击成功' });
  });
  await step('open Shadow DOM interaction and visible text waiting', async () => {
    await call('browser_action', { tabId: tab.id, action: 'click', selector: 'test-counter >>> #increment' });
    await call('browser_wait', { tabId: tab.id, text: '计数 1' });
    snapshot = await call('browser_snapshot', { tabId: tab.id });
    assert.ok(snapshot.text.includes('计数 1')); assert.ok(!snapshot.text.includes('隐藏 shadow 内容'));
  });
  await step('outdated element reference is rejected', async () => {
    await assert.rejects(call('browser_wait', { tabId: tab.id, ref: firstRef, state: 'hidden', timeoutMs: 200 }), { code: 'STALE_ELEMENT' });
  });
  await step('viewport, full page and disabled-element PNG screenshots', async () => {
    for (const args of [{}, { fullPage: true }, { selector: '#disabled' }]) {
      const value = await call('browser_screenshot', { tabId: tab.id, ...args }); assert.ok(value.bytes > 100); assert.ok(value.width > 0 && value.height > 0); report.screenshots.push(value);
    }
  });
  await step('iframe context, scrolled frame click and element screenshot', async () => {
    const frame = snapshot.frames.find(f => f.name === 'frame'); assert.ok(frame);
    await call('browser_action', { tabId: tab.id, frameId: frame.id, action: 'click', selector: '#framebutton' });
    await call('browser_wait', { tabId: tab.id, frameId: frame.id, text: 'Frame 点击成功' });
    const image = await call('browser_screenshot', { tabId: tab.id, frameId: frame.id, selector: '#framebutton' }); assert.ok(image.width > 10); report.screenshots.push(image);
  });
  await step('scroll and offscreen element action', async () => {
    await call('browser_action', { tabId: tab.id, action: 'scroll', deltaY: 700 });
    await call('browser_action', { tabId: tab.id, action: 'click', selector: '#bottom' });
    await call('browser_wait', { tabId: tab.id, text: '底部点击成功' });
  });
  await step('console startup error and HTTP 404 diagnostics', async () => {
    const logs = await call('browser_logs', { tabId: tab.id, limit: 100 });
    assert.ok(logs.entries.some(e => e.text?.includes('fixture-start-error')), 'Startup console error must be captured before navigation');
    assert.ok(logs.entries.some(e => e.status === 404)); report.logs = logs.entries;
  });
  await step('tab duplicate, activation and close', async () => {
    const duplicate = await call('browser_tabs', { action: 'duplicate', tabId: tab.id }); report.tabs.push(duplicate.id);
    await call('browser_tabs', { action: 'activate', tabId: duplicate.id }); await call('browser_tabs', { action: 'close', tabId: duplicate.id }); report.tabs = report.tabs.filter(id => id !== duplicate.id);
    await call('browser_tabs', { action: 'activate', tabId: tab.id });
  });
  await step('navigation, history back/forward and reload', async () => {
    const frameUrl = new URL('/frame.html', tab.url).href;
    await call('browser_navigate', { tabId: tab.id, action: 'goto', url: frameUrl }); await call('browser_wait', { tabId: tab.id, text: 'frame 顶部' });
    await call('browser_navigate', { tabId: tab.id, action: 'back' }); await call('browser_wait', { tabId: tab.id, text: '页面和根路径资源已加载' });
    await call('browser_navigate', { tabId: tab.id, action: 'forward' }); await call('browser_wait', { tabId: tab.id, text: 'frame 顶部' });
    await call('browser_navigate', { tabId: tab.id, action: 'reload' }); await call('browser_wait', { tabId: tab.id, text: 'frame 顶部' });
  });
  report.ok = true;
} catch (error) {
  report.ok = false; report.error = { code: error.code || 'ASSERTION_FAILED', message: error.message }; console.error('FAIL', report.error.code, report.error.message); process.exitCode = 1;
} finally {
  for (const id of report.tabs) { try { await call('browser_tabs', { action: 'close', tabId: id }); } catch {} }
  report.finishedAt = new Date().toISOString();
  const directory = path.join(process.env.XDG_CACHE_HOME, 'dsh-browser-control', 'verification'); await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'native-test.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, completed: report.steps.length, report: path.join(directory, 'native-test.json') }));
}
