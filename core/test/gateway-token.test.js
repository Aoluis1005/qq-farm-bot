const assert = require('node:assert/strict');
const test = require('node:test');

const { createGatewayToken } = require('../src/utils/gateway-token');

test('gateway token matches the official AceManager randomStr format', () => {
    const tokens = Array.from({ length: 100 }, () => createGatewayToken());
    for (const token of tokens) {
        assert.match(token, /^[a-z0-9]{64,127}=$/i);
        assert.ok(token.length >= 65);
        assert.ok(token.length <= 128);
    }
    assert.ok(new Set(tokens).size > 95);
});
