import { pageSnapshot, pageTarget, pageCondition, visiblePageText } from './page-functions.js';

export class ControlError extends Error {
  constructor(code, message) { super(message); this.name = 'ControlError'; this.code = code; }
}
export function callChrome(chrome, owner, method, ...args) {
  return new Promise((resolve, reject) => {
    if (typeof owner?.[method] !== 'function') { reject(new ControlError('API_UNAVAILABLE', `Browser does not expose ${method}.`)); return; }
    const timer = setTimeout(() => reject(new ControlError('BROWSER_API_TIMEOUT', `Browser API ${method} did not respond within 15 seconds.`)), 15000);
    try { owner[method](...args, value => { clearTimeout(timer); const error = chrome.runtime.lastError; if (error) reject(new ControlError('BROWSER_API_ERROR', error.message)); else resolve(value); }); }
    catch (error) { clearTimeout(timer); reject(error); }
  });
}
const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new ControlError('CANCELLED', 'Operation cancelled.')); return; }
  const stop = () => { clearTimeout(timer); reject(new ControlError('CANCELLED', 'Operation cancelled.')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
  signal?.addEventListener('abort', stop, { once: true });
});
const serialTab = tab => ({ id: tab.id, windowId: tab.windowId, index: tab.index, title: tab.title || '', url: tab.url || '', active: !!tab.active, status: tab.status || '', incognito: !!tab.incognito });
function allowedUrl(url) {
  if (url === 'about:blank') return url;
  let parsed; try { parsed = new URL(url); } catch { throw new ControlError('INVALID_URL', 'Provide an absolute URL.'); }
  if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) throw new ControlError('UNSUPPORTED_URL', 'Only http, https, file and about:blank pages are controllable.');
  return parsed.href;
}
export const DEBUGGER_IDLE_MS = 30000;
export class BrowserController {
  constructor(chrome, { idleMs = DEBUGGER_IDLE_MS, timers = globalThis, now = () => Date.now() } = {}) {
    Object.assign(this, { chrome, idleMs, timers, now });
    this.attached = new Map(); this.contexts = new Map(); this.logs = new Map(); this.signals = new Map();
    this.usage = new Map(); this.detaching = new Map(); this.lastRelease = null;
    chrome.debugger?.onEvent.addListener((source, method, params) => this.event(source, method, params));
    chrome.debugger?.onDetach.addListener(source => this.forget(source.tabId));
    chrome.tabs.onRemoved.addListener(tabId => { this.forget(tabId); this.logs.delete(tabId); });
  }
  call(owner, method, ...args) { return callChrome(this.chrome, owner, method, ...args); }
  forget(tabId) {
    this.attached.delete(tabId); this.contexts.delete(tabId);
    const entry = this.usage.get(tabId); this.timers.clearTimeout(entry?.timer);
    if (entry && entry.active === 0) this.usage.delete(tabId);
  }
  beginUse(tabId) {
    let entry = this.usage.get(tabId);
    if (!entry) { entry = { active: 0, lastUsed: this.now(), timer: null, releaseRequested: false }; this.usage.set(tabId, entry); }
    this.timers.clearTimeout(entry.timer); entry.timer = null; entry.active++;
    return entry;
  }
  armIdle(tabId, entry) {
    this.timers.clearTimeout(entry.timer);
    if (entry.active || !this.attached.has(tabId)) return;
    entry.timer = this.timers.setTimeout(() => { this.detachTab(tabId, 'idle').catch(() => {}); }, this.idleMs);
    entry.timer?.unref?.();
  }
  async endUse(tabId, entry) {
    entry.active--; entry.lastUsed = this.now();
    if (entry.active) return;
    if (entry.releaseRequested) await this.detachTab(tabId, 'disconnected');
    else if (this.attached.has(tabId)) this.armIdle(tabId, entry);
    else this.usage.delete(tabId);
  }
  detachTab(tabId, reason = 'idle') {
    if (this.detaching.has(tabId)) return this.detaching.get(tabId);
    const entry = this.usage.get(tabId);
    if (entry?.active) { if (reason === 'disconnected') entry.releaseRequested = true; return Promise.resolve(false); }
    this.timers.clearTimeout(entry?.timer);
    if (!this.attached.has(tabId)) { this.forget(tabId); return Promise.resolve(false); }
    const work = (async () => {
      await this.attached.get(tabId).catch(() => {});
      // A request that arrived before native detach started can keep using this attachment.
      if (this.usage.get(tabId)?.active) return false;
      try {
        await this.call(this.chrome.debugger, 'detach', { tabId });
        this.forget(tabId); this.lastRelease = { tabId, reason, at: new Date(this.now()).toISOString() }; return true;
      } catch (error) {
        // Retain ownership until detach is confirmed; alarms retry a failed release.
        this.lastRelease = { tabId, reason, error: error.message, at: new Date(this.now()).toISOString() };
        const current = this.usage.get(tabId); if (current) this.armIdle(tabId, current);
        throw error;
      }
    })().finally(() => { if (this.detaching.get(tabId) === work) this.detaching.delete(tabId); });
    this.detaching.set(tabId, work); return work;
  }
  async releaseAll() {
    const ids = new Set([...this.attached.keys(), ...this.usage.keys()]);
    for (const id of ids) { const entry = this.usage.get(id); if (entry) entry.releaseRequested = true; }
    await Promise.allSettled(Array.from(ids, id => this.detachTab(id, 'disconnected')));
  }
  async releaseOrphans() {
    if (!this.chrome.debugger?.getTargets) return;
    const targets = await this.call(this.chrome.debugger, 'getTargets');
    for (const target of targets) {
      if (!target.attached || target.tabId === undefined) continue;
      // Chrome allows detach only for this extension's own debugger sessions.
      try { await this.call(this.chrome.debugger, 'detach', { tabId: target.tabId }); this.forget(target.tabId); } catch {}
    }
  }
  async sweepIdle() {
    await Promise.allSettled(Array.from(this.usage, ([id, entry]) => {
      if (!entry.active && (entry.releaseRequested || this.now() - entry.lastUsed >= this.idleMs)) return this.detachTab(id, entry.releaseRequested ? 'disconnected' : 'idle');
    }));
  }
  async debuggingState() {
    const value = { idleTimeoutMs: this.idleMs, attachedTabIds: [...this.attached.keys()], busyTabIds: Array.from(this.usage).filter(([, e]) => e.active).map(([id]) => id), releasingTabIds: [...this.detaching.keys()], lastRelease: this.lastRelease };
    if (this.chrome.debugger?.getTargets) {
      try { value.targets = (await this.call(this.chrome.debugger, 'getTargets')).filter(t => t.tabId !== undefined).map(t => ({ tabId: t.tabId, attached: !!t.attached })); }
      catch (error) { value.queryError = error.message; }
    }
    return value;
  }
  async cdp(tabId, method, params = {}) {
    this.signals.get(tabId)?.throwIfAborted();
    try { return await this.call(this.chrome.debugger, 'sendCommand', { tabId }, method, params); }
    catch (error) {
      if (error.code === 'BROWSER_API_TIMEOUT') {
        // Retire the timed-out target before allowing queued operations to attach again.
        try { await this.call(this.chrome.debugger, 'detach', { tabId }); } catch {}
        this.attached.delete(tabId); this.contexts.delete(tabId);
      }
      throw error;
    }
  }
  event(source, method, params = {}) {
    const id = source.tabId; if (id === undefined) return;
    if (method === 'Runtime.executionContextCreated') {
      if (!this.contexts.has(id)) this.contexts.set(id, new Map());
      this.contexts.get(id).set(params.context.id, params.context);
    } else if (method === 'Runtime.executionContextDestroyed') this.contexts.get(id)?.delete(params.executionContextId);
    else if (method === 'Runtime.executionContextsCleared') this.contexts.get(id)?.clear();
    let entry;
    if (method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(params.type)) entry = { kind: 'console', level: params.type, text: (params.args || []).map(a => String(a.value ?? a.description ?? '')).join(' ').slice(0, 4000) };
    if (method === 'Runtime.exceptionThrown') entry = { kind: 'exception', text: String(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || '').slice(0, 4000) };
    if (method === 'Network.loadingFailed') entry = { kind: 'request-failed', requestId: params.requestId, text: params.errorText, canceled: !!params.canceled };
    if (method === 'Network.responseReceived' && params.response?.status >= 400) entry = { kind: 'http-error', url: params.response.url, status: params.response.status };
    if (entry) { const list = this.logs.get(id) || []; list.push({ time: new Date().toISOString(), ...entry }); if (list.length > 500) list.shift(); this.logs.set(id, list); }
  }
  async attach(tabId) {
    await this.detaching.get(tabId);
    const tab = await this.call(this.chrome.tabs, 'get', tabId); allowedUrl(tab.url || 'about:blank');
    if (!this.chrome.debugger) throw new ControlError('DEBUGGER_UNAVAILABLE', 'This browser does not expose chrome.debugger; reliable page control is unavailable.');
    if (!this.attached.has(tabId)) {
      const promise = (async () => {
        try { await this.call(this.chrome.debugger, 'attach', { tabId }, '1.3'); }
        catch (error) {
          // A revived worker can inherit its extension's existing debugger attachment.
          // sendCommand succeeds only for our own attachment, not another debugger's.
          try { await this.cdp(tabId, 'Runtime.enable'); await this.cdp(tabId, 'Runtime.disable'); } catch { throw error; }
        }
        this.contexts.set(tabId, new Map());
        await this.cdp(tabId, 'Page.enable'); await this.cdp(tabId, 'Runtime.enable');
        await this.cdp(tabId, 'DOM.enable');
        try { await this.cdp(tabId, 'Network.enable'); } catch (error) { this.event({ tabId }, 'Runtime.consoleAPICalled', { type: 'warning', args: [{ value: `Network diagnostics unavailable: ${error.message}` }] }); }
      })();
      this.attached.set(tabId, promise);
      try { await promise; } catch (error) { this.attached.delete(tabId); try { await this.call(this.chrome.debugger, 'detach', { tabId }); } catch {} throw error; }
    } else await this.attached.get(tabId);
  }
  async context(tabId, frameId) {
    if (!frameId) return undefined;
    const entry = Array.from(this.contexts.get(tabId)?.values() || []).find(c => c.auxData?.frameId === frameId && c.auxData?.isDefault);
    if (!entry) throw new ControlError('FRAME_UNAVAILABLE', 'Frame execution context is unavailable. Out-of-process frames require additional browser support.');
    return entry.id;
  }
  async evaluate(tabId, expression, frameId, { awaitPromise = false } = {}) {
    const contextId = await this.context(tabId, frameId);
    const result = await this.cdp(tabId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise, timeout: 5000, ...(contextId === undefined ? {} : { contextId }) });
    if (result.exceptionDetails) {
      const message = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Page evaluation failed.';
      const code = /^([A-Z_]+):/.exec(message.replace(/^Error: /, ''))?.[1] || 'PAGE_EVALUATION_FAILED';
      throw new ControlError(code, message.slice(0, 4000));
    }
    if (result.result?.subtype === 'error') throw new ControlError('PAGE_EVALUATION_FAILED', result.result.description);
    if (result.result?.type === 'undefined') return null;
    if (!('value' in (result.result || {}))) throw new ControlError('NON_JSON_RESULT', 'Expression must return a JSON-serializable value.');
    return result.result.value;
  }
  page(tabId, fn, args, frameId) { return this.evaluate(tabId, `(()=>{const visiblePageText=(${visiblePageText.toString()});return (${fn.toString()})(${JSON.stringify(args)});})()`, frameId); }
  async frameOffset(tabId, frameId) {
    if (!frameId) return { x: 0, y: 0 };
    const { frameTree } = await this.cdp(tabId, 'Page.getFrameTree');
    if (frameTree.frame.id === frameId) return { x: 0, y: 0 };
    const owner = await this.cdp(tabId, 'DOM.getFrameOwner', { frameId });
    const { model } = await this.cdp(tabId, 'DOM.getBoxModel', { backendNodeId: owner.backendNodeId });
    return { x: model.content[0], y: model.content[1] };
  }
  async point(tabId, args, focus = false, observe = false) {
    if (!args.ref && !args.selector) {
      if (!Number.isFinite(args.x) || !Number.isFinite(args.y)) throw new ControlError('ELEMENT_REQUIRED', 'Specify an element or x/y coordinates.');
      return { x: args.x, y: args.y, editable: false };
    }
    const point = await this.page(tabId, pageTarget, { ...args, focus, observe }, args.frameId);
    const offset = await this.frameOffset(tabId, args.frameId);
    point.x += offset.x; point.y += offset.y;
    if (point.bounds) { point.bounds.x += offset.x; point.bounds.y += offset.y; }
    return point;
  }
  async press(tabId, chord) {
    if (!chord) throw new ControlError('KEY_REQUIRED', 'press requires key.');
    const parts = chord.split('+'), raw = parts.pop();
    let modifiers = 0;
    for (const part of parts) { const mod = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Command: 4, Shift: 8 }[part]; if (!mod) throw new ControlError('INVALID_KEY', `Unknown modifier ${part}.`); modifiers |= mod; }
    const keys = { Enter: [13, 'Enter'], Tab: [9, 'Tab'], Escape: [27, 'Escape'], Backspace: [8, 'Backspace'], Delete: [46, 'Delete'], ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'], ArrowRight: [39, 'ArrowRight'], ArrowDown: [40, 'ArrowDown'], Home: [36, 'Home'], End: [35, 'End'], PageUp: [33, 'PageUp'], PageDown: [34, 'PageDown'], Space: [32, 'Space'] };
    const key = raw === 'Space' ? ' ' : raw;
    let keyCode, code;
    if (keys[raw]) [keyCode, code] = keys[raw];
    else if (/^[a-zA-Z0-9]$/.test(raw)) { keyCode = raw.toUpperCase().charCodeAt(0); code = /[0-9]/.test(raw) ? `Digit${raw}` : `Key${raw.toUpperCase()}`; }
    else throw new ControlError('INVALID_KEY', `Unsupported key ${raw}. Use type for text.`);
    const params = { key, code, modifiers, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await this.cdp(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
    if (raw === 'Enter') await this.cdp(tabId, 'Input.dispatchKeyEvent', { type: 'char', ...params, text: '\r', unmodifiedText: '\r' });
    else if (raw === 'Space' && modifiers === 0) await this.cdp(tabId, 'Input.dispatchKeyEvent', { type: 'char', ...params, text: ' ' });
    await this.cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  }
  async action(args, signal) {
    const { tabId, action } = args;
    signal?.throwIfAborted();
    if (action === 'press') { if (args.ref || args.selector) await this.point(tabId, args, true); await this.press(tabId, args.key); return { tabId, action }; }
    if (action === 'select') {
      if (args.value === undefined) throw new ControlError('VALUE_REQUIRED', 'select requires value.');
      const result = await this.page(tabId, pageTarget, { ...args, selectValue: args.value }, args.frameId); return { tabId, action, value: result.selectedValue };
    }
    if (action === 'scroll') {
      const point = args.ref || args.selector || args.x !== undefined ? await this.point(tabId, args) : { x: 200, y: 200 };
      await this.cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: args.deltaX || 0, deltaY: args.deltaY ?? 600 }); return { tabId, action };
    }
    const point = await this.point(tabId, args, action === 'fill' || action === 'type');
    if (['fill', 'type'].includes(action)) {
      if (typeof args.text !== 'string') throw new ControlError('TEXT_REQUIRED', `${action} requires text.`);
      if (!point.editable) throw new ControlError('NOT_EDITABLE', 'Target is not a text input or contenteditable element.');
      if (['file', 'checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(point.inputType)) throw new ControlError('NOT_TEXT_INPUT', 'Target does not accept text input.');
      if (action === 'fill') { await this.press(tabId, 'Control+A'); signal?.throwIfAborted(); await this.press(tabId, 'Backspace'); }
      signal?.throwIfAborted(); if (args.text) await this.cdp(tabId, 'Input.insertText', { text: args.text }); return { tabId, action };
    }
    await this.cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    if (action !== 'hover') {
      for (let count = 1; count <= (action === 'doubleClick' ? 2 : 1); count++) {
        signal?.throwIfAborted();
        await this.cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: count });
        await this.cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: count });
      }
    }
    return { tabId, action };
  }
  async execute(method, args, signal) {
    const lease = args.tabId !== undefined && method !== 'browser_tabs' && method !== 'browser_logs' ? this.beginUse(args.tabId) : null;
    if (args.tabId !== undefined) this.signals.set(args.tabId, signal);
    try { return await this.executeCommand(method, args, signal); }
    finally {
      if (args.tabId !== undefined) this.signals.delete(args.tabId);
      if (lease) await this.endUse(args.tabId, lease);
    }
  }
  async executeCommand(method, args, signal) {
    signal?.throwIfAborted();
    if (method === 'browser_open') {
      const url = allowedUrl(args.url || 'about:blank');
      const tab = await this.call(this.chrome.tabs, 'create', { url: 'about:blank', active: args.active ?? true, ...(args.windowId === undefined ? {} : { windowId: args.windowId }) });
      signal?.throwIfAborted();
      const lease = this.beginUse(tab.id); this.signals.set(tab.id, signal);
      try {
        await this.attach(tab.id);
        if (url !== 'about:blank') { const result = await this.cdp(tab.id, 'Page.navigate', { url }); if (result.errorText) throw new ControlError('NAVIGATION_FAILED', result.errorText); }
        return { ...serialTab(await this.call(this.chrome.tabs, 'get', tab.id)), url };
      } catch (error) { error.message = `${error.message} (new tab ${tab.id} remains available for inspection)`; throw error; }
      finally { this.signals.delete(tab.id); await this.endUse(tab.id, lease); }
    }
    if (method === 'browser_tabs') {
      if (args.action === 'list') return { tabs: (await this.call(this.chrome.tabs, 'query', {})).filter(t => !t.incognito).map(serialTab), debugging: await this.debuggingState() };
      if (args.action === 'close') { await this.call(this.chrome.tabs, 'remove', args.tabId); return { closed: args.tabId }; }
      if (args.action === 'activate') { const tab = await this.call(this.chrome.tabs, 'update', args.tabId, { active: true }); await this.call(this.chrome.windows, 'update', tab.windowId, { focused: true }); return serialTab(tab); }
      if (args.action === 'duplicate') return serialTab(await this.call(this.chrome.tabs, 'duplicate', args.tabId));
      throw new ControlError('INVALID_ACTION', 'Unsupported tab action.');
    }
    if (method === 'browser_logs') { const tab = await this.call(this.chrome.tabs, 'get', args.tabId); if (tab.incognito) throw new ControlError('UNSUPPORTED_TAB', 'Private windows are not controlled.'); const entries = (this.logs.get(args.tabId) || []).slice(-Math.min(Math.max(args.limit ?? 100, 1), 500)); if (args.clear) this.logs.set(args.tabId, []); return { tabId: args.tabId, entries }; }
    await this.attach(args.tabId); signal?.throwIfAborted();
    if (method === 'browser_navigate') {
      if (args.action === 'goto') { const result = await this.cdp(args.tabId, 'Page.navigate', { url: allowedUrl(args.url) }); if (result.errorText) throw new ControlError('NAVIGATION_FAILED', result.errorText); }
      else if (args.action === 'reload') await this.cdp(args.tabId, 'Page.reload');
      else if (['back', 'forward'].includes(args.action)) {
        const history = await this.cdp(args.tabId, 'Page.getNavigationHistory');
        const entry = history.entries[history.currentIndex + (args.action === 'back' ? -1 : 1)];
        if (!entry) throw new ControlError('NO_HISTORY_ENTRY', 'No navigation history entry in that direction.');
        await this.cdp(args.tabId, 'Page.navigateToHistoryEntry', { entryId: entry.id });
      } else throw new ControlError('INVALID_ACTION', 'Unsupported navigation action.');
      return { tabId: args.tabId, action: args.action };
    }
    if (method === 'browser_snapshot') {
      const snapshot = await this.page(args.tabId, pageSnapshot, args, args.frameId);
      const { frameTree } = await this.cdp(args.tabId, 'Page.getFrameTree');
      const frames = []; function visit(tree) { frames.push({ id: tree.frame.id, parentId: tree.frame.parentId || null, url: tree.frame.url, name: tree.frame.name || '' }); for (const child of tree.childFrames || []) visit(child); } visit(frameTree);
      return { tabId: args.tabId, ...snapshot, frames };
    }
    if (method === 'browser_action') return this.action(args, signal);
    if (method === 'browser_evaluate') return { tabId: args.tabId, value: await this.evaluate(args.tabId, args.expression, args.frameId) };
    if (method === 'browser_wait') {
      const end = Date.now() + Math.min(Math.max(args.timeoutMs ?? 10000, 1), 120000);
      do {
        signal?.throwIfAborted();
        try { if (await this.page(args.tabId, pageCondition, args, args.frameId)) return { tabId: args.tabId, matched: true }; }
        catch (error) { if (!/context|navigat|Cannot find/i.test(error.message)) throw error; }
        await wait(Math.min(200, Math.max(end - Date.now(), 0)), signal);
      } while (Date.now() < end);
      throw new ControlError('CONDITION_TIMEOUT', 'Timed out waiting for the page condition.');
    }
    if (method === 'browser_screenshot') {
      const metrics = await this.cdp(args.tabId, 'Page.getLayoutMetrics');
      const viewport = metrics.cssVisualViewport || metrics.visualViewport;
      let clip;
      if (args.ref || args.selector) { const point = await this.point(args.tabId, args, false, true); const after = await this.cdp(args.tabId, 'Page.getLayoutMetrics'); const layout = after.cssLayoutViewport || after.layoutViewport; clip = { ...point.bounds, x: point.bounds.x + layout.pageX, y: point.bounds.y + layout.pageY, scale: 1 }; }
      else if (args.fullPage) { const content = metrics.cssContentSize || metrics.contentSize; clip = { x: content.x, y: content.y, width: content.width, height: content.height, scale: 1 }; }
      if (clip && (clip.width > 32768 || clip.height > 32768 || clip.width * clip.height > 40000000)) throw new ControlError('SCREENSHOT_TOO_LARGE', 'Page exceeds screenshot limits. Capture the viewport or an element.');
      const result = await this.cdp(args.tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: !!clip, ...(clip ? { clip } : {}) });
      return { data: result.data, cssViewport: { width: viewport.clientWidth, height: viewport.clientHeight, pageX: viewport.pageX, pageY: viewport.pageY } };
    }
    throw new ControlError('UNKNOWN_COMMAND', 'Unknown browser command.');
  }
}
