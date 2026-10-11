import test from 'node:test';
import assert from 'node:assert/strict';
import { pairingHandler, toolDefinition } from '../main.js';
import { TOOL_SPECS } from '../operations.js';
test('pairing is separate from status and model tools and uses the persisted active token', async () => {
  const token = 'a'.repeat(64), endpoint = 'ws://127.0.0.1:9227/browser';
  const api = pairingHandler({ endpoint, token }, { status: () => ({ endpoint, connected: true }) });
  assert.ok(!JSON.stringify(await api('status')).includes(token));
  assert.deepEqual((await api('pairing')).value, { endpoint, token });
  assert.equal((await api('unknown')).ok, false);
  const specs = TOOL_SPECS.map(spec => toolDefinition(spec, async () => null));
  assert.equal(specs.length, 10); assert.ok(!JSON.stringify(specs).includes(token));
  assert.ok(!specs.some(spec => /pairing|token/.test(spec.name)));
});
