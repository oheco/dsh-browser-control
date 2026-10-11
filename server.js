import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, stat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WebSocketServer } from './tpr/ws/wrapper.mjs';

export const DEFAULT_PORT = 9227;
export const PROTOCOL_VERSION = 1;
export class BrowserError extends Error {
  constructor(code, message) { super(message); this.name = 'BrowserError'; this.code = code; }
}
function equalToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function connectionDirectory() {
  // hmdfs HOME cannot enforce permissions on HarmonyOS. XDG_CONFIG_HOME is real private storage.
  if (process.platform === 'openharmony' && !process.env.XDG_CONFIG_HOME) throw new BrowserError('PRIVATE_CONFIG_REQUIRED', 'Set XDG_CONFIG_HOME to application-private storage.');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'dsh-browser-control');
}
export async function loadConnection({ directory = connectionDirectory(), port } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await stat(directory)).mode & 0o077) throw new BrowserError('UNSAFE_CONFIG_DIRECTORY', 'Browser credentials require a private directory with mode 0700; do not use HarmonyOS HOME.');
  const file = path.join(directory, 'connection.json');
  let config;
  try { config = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    config = { version: 1, port: port ?? DEFAULT_PORT, token: randomBytes(32).toString('hex') };
    try { await writeFile(file, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; config = JSON.parse(await readFile(file, 'utf8')); }
  }
  if ((await stat(file)).mode & 0o077) throw new BrowserError('UNSAFE_CONFIG_FILE', 'Browser credentials require mode 0600 in application-private storage.');
  if (config.version !== 1 || !/^[a-f0-9]{64}$/.test(config.token) || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new BrowserError('INVALID_CONFIG', 'Invalid browser connection configuration.');
  if (port !== undefined && port !== config.port) throw new BrowserError('PORT_CONFIG_MISMATCH', 'Update the saved connection port and extension settings together.');
  return { ...config, file, endpoint: `ws://127.0.0.1:${config.port}/browser` };
}
const MIME = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8' };
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
export class BrowserBridge {
  constructor({ port = DEFAULT_PORT, token, requestTimeout = 45000, extensionId, onState = () => {}, rpc } = {}) {
    if (!token) throw new BrowserError('TOKEN_REQUIRED', 'A browser connection token is required.');
    Object.assign(this, { port, token, requestTimeout, extensionId, onState, rpc });
    this.pending = new Map(); this.mounts = new Map(); this.peer = null; this.browser = null;
    this.connectedAt = null; this.lastSeen = null; this.closed = false;
  }
  status() {
    return { protocol: PROTOCOL_VERSION, listening: !!this.server?.listening, connected: !!this.peer, endpoint: `ws://127.0.0.1:${this.port}/browser`, connectedAt: this.connectedAt, lastSeen: this.lastSeen, browser: this.browser, pendingRequests: this.pending.size };
  }
  emitState() { this.onState(this.status()); }
  async start() {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024 * 1024, perMessageDeflate: false });
    this.server = http.createServer((req, res) => this.http(req, res).catch(error => {
      if (!res.headersSent) { res.writeHead(error.code === 'ENOENT' ? 404 : 400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: error.code || 'HTTP_ERROR', message: error.message } })); }
      else res.destroy();
    }));
    this.server.on('upgrade', (req, socket, head) => {
      const origin = req.headers.origin;
      const validOrigin = typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin) && (!this.extensionId || origin === `chrome-extension://${this.extensionId}`);
      if (req.url !== '/browser' || !validOrigin) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
      this.wss.handleUpgrade(req, socket, head, ws => this.accept(ws, origin));
    });
    await new Promise((resolve, reject) => {
      const failed = error => { this.wss.close(); reject(error); };
      this.server.once('error', failed);
      this.server.listen(this.port, '127.0.0.1', () => { this.server.off('error', failed); resolve(); });
    });
    this.port = this.server.address().port;
    this.heartbeat = setInterval(() => {
      if (this.peer && Date.now() - this.lastSeen > 65000) this.peer.terminate();
    }, 20000); this.heartbeat.unref();
    this.emitState(); return this;
  }
  accept(ws, origin) {
    let authenticated = false;
    const timer = setTimeout(() => ws.close(1008, 'Authentication timeout'), 5000); timer.unref();
    ws.on('error', () => {});
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { ws.close(1008, 'Invalid JSON'); return; }
      if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) { ws.close(1008, 'Invalid message'); return; }
      if (!authenticated) {
        if (msg.type !== 'hello' || msg.protocol !== PROTOCOL_VERSION || !equalToken(msg.token, this.token)) { ws.close(1008, 'Authentication failed'); return; }
        if (this.peer && this.peer !== ws) { ws.close(1008, 'Another browser is already connected'); return; }
        clearTimeout(timer); authenticated = true; this.peer = ws;
        const b = msg.browser || {};
        this.browser = { extensionId: origin.slice('chrome-extension://'.length), extensionVersion: String(b.extensionVersion || '').slice(0, 80), userAgent: String(b.userAgent || '').slice(0, 500), capabilities: Array.isArray(b.capabilities) ? b.capabilities.filter(x => typeof x === 'string').slice(0, 30) : [] };
        this.connectedAt = new Date().toISOString(); this.lastSeen = Date.now();
        ws.send(JSON.stringify({ type: 'ready', protocol: PROTOCOL_VERSION })); this.emitState(); return;
      }
      this.lastSeen = Date.now();
      if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
      if (msg.type === 'result' && typeof msg.id === 'string') {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id); pending.cleanup();
        if (msg.ok === true) pending.resolve(msg.value ?? null);
        else pending.reject(new BrowserError(String(msg.error?.code || 'BROWSER_OPERATION_FAILED'), String(msg.error?.message || 'Browser operation failed.')));
      }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (this.peer !== ws) return;
      this.peer = null; this.browser = null; this.connectedAt = null;
      for (const [id, pending] of this.pending) {
        this.pending.delete(id); pending.cleanup();
        pending.reject(new BrowserError('CONNECTION_LOST', 'Browser disconnected. The operation may have executed; inspect page state before retrying. It will not be replayed automatically.'));
      }
      this.emitState();
    });
  }
  request(method, params = {}, { signal, timeout = this.requestTimeout } = {}) {
    if (signal?.aborted) return Promise.reject(new BrowserError('CANCELLED', 'Browser operation cancelled before dispatch.'));
    if (!this.peer || this.peer.readyState !== 1) return Promise.reject(new BrowserError('BROWSER_OFFLINE', 'Browser extension is offline. It reconnects automatically; check browser_status or extension settings.'));
    const id = randomUUID(), peer = this.peer;
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      const cancel = (code, message) => {
        if (!this.pending.delete(id)) return;
        cleanup(); if (peer.readyState === 1) peer.send(JSON.stringify({ type: 'cancel', id }));
        reject(new BrowserError(code, message));
      };
      const abort = () => cancel('CANCELLED', 'Browser operation cancelled; inspect state before retrying an action.');
      const timer = setTimeout(() => cancel('BROWSER_TIMEOUT', 'Browser operation timed out; inspect state before retrying an action.'), timeout);
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      peer.send(JSON.stringify({ type: 'command', id, method, params }), error => {
        if (!error || !this.pending.delete(id)) return;
        cleanup(); reject(new BrowserError('SEND_FAILED', 'Unable to send browser operation.'));
      });
    });
  }
  async mount(input, { root } = {}) {
    const file = await realpath(input);
    const info = await stat(file);
    const directory = await realpath(root || (info.isDirectory() ? file : path.dirname(file)));
    if (!(await stat(directory)).isDirectory() || !inside(directory, file)) throw new BrowserError('INVALID_LOCAL_ROOT', 'Local page must be inside its served directory.');
    let entry = Array.from(this.mounts.values()).find(m => m.root === directory);
    if (!entry) {
      if (this.mounts.size >= 32) throw new BrowserError('TOO_MANY_LOCAL_PROJECTS', 'Close or restart the plugin before serving more than 32 local projects.');
      const id = randomBytes(24).toString('hex');
      const server = http.createServer((req, res) => this.serveLocal(req, res, directory, server.address()?.port).catch(error => {
        if (!res.headersSent) { res.writeHead(error.code === 'ENOENT' ? 404 : 400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: error.code || 'LOCAL_RESOURCE_ERROR', message: error.message } })); }
        else res.destroy();
      }));
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      entry = { id, root: directory, server, port: server.address().port }; this.mounts.set(id, entry);
    }
    const relative = info.isDirectory() ? 'index.html' : path.relative(directory, file);
    return { mountId: entry.id, root: directory, url: `http://127.0.0.1:${entry.port}/${relative.split(path.sep).map(encodeURIComponent).join('/')}` };
  }
  async http(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
    const host = req.headers.host;
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) { res.writeHead(403); res.end(); return; }
    if (req.method === 'GET' && url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION })); return; }
    if (req.method === 'POST' && url.pathname === '/rpc') {
      if (req.headers.origin || !equalToken(req.headers.authorization?.replace(/^Bearer /, ''), this.token) || !this.rpc) { res.writeHead(403); res.end(); return; }
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1024 * 1024) throw new BrowserError('REQUEST_TOO_LARGE', 'Request too large.'); }
      const data = JSON.parse(body);
      const controller = new AbortController(); res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      try { const value = await this.rpc(data.tool, data.args || {}, controller.signal); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, value })); }
      catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: { code: error.code || 'RPC_FAILED', message: error.message } })); }
      return;
    }
    res.writeHead(404); res.end();
  }
  async serveLocal(req, res, root, port) {
    if (!['GET', 'HEAD'].includes(req.method) || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) { res.writeHead(403); res.end(); return; }
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const relative = decodeURIComponent(url.pathname.slice(1));
    if (relative.includes('\0') || relative.includes('\\')) throw new BrowserError('INVALID_PATH', 'Invalid local resource path.');
    let target = path.resolve(root, relative || 'index.html');
    if (!inside(root, target)) throw new BrowserError('OUTSIDE_LOCAL_ROOT', 'Resource is outside the local project.');
    target = await realpath(target);
    if (!inside(root, target)) throw new BrowserError('OUTSIDE_LOCAL_ROOT', 'Resource symlink escapes the local project.');
    if ((await stat(target)).isDirectory()) target = await realpath(path.join(target, 'index.html'));
    if (!inside(root, target)) throw new BrowserError('OUTSIDE_LOCAL_ROOT', 'Resource symlink escapes the local project.');
    const info = await stat(target);
    if (!info.isFile()) throw new BrowserError('INVALID_LOCAL_FILE', 'Resource is not a regular file.');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(target); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  }
  async close() {
    this.closed = true; clearInterval(this.heartbeat);
    for (const client of this.wss?.clients || []) client.terminate();
    await Promise.all(Array.from(this.mounts.values(), async entry => { entry.server.closeAllConnections(); await new Promise(resolve => entry.server.close(resolve)); }));
    this.mounts.clear();
    if (this.server) { this.server.closeAllConnections(); await new Promise(resolve => this.server.close(resolve)); }
    if (this.wss) await new Promise(resolve => this.wss.close(resolve));
  }
}
