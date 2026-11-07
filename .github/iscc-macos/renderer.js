'use strict';

const { randomUUID } = require('node:crypto');
const { mountManagement } = require('../mt5-vps/management');
const { mountTradeSettings } = require('../mt5-vps/tradeSettings');
const { entryTarget } = require('../mt5-vps/managementTarget');
const { indexSymbol } = require('../mt5-vps/approachPreparation');

function mount(ipc) {
  const toolbar = document.querySelector('.toolbar');
  const mt5IPC = {
    invoke: (channel, ...args) => channel === 'instrument:get'
      ? ipc.invoke('bml-sml:instrument', args[0].symbol) : ipc.invoke(channel, ...args),
    on: (...args) => ipc.on(...args),
    removeListener: (...args) => ipc.removeListener(...args)
  };
  mountManagement(mt5IPC, toolbar);
  mountTradeSettings(mt5IPC, toolbar);

  function add(parent, tag, text) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    parent.append(element);
    return element;
  }
  function button(parent, text, action) {
    const control = add(parent, 'button', text);
    control.type = 'button';
    control.onclick = action;
    return control;
  }

  const dialog = add(document.body, 'dialog');
  dialog.style.cssText = 'width:min(630px,90vw);max-height:85vh;overflow:auto;background:#20242b;color:#eee;border:1px solid #586272;border-radius:10px;padding:18px';
  add(dialog, 'h2', 'BML / SML · MT5');
  const status = add(dialog, 'p');
  status.setAttribute('role', 'status');
  const form = add(dialog, 'fieldset');
  add(form, 'legend', 'New entry from Level Track');
  function field(label, type) {
    const row = add(form, 'label', label + ' ');
    row.style.cssText = 'display:block;margin-bottom:6px';
    return add(row, type);
  }
  const symbol = field('Index', 'select');
  const level = field('Saved LT level', 'select');
  const risk = field('Risk in USD', 'input');
  const stop = field('Stop distance (points)', 'input');
  const maxLot = field('Maximum lot per part (0 = no extra cap)', 'input');
  const take = field('Take profit (points, optional)', 'input');
  const stopMode = field('Stop basis', 'select');
  for (const input of [risk, stop, maxLot, take]) {
    input.type = 'number';
    input.step = 'any';
    input.min = '0';
  }
  maxLot.value = '0';
  function option(select, value, label = value) {
    const item = add(select, 'option', label);
    item.value = value;
  }
  option(stopMode, 'entry', 'Entry price');
  option(stopMode, 'level', 'LT level');
  const buy = button(form, 'Arm BML', () => arm('MB'));
  const sell = button(form, 'Arm SML', () => arm('MS'));
  add(dialog, 'h3', 'Entry plans and account progress');
  const plans = add(dialog, 'div');
  const result = add(dialog, 'p');
  result.setAttribute('role', 'status');
  button(dialog, 'Refresh', () => refresh());
  button(dialog, 'Close', () => dialog.close());
  button(toolbar, 'BML / SML', () => open());

  let groups = [], enabled = false, trading = false, busy = false, loading = false;
  let awaitingEvidence = null;
  function updateLevels(selected = level.value) {
    const values = groups.filter(group => indexSymbol(group.ticker) === symbol.value).flatMap(group => group.levels);
    level.replaceChildren();
    for (const value of new Set(values.map(String))) option(level, value);
    if (Array.from(level.options).some(item => item.value === String(selected))) level.value = selected;
    updateControls();
  }
  function updateControls() {
    buy.disabled = sell.disabled = !trading || busy || loading || awaitingEvidence !== null || !level.value;
  }
  symbol.onchange = () => updateLevels();

  async function open(prefill = {}) {
    if (dialog.open) return;
    dialog.showModal();
    status.textContent = 'Reading local settings…';
    enabled = trading = false;
    updateControls();
    try {
      const info = await ipc.invoke('bml-sml:setup');
      if (info.status !== 'ok') throw Error(info.reason);
      enabled = info.enabled;
      trading = enabled && info.tradingEnabled;
      groups = info.groups;
      symbol.replaceChildren();
      for (const ticker of new Set(groups.map(group => indexSymbol(group.ticker)))) option(symbol, ticker);
      if (prefill.ticker && [...symbol.options].some(item => item.value === prefill.ticker)) symbol.value = prefill.ticker;
      updateLevels(prefill.level);
      for (const [input, value] of [[risk, prefill.risk], [stop, prefill.stop], [maxLot, prefill.maxLot], [take, prefill.take]]) {
        if (value !== undefined && value !== '') input.value = value;
      }
      status.textContent = !enabled ? 'MT5 VPS is disabled. Configure it locally to connect.'
        : !trading ? 'New entries are disabled. Existing plans can still be viewed or stopped.'
          : 'Arm submits a new entry plan to your configured MT5 account.';
      await refresh();
    } catch (error) {
      status.textContent = error.message;
    }
  }

  async function refresh() {
    if (!enabled || loading) return;
    loading = true;
    try {
      const response = await ipc.invoke('bml-sml:entries');
      if (response.status !== 'ok') throw Error(response.reason);
      if (awaitingEvidence && response.entries.some(entry => entry.id === awaitingEvidence && !entry._armUnconfirmed)) {
        awaitingEvidence = null;
      }
      plans.replaceChildren();
      for (const entry of response.entries) {
        if (entry.positionLifecycle === 'closed' && entry.positionsConfirmed) continue;
        const row = add(plans, 'section');
        add(row, 'strong', `${entry.symbol} · ${entry.side} · ${entry.phase}`);
        if (entry.reason || entry._readError) add(row, 'p', entry._readError || entry.reason);
        if (['armed', 'running', 'paused', 'sending', 'unknown'].includes(entry.phase)) {
          button(row, 'Stop further entry', () => command('bml-sml:stop', entry.id));
        }
        const target = entryTarget(entry);
        if (target) button(row, 'T|S · Manage exact position', () => {
          dialog.close();
          document.getElementById('mt5-manage-button').openTarget(target);
        });
        for (const [account, progress] of Object.entries(entry.accounts || {})) {
          const line = add(row, 'p', `${account}: ${progress.filledVolume ?? '—'} / ${progress.targetVolume ?? '—'} lots · ${progress.entryStatus || entry.lanePhases?.[account] || entry.phase} `);
          if (trading && target && ['independent-v4', 'independent-v5'].includes(entry.accountExecution)
              && !entry._armUnconfirmed && !entry._stopUnconfirmed && !entry._readError
              && !entry.protectionPending && !entry.closurePending
              && Number(progress.targetVolume) - Number(progress.filledVolume) > 1e-8
              && !progress.commonStopUncertain && !progress.riskRepairRequired && !progress.stopCheckRejected
              && entry.lanePhases?.[account] !== 'completed') {
            button(line, 'Continue existing plan', () => command('bml-sml:continue', { entryId: entry.id, account }));
          }
        }
      }
      if (!plans.childElementCount) add(plans, 'p', 'No active entry plans.');
    } catch (error) {
      plans.replaceChildren();
      add(plans, 'p', error.message);
    } finally {
      loading = false;
      updateControls();
    }
  }

  async function command(channel, payload) {
    if (busy) return;
    busy = true;
    updateControls();
    try {
      const reply = await ipc.invoke(channel, payload);
      result.textContent = reply.reason || reply.message || reply.status;
      if (channel === 'bml-sml:arm' && reply.status === 'unknown') awaitingEvidence = payload.requestId;
    } catch (error) {
      result.textContent = error.message;
      if (channel === 'bml-sml:arm') awaitingEvidence = payload.requestId;
    } finally {
      await refresh();
      busy = false;
      updateControls();
    }
  }
  function arm(action) {
    if (!(Number(risk.value) > 0) || !(Number(stop.value) > 0)) {
      result.textContent = 'Enter positive values for risk and stop distance.';
      return;
    }
    if (!trading || !level.value || awaitingEvidence) return;
    command('bml-sml:arm', {
      action, requestId: randomUUID(), clickAt: Date.now(), ticker: symbol.value,
      level: Number(level.value), riskUsd: Number(risk.value), stopOffsetPts: Number(stop.value),
      maxLot: Number(maxLot.value), takeProfitPts: take.value || null, stopMode: stopMode.value
    });
  }

  const timer = setInterval(() => {
    if (dialog.open && !document.hidden && !busy) refresh();
  }, 2000);
  window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
  return {
    addCardButton(card, row, fields) {
      const ticker = indexSymbol(row.ticker);
      if (!['SPX500', 'USTEC'].includes(ticker)) return;
      const value = name => fields.querySelector(`input.${name}`)?.value;
      button(card, 'BML / SML…', () => open({
        ticker, level: value('level') ?? row.level, risk: value('risk') ?? row.riskUsd,
        stop: value('sl') ?? row.stopOffsetPts, maxLot: value('qty') ?? row.maxLot, take: value('tp') ?? row.takeProfitPts
      }));
    }
  };
}

module.exports = { mount };
