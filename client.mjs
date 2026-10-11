window.__ModuleLoader__.load({
  id: '@oheco/dsh-browser-control',
  factory(require) {
    const React = require('react'), h = React.createElement;
    const labels = {
      zh: { title: '浏览器配对', intro: '将下面的连接地址和令牌填入浏览器扩展设置，保存一次即可自动连接。', address: '连接地址', token: '连接令牌', show: '显示令牌', hide: '隐藏令牌', copy: '复制令牌', copyAddress: '复制地址', copied: '已复制', failed: '操作失败', copyFailed: '复制失败，可显示令牌后手动选择复制', refresh: '刷新状态', connected: '浏览器已连接', offline: '等待浏览器扩展连接', waiting: '正在读取连接信息', idle: '页面操作结束后空闲 30 秒自动停止调试；下次使用时自动恢复。', open: '在浏览器中打开扩展设置，填入连接信息并勾选自动连接。' },
      en: { title: 'Browser pairing', intro: 'Enter the address and token in the browser extension settings once to enable automatic connection.', address: 'Connection address', token: 'Pairing token', show: 'Reveal token', hide: 'Hide token', copy: 'Copy token', copyAddress: 'Copy address', copied: 'Copied', failed: 'Operation failed', copyFailed: 'Copy failed. Reveal the token and select it to copy manually', refresh: 'Refresh status', connected: 'Browser connected', offline: 'Waiting for the browser extension', waiting: 'Loading connection information', idle: 'Debugging stops after 30 seconds without page requests and resumes automatically on the next request.', open: 'Open the extension settings, enter the connection details and enable automatic connection.' },
    };
    function PairingPanel({ view, t, readStatus, readPairing, subscribeReset }) {
      const [status, setStatus] = React.useState(null), [secret, setSecret] = React.useState(null), [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState('');
      const mounted = React.useRef(false), pending = React.useRef(null);
      React.useEffect(() => {
        mounted.current = true; const abort = new AbortController();
        readStatus(abort.signal).then(value => { if (!abort.signal.aborted) setStatus(value); }, error => { if (!abort.signal.aborted) setNotice(`${t('failed')}: ${error.message}`); });
        const remove = subscribeReset(() => { pending.current?.abort(); abort.abort(); setSecret(null); setStatus(null); setBusy(false); });
        return () => { mounted.current = false; abort.abort(); pending.current?.abort(); remove(); };
      }, [readStatus, subscribeReset]);
      if (view !== 'page') return null;
      const run = async operation => {
        const abort = new AbortController(); pending.current?.abort(); pending.current = abort; setBusy(true); setNotice('');
        try { await operation(abort.signal); }
        catch (error) { if (!abort.signal.aborted && mounted.current) setNotice(`${t('failed')}: ${error.message}`); }
        finally { if (pending.current === abort) { pending.current = null; if (mounted.current) setBusy(false); } }
      };
      const copy = async value => {
        if (typeof navigator.clipboard?.writeText !== 'function') throw new Error(t('copyFailed'));
        try { await navigator.clipboard.writeText(value); } catch { throw new Error(t('copyFailed')); }
        if (mounted.current) setNotice(t('copied'));
      };
      return h('section', { className: 'oheco-browser-pairing', 'aria-label': t('title') },
        h('style', null, '.oheco-browser-pairing{border:1px solid var(--dsw-alias-label-caption);border-radius:12px;padding:20px;display:grid;gap:14px;color:var(--dsw-alias-label-primary)}.oheco-browser-pairing h3{font-size:14px;line-height:22px;margin:0;font-weight:500}.oheco-browser-pairing p{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}.oheco-browser-pairing label{display:grid;gap:6px;font-size:13px}.oheco-browser-pairing input{box-sizing:border-box;width:100%;min-width:0;background:transparent;color:inherit;border:1px solid var(--dsw-alias-label-caption);border-radius:6px;padding:8px 10px;font:13px/20px ui-monospace,monospace}.oheco-browser-pairing button{color:inherit;background:transparent;border:1px solid var(--dsw-alias-label-caption);border-radius:6px;padding:7px 12px;font:inherit;cursor:pointer}.oheco-browser-pairing button:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}.oheco-browser-pairing button:disabled{opacity:.5;cursor:default}.oheco-browser-pairing :focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.oheco-browser-pairing .actions{display:flex;gap:8px;flex-wrap:wrap}'),
        h('h3', null, t('title')), h('p', null, t('intro')),
        h('p', { role: 'status', 'data-browser-connection': status?.connected ? 'connected' : 'offline' }, t(status ? (status.connected ? 'connected' : 'offline') : 'waiting')),
        h('label', null, t('address'), h('input', { 'aria-label': t('address'), readOnly: true, value: status?.endpoint || '' })),
        h('label', null, t('token'), h('input', { 'aria-label': t('token'), readOnly: true, type: secret ? 'text' : 'password', value: secret || '', placeholder: '••••••••••••••••', autoComplete: 'off', spellCheck: false })),
        h('div', { className: 'actions' },
          h('button', { type: 'button', disabled: busy || !status, onClick: () => secret ? setSecret(null) : run(async signal => { const value = await readPairing(signal); if (!signal.aborted && mounted.current) setSecret(value.token); }) }, t(secret ? 'hide' : 'show')),
          h('button', { type: 'button', disabled: busy || !status, onClick: () => run(async signal => { const value = await readPairing(signal); if (!signal.aborted) await copy(value.token); }) }, t('copy')),
          h('button', { type: 'button', disabled: busy || !status, onClick: () => run(() => copy(status.endpoint)) }, t('copyAddress')),
          h('button', { type: 'button', disabled: busy, onClick: () => run(async signal => { const value = await readStatus(signal); if (!signal.aborted && mounted.current) setStatus(value); }) }, t('refresh'))),
        h('p', { role: 'status' }, notice), h('p', null, t('open')), h('p', null, t('idle')));
    }
    return {
      inject: ['slots', 'connection', 'locale'],
      apply(ctx) {
        ctx.locale.register('oheco.browser', labels);
        const request = async (endpoint, signal) => { const response = await fetch(`/api/oheco-browser-control/${endpoint}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal }); if (!response.ok) throw new Error(`HTTP ${response.status}`); const result = await response.json(); if (!result.ok) throw new Error(result.error.message); return result.value; };
        const actions = { readStatus: signal => request('status', signal), readPairing: signal => request('pairing', signal), subscribeReset: listener => ctx.on('connection/reset', listener) };
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: '@oheco/dsh-browser-control', locale: 'oheco.browser', inject: () => actions }, PairingPanel));
      },
    };
  },
});
