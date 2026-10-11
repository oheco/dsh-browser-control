import { BrowserBridge, loadConnection } from '../server.js';
import { createOperations } from '../operations.js';
const config = await loadConnection();
const bridge = new BrowserBridge({ port: config.port, token: config.token });
bridge.rpc = createOperations(bridge);
await bridge.start();
console.log(`Browser bridge listening at ${config.endpoint}. No token is logged.`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await bridge.close(); process.exit(0); });
