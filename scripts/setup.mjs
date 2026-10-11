import { loadConnection } from '../server.js';
const config = await loadConnection();
console.log(`连接地址：${config.endpoint}\n私有配置：${config.file}\n浏览器扩展管理：hwbrowser://extensions`);
if (process.argv.includes('--show-token')) console.log(`连接令牌：${config.token}`);
else console.log('首次配置时在本机终端运行 npm run setup -- --show-token，复制令牌到扩展设置。令牌只需保存一次，请勿发送到对话或提交到仓库。');
