import { callChrome } from './controller.js';

export const RETRY_ALARM = 'oheco-dsh-browser-reconnect';
export function validateEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.pathname !== '/browser' || !url.port || url.username || url.password || url.search || url.hash) throw new Error('连接地址必须为 ws://127.0.0.1:端口/browser');
  return url.href;
}
export class AutoConnection {
  constructor({ chrome, controller, WebSocketClass = WebSocket, timers = globalThis }) {
    Object.assign(this, { chrome, controller, WebSocketClass, timers });
    this.socket = null; this.ready = false; this.retryDelay = 1000; this.running = new Map(); this.queues = new Map(); this.generation = 0;
    this.config = { endpoint: 'ws://127.0.0.1:9227/browser', token: '', enabled: true };
  }
  call(owner, method, ...args) { return callChrome(this.chrome, owner, method, ...args); }
  async initialize() {
    const saved = await this.call(this.chrome.storage.local, 'get', ['connection']);
    this.config = { ...this.config, ...saved.connection };
    await this.ensureAlarm(); this.connect();
  }
  async ensureAlarm() {
    const existing = await this.call(this.chrome.alarms, 'get', RETRY_ALARM);
    if (!existing) await this.chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
  }
  async state(status, detail = '') {
    // Tokens are never placed in status, badges or logs.
    this.status = { status, detail, endpoint: this.config.endpoint, updatedAt: new Date().toISOString() };
    try { await this.call(this.chrome.storage.local, 'set', { connectionStatus: this.status }); }
    catch {}
    try {
      await this.call(this.chrome.action, 'setBadgeText', { text: status === 'connected' ? 'ON' : status === 'unconfigured' ? 'SET' : '…' });
      await this.call(this.chrome.action, 'setTitle', { title: `DSH 浏览器控制：${status}${detail ? ' — ' + detail : ''}` });
    } catch {}
  }
  connect() {
    if (this.config.enabled === false) { this.state('disabled'); return; }
    if (!/^[a-f0-9]{64}$/.test(this.config.token)) { this.state('unconfigured', '首次安装请在扩展设置中保存连接令牌'); return; }
    if (this.socket && [0, 1].includes(this.socket.readyState)) return;
    this.timers.clearTimeout(this.retryTimer);
    let endpoint; try { endpoint = validateEndpoint(this.config.endpoint); }
    catch (error) { this.state('invalid-config', error.message); return; }
    const generation = ++this.generation;
    const ws = this.socket = new this.WebSocketClass(endpoint);
    this.state('connecting');
    const timeout = this.timers.setTimeout(() => { if (!this.ready && this.socket === ws) ws.close(); }, 7000);
    const disconnect = () => {
      this.timers.clearTimeout(timeout);
      if (this.socket !== ws) return;
      this.timers.clearInterval(this.heartbeat); this.socket = null; this.ready = false;
      for (const { abort } of this.running.values()) abort.abort();
      this.running.clear();
      this.state('reconnecting', '等待 dsh；后台会自动重试');
      const delay = this.retryDelay; this.retryDelay = Math.min(this.retryDelay * 2, 30000);
      this.retryTimer = this.timers.setTimeout(() => this.connect(), delay);
    };
    ws.addEventListener('open', () => {
      if (this.socket !== ws) return;
      const capabilities = ['tabs', 'autoReconnect'];
      if (this.chrome.debugger?.attach && this.chrome.debugger?.sendCommand) capabilities.push('debugger', 'snapshot', 'input', 'screenshot', 'console', 'network');
      ws.send(JSON.stringify({ type: 'hello', protocol: 1, token: this.config.token, browser: { extensionVersion: this.chrome.runtime.getManifest().version, userAgent: globalThis.navigator?.userAgent || '', capabilities } }));
    });
    ws.addEventListener('message', event => {
      if (this.socket !== ws) return;
      let msg; try { msg = JSON.parse(event.data); } catch { ws.close(); return; }
      if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) { ws.close(); return; }
      if (msg.type === 'ready' && msg.protocol === 1) {
        this.timers.clearTimeout(timeout); this.ready = true; this.retryDelay = 1000; this.lastPong = Date.now(); this.state('connected');
        this.timers.clearInterval(this.heartbeat);
        this.heartbeat = this.timers.setInterval(() => { if (Date.now() - this.lastPong > 65000) ws.close(); else if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' })); }, 20000);
      } else if (msg.type === 'pong') this.lastPong = Date.now();
      else if (msg.type === 'command' && this.ready) this.command(ws, generation, msg);
      else if (msg.type === 'cancel') this.running.get(msg.id)?.abort.abort();
    });
    ws.addEventListener('close', disconnect);
    ws.addEventListener('error', () => { try { ws.close(); } catch { disconnect(); } });
  }
  command(ws, generation, msg) {
    if (typeof msg.id !== 'string' || typeof msg.method !== 'string' || !msg.params || this.running.has(msg.id)) return;
    const abort = new AbortController();
    this.running.set(msg.id, { abort });
    const key = msg.params.tabId ?? 'tabs';
    const previous = this.queues.get(key) || Promise.resolve();
    const work = previous.catch(() => {}).then(async () => {
      if (abort.signal.aborted || this.generation !== generation || this.socket !== ws) return;
      let result;
      try { const value = await this.controller.execute(msg.method, msg.params, abort.signal); abort.signal.throwIfAborted(); result = { type: 'result', id: msg.id, ok: true, value }; }
      catch (error) { result = { type: 'result', id: msg.id, ok: false, error: { code: error.code || (abort.signal.aborted ? 'CANCELLED' : 'BROWSER_OPERATION_FAILED'), message: error.message || 'Browser operation failed.' } }; }
      if (ws.readyState === 1 && this.socket === ws && this.generation === generation) ws.send(JSON.stringify(result));
    }).finally(() => { this.running.delete(msg.id); if (this.queues.get(key) === work) this.queues.delete(key); });
    this.queues.set(key, work);
  }
  async configure(config) {
    const endpoint = validateEndpoint(config.endpoint);
    if (!/^[a-f0-9]{64}$/.test(config.token)) throw new Error('令牌应为 64 位十六进制字符串');
    this.config = { endpoint, token: config.token, enabled: config.enabled !== false };
    await this.call(this.chrome.storage.local, 'set', { connection: this.config });
    this.disconnect(); await this.ensureAlarm(); this.connect();
  }
  disconnect() {
    this.generation++; this.timers.clearTimeout(this.retryTimer); this.timers.clearInterval(this.heartbeat);
    const ws = this.socket; this.socket = null; this.ready = false;
    for (const { abort } of this.running.values()) abort.abort(); this.running.clear();
    if (ws) ws.close();
  }
}
