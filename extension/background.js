import { BrowserController } from './controller.js';
import { AutoConnection, RETRY_ALARM } from './connection.js';

const connection = new AutoConnection({ chrome, controller: new BrowserController(chrome) });
// Register listeners synchronously so Chrome can wake a dormant service worker.
chrome.runtime.onStartup.addListener(() => connection.ensureAlarm().then(() => connection.connect()));
chrome.runtime.onInstalled.addListener(() => connection.ensureAlarm().then(() => connection.connect()));
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === RETRY_ALARM) connection.connect(); });
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.tab?.url && !sender.tab.url.startsWith(chrome.runtime.getURL(''))) return;
  if (message.type === 'configure') {
    connection.configure(message.connection).then(() => reply({ ok: true }), error => reply({ ok: false, error: error.message })); return true;
  }
  if (message.type === 'status') { reply({ ok: true, value: connection.status || { status: 'starting' } }); return; }
});
connection.initialize().catch(error => connection.state('error', error.message));
