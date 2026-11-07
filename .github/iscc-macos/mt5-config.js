'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

function configFile() {
  return path.join(app.getPath('userData'), 'config', 'mt5-vps.json');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { enabled: false, tradingEnabled: false };
    throw Error('Cannot read the local MT5 VPS configuration');
  }
}

function saveConfig(changes) {
  const file = configFile();
  const config = { ...readConfig(), ...changes };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const directory = fs.mkdtempSync(path.join(path.dirname(file), '.mt5-config-'));
  const temporary = path.join(directory, 'config.json');
  try {
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = { readConfig, saveConfig };
