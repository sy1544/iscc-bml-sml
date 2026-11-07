'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ipcMain } = require('electron');
const settings = require('../settings');
const { initService, readConfig } = require('../mt5-vps/manifest');
const { isIndex } = require('../mt5-vps/client');
const { createChunkAdmission } = require('./chunkAdmission');
const { createFeaturePolicy } = require('./featurePolicy');
const { ids } = require('../selection');

function install({ servicesApi, tradeRules, orderCalc, normalizeQuoteForValidation, log }) {
  const policy = createFeaturePolicy(ids);
  const renderer = pathToFileURL(path.resolve(__dirname, '../../index.html')).href;
  const getAdapter = () => servicesApi.mt5VPS.getAdapter();
  const getGroups = () => servicesApi.levelTrack?.snapshot().config.groups || [];
  const getConfig = () => settings.readConfig('level-order')?.config || {};
  function handle(channel, callback) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        if (event.senderFrame?.url !== renderer || event.senderFrame.parent) {
          throw Error('MT5 commands must originate in the ISCC panel');
        }
        if (!policy.allow(channel, args[0])) throw Error('This feature is disabled');
        return await callback(event, ...args);
      } catch (error) {
        return { status: 'rejected', reason: error.message };
      }
    });
  }
  initService(servicesApi, handle);

  async function getSnapshot(symbol) {
    const adapter = getAdapter();
    const snapshot = await adapter.snapshot(symbol);
    if (snapshot.symbol !== adapter.brokerSymbol(symbol)
        || String(snapshot.account) !== String(adapter.config.account)
        || snapshot.server !== adapter.config.server) {
      throw Error('MT5 instrument or account could not be verified');
    }
    return { ...snapshot, provider: 'mt5-vps', symbol };
  }
  const admission = createChunkAdmission({
    getAdapter, getGroups, getConfig, getSnapshot, orderCalculator: orderCalc, log,
    validateTrade: (order, quote, options) => tradeRules.validate(order, normalizeQuoteForValidation(quote), options)
  });
  function requireTrading() {
    if (readConfig().tradingEnabled !== true || getAdapter().config.tradingEnabled !== true) {
      throw Error('New BML/SML entries are disabled in the local configuration');
    }
  }
  handle('bml-sml:setup', () => ({
    status: 'ok',
    enabled: readConfig().enabled === true,
    tradingEnabled: readConfig().tradingEnabled === true,
    groups: getGroups().filter(group => group.enabled !== false && isIndex(group.ticker))
      .map(({ ticker, levels }) => ({ ticker, levels }))
  }));
  handle('bml-sml:instrument', (_event, symbol) => getSnapshot(symbol));
  handle('bml-sml:entries', async () => ({ status: 'ok', entries: await getAdapter().listChunkEntries() }));
  handle('bml-sml:arm', async (_event, payload) => {
    requireTrading();
    if (!['MB', 'MS'].includes(payload?.action) || !isIndex(payload.ticker)) {
      throw Error('Choose BML or SML and a supported index');
    }
    return admission.arm({ ...payload, provider: 'mt5-vps', entryMode: 'side-zone', instrumentType: 'FX', zoneMultiplier: 1 });
  });
  handle('bml-sml:stop', (_event, entryId) => getAdapter().stopChunkEntry(entryId));
  handle('bml-sml:continue', (_event, { entryId, account }) => {
    requireTrading();
    return getAdapter().continueChunkEntry(entryId, account);
  });
}

module.exports = { install };
