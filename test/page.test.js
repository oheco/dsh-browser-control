import test from 'node:test';
import assert from 'node:assert/strict';
import { pageTarget, pageCondition, visiblePageText } from '../extension/page-functions.js';

function globals(t, values) {
  const old = Object.fromEntries(Object.keys(values).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, value] of Object.entries(values)) Object.defineProperty(globalThis, k, { value, writable: true, configurable: true });
  t.after(() => { for (const k of Object.keys(values)) if (old[k]) Object.defineProperty(globalThis, k, old[k]); else delete globalThis[k]; });
}
function element(overrides = {}) {
  return { tagName: 'BUTTON', isConnected: true, disabled: false, getAttribute: () => null, scrollIntoView() {}, focus() {}, getBoundingClientRect: () => ({ left: 12, top: 20, width: 100, height: 30 }), ...overrides };
}
test('unknown snapshot refs fail hidden waits; a known removed element satisfies hidden', t => {
  const doc = { body: { innerText: '' } }, removed = element({ isConnected: false });
  globals(t, { document: doc, __ohecoDshSnapshot: { document: doc, elements: new Map([['new-e1', removed]]) } });
  assert.throws(() => pageCondition({ ref: 'old-e1', state: 'hidden' }), /STALE_ELEMENT/);
  assert.equal(pageCondition({ ref: 'new-e1', state: 'hidden' }), true);
});
test('observational target lookup accepts disabled elements and uses viewport bounds', t => {
  const el = element({ disabled: true }), doc = { querySelector: () => el };
  globals(t, { document: doc, getComputedStyle: () => ({ visibility: 'visible', display: 'block' }), scrollX: 300, scrollY: 400 });
  assert.throws(() => pageTarget({ selector: 'button' }), /ELEMENT_DISABLED/);
  const target = pageTarget({ selector: 'button', observe: true }); assert.equal(target.bounds.y, 20); assert.equal(target.bounds.x, 12);
});
test('hidden select is rejected before changing its value or emitting events', t => {
  let mutations = 0;
  const el = element({ tagName: 'SELECT', value: 'old', options: [{ value: 'new', label: 'New' }], dispatchEvent() { mutations++; } });
  globals(t, { document: { querySelector: () => el }, getComputedStyle: () => ({ visibility: 'hidden', display: 'block' }) });
  assert.throws(() => pageTarget({ selector: 'select', selectValue: 'new' }), /ELEMENT_HIDDEN/);
  assert.equal(el.value, 'old'); assert.equal(mutations, 0);
});
test('visible text waits include open shadow roots and omit hidden shadow text', t => {
  const visible = { textContent: 'shadow ready', parentElement: { tagName: 'SPAN', hidden: false } };
  const hidden = { textContent: 'hidden secret', parentElement: { tagName: 'SPAN', hidden: true } };
  const shadow = { querySelectorAll: () => [] };
  const doc = { body: { innerText: 'outside' }, querySelectorAll: () => [{ shadowRoot: shadow }], createTreeWalker: () => { let i = 0; return { nextNode: () => [visible, hidden][i++] || null }; }, createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: 10, height: 10 }) }) };
  globals(t, { document: doc, NodeFilter: { SHOW_TEXT: 4 }, getComputedStyle: el => ({ display: 'block', visibility: el.hidden ? 'hidden' : 'visible' }) });
  assert.match(visiblePageText(), /shadow ready/); assert.ok(!visiblePageText().includes('hidden secret'));
  assert.equal(pageCondition({ text: 'shadow ready' }), true);
});
