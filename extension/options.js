const form = document.querySelector('#settings');
const message = document.querySelector('#message');
const labels = { connected: '已连接 dsh', reconnecting: '等待 dsh，自动重试中', connecting: '正在连接', unconfigured: '需要完成首次配置', disabled: '自动连接已停用', error: '连接错误', 'invalid-config': '配置无效', starting: '正在启动' };
function show(status) { document.querySelector('#status').textContent = `${labels[status.status] || status.status}\n${status.endpoint || ''}${status.detail ? '\n' + status.detail : ''}`; }
chrome.storage.local.get(['connection', 'connectionStatus'], data => {
  if (data.connection) { form.endpoint.value = data.connection.endpoint; form.token.value = data.connection.token; form.enabled.checked = data.connection.enabled !== false; }
  if (data.connectionStatus) show(data.connectionStatus);
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.connectionStatus) show(changes.connectionStatus.newValue); });
form.addEventListener('submit', event => {
  event.preventDefault(); message.textContent = '正在保存…';
  chrome.runtime.sendMessage({ type: 'configure', connection: { endpoint: form.endpoint.value.trim(), token: form.token.value.trim(), enabled: form.enabled.checked } }, result => {
    const error = chrome.runtime.lastError;
    message.textContent = error ? error.message : result?.ok ? '已保存，扩展会自动连接。' : result?.error || '保存失败';
  });
});
chrome.runtime.sendMessage({ type: 'status' }, result => { if (!chrome.runtime.lastError && result?.ok) show(result.value); });
