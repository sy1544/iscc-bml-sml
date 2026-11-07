'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { mock, test } = require('node:test');
const Module = require('node:module');

test('the built app wires MT5 IPC, rejects external callers and starts disabled', async () => {
  const handlers = new Map();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'iscc-smoke-'));
  const electron = {
    app: {
      isReady: () => true,
      getPath: () => userData,
      once() {}
    },
    ipcMain: {
      handle(channel, callback) {
        assert.ok(!handlers.has(channel), `Duplicate handler: ${channel}`);
        handlers.set(channel, callback);
      }
    }
  };
  const original = Module._load;
  const interception = mock.method(Module, '_load', function (request, ...args) {
    return request === 'electron' ? electron : original.call(this, request, ...args);
  });
  try {
    const project = process.cwd();
    const main = require(path.join(project, 'app/services/bml-sml/main'));
    const { MT5VPSAdapter } = require(path.join(project, 'app/services/mt5-vps/client'));
    const adapter = new MT5VPSAdapter({ spxSymbol: 'SPX500.cash', ustecSymbol: 'USTEC.cash' });
    assert.equal(adapter.brokerSymbol('USTEC'), 'USTEC.cash');
    assert.equal(adapter.brokerSymbol('USTEC.cash'), 'USTEC.cash');
    assert.throws(() => adapter.brokerSymbol('unconfigured'));
    const servicesApi = {
      levelTrack: { snapshot: () => ({ config: { groups: [{ ticker: 'USTEC', levels: [20000], maxOffset: 2 }] } }) }
    };
    main.install({
      servicesApi,
      orderCalc: { qty: () => 0.5 },
      tradeRules: { validate: () => ({ ok: true }) },
      normalizeQuoteForValidation: quote => quote,
      log() {}
    });
    assert.ok(servicesApi.mt5VPS);
    const invoke = (name, ...args) => handlers.get(name)({
      senderFrame: { url: pathToFileURL(path.join(project, 'app/index.html')).href, parent: null }
    }, ...args);
    assert.deepEqual(await invoke('bml-sml:setup'), {
      status: 'ok', enabled: false, tradingEnabled: false,
      groups: [{ ticker: 'USTEC', levels: [20000] }]
    });
    assert.match((await invoke('bml-sml:arm', { action: 'MB', ticker: 'USTEC' })).reason, /disabled/);
    assert.match((await invoke('bml-sml:entries')).reason, /disabled/);
    assert.match((await handlers.get('mt5-vps:orders')({
      senderFrame: { url: 'https://example.invalid' }
    })).reason, /must originate/);

    const configPath = path.join(userData, 'config/mt5-vps.json');
    fs.mkdirSync(path.dirname(configPath));
    const enable = tradingEnabled => fs.writeFileSync(configPath, JSON.stringify({ enabled: true, tradingEnabled }));
    let submissions = 0;
    servicesApi.mt5VPS.getAdapter = () => ({
      config: { account: 123, server: 'Fake-MT5', tradingEnabled: true },
      brokerSymbol: () => 'USTEC.test',
      snapshot: async () => ({
        symbol: 'USTEC.test', account: 123, server: 'Fake-MT5',
        metadata: { tickSize: 0.1, quantityStep: 0.01, minQty: 0.01, maxQty: 100, contractSize: 1 }
      }),
      async armChunkEntry(plan) {
        submissions++;
        assert.equal(plan.executionPolicy, 'hybrid-market-limit-v1');
        assert.equal(plan.zoneLower, 20000);
        assert.equal(plan.zoneUpper, 20002);
        return { status: 'ok' };
      }
    });
    const entry = { action: 'MB', ticker: 'USTEC', level: 20000, riskUsd: 50, stopOffsetPts: 10, stopMode: 'entry' };
    enable(false);
    assert.match((await invoke('bml-sml:arm', entry)).reason, /disabled/);
    assert.equal(submissions, 0);
    enable(true);
    assert.equal((await invoke('bml-sml:arm', { ...entry, level: 20001 })).status, 'rejected');
    assert.equal(submissions, 0);
    assert.equal((await invoke('bml-sml:arm', entry)).status, 'ok');
    assert.equal(submissions, 1);
  } finally {
    interception.mock.restore();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
