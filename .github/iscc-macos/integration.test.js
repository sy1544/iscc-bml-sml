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
    const servicesApi = {
      levelTrack: { snapshot: () => ({ config: { groups: [{ ticker: 'USTEC', levels: [20000] }] } }) }
    };
    main.install({ servicesApi });
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
  } finally {
    interception.mock.restore();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
