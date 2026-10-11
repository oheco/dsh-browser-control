// Development helper: use only observed accessibility controls, never stale coordinates.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const run = promisify(execFile);
const root = path.join(process.env.XDG_CACHE_HOME, 'dsh-browser-control', 'verification');
await mkdir(root, { recursive: true });
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
export async function hdc(...args) { const { stdout } = await run('hdc', ['shell', args.map(quote).join(' ')], { maxBuffer: 2000000 }); if (/error:|Error occurred/i.test(stdout)) throw new Error('Device operation failed'); return stdout; }
export async function layout() {
  await hdc('uitest', 'dumpLayout', '-p', '/data/local/tmp/dsh-browser-control-layout.json');
  const file = path.join(root, 'layout.json'); await run('hdc', ['file', 'recv', '/data/local/tmp/dsh-browser-control-layout.json', file]);
  const tree = JSON.parse(await readFile(file, 'utf8')), nodes = [];
  function visit(node) { nodes.push(node.attributes || {}); for (const child of node.children || []) visit(child); } visit(tree);
  return nodes;
}
export function center(node) { const values = node.bounds?.match(/\d+/g)?.map(Number); if (values?.length !== 4) throw new Error('Invalid UI bounds'); return [Math.round((values[0] + values[2]) / 2), Math.round((values[1] + values[3]) / 2)]; }
export async function clickText(text) {
  const nodes = await layout(), node = nodes.find(n => n.text === text && n.visible !== 'false');
  if (!node) throw new Error(`Control unavailable: ${text}`); await hdc('uitest', 'uiInput', 'click', ...center(node));
}
async function main() {
  if (process.argv[2] === 'open-manager') {
    await hdc('aa', 'start', '-b', 'com.huawei.hmos.browser', '-a', 'MainAbility');
    let nodes = await layout();
    if (!nodes.some(n => n.bundleName === 'com.huawei.hmos.browser')) throw new Error('Browser is not foreground; no keyboard input sent.');
    if (nodes.some(n => /安全证书|是否继续访问/.test(n.text))) throw new Error('An existing website dialog is open; no UI input sent.');
    await hdc('uitest', 'uiInput', 'keyEvent', '2072', '2036');
    nodes = await layout();
    const address = nodes.find(n => n.type === 'TextInput' && /\[\d+,91\]/.test(n.bounds));
    if (!address) throw new Error('New tab address bar unavailable.');
    await hdc('uitest', 'uiInput', 'inputText', ...center(address), 'hwbrowser://extensions');
    await hdc('uitest', 'uiInput', 'keyEvent', '2054');
    nodes = await layout();
    if (!nodes.some(n => n.text === '加载已解压的扩展程序')) throw new Error('Extension manager did not appear; no install click sent.');
    console.log('Extension manager is visible.');
  } else if (process.argv[2] === 'load-folder') {
    await clickText('加载已解压的扩展程序'); console.log('Opened native extension folder picker.');
  } else {
    const nodes = await layout();
    console.log(JSON.stringify(nodes.filter(n => n.text || n.description || n.bundleName).map(n => ({ bundle: n.bundleName, type: n.type, text: n.text, description: n.description, id: n.id, bounds: n.bounds })), null, 2));
  }
}
if (process.argv[1]?.endsWith('/browser-ui.mjs')) await main();
