"""Integrate a verified BML/SML kit into a clean checkout of ISCC 1.2.0."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile

TOOLS = Path(__file__).resolve().parent


def load(name, source):
    spec = importlib.util.spec_from_file_location(name, source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError(f'Unexpected ISCC integration point: {before}')
    return text.replace(before, after, 1)


def edit(file, before, after):
    file.write_text(replace_once(file.read_text(), before, after))


def copy(source, destination):
    if destination.exists():
        raise ValueError(f'Review the existing file before integrating: {destination}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def assemble(kit, project):
    prepare = load('prepare_kit', kit / 'prepare.py')
    manifest = prepare.verify(kit)
    installer = load('level_renderer_installer', kit / 'components/level-renderer/install.py')
    app = project / 'app'
    services = app / 'services'
    payload = kit / 'payload/src/app/services'
    addon = services / 'bml-sml'
    mt5 = services / 'mt5-vps'

    for source in sorted((payload / 'mt5-vps').glob('*.js')):
        copy(source, mt5 / source.name)
    edit(mt5 / 'client.js', '  brokerSymbol(symbol) {',
         "  brokerSymbol(symbol) {\n"
         "    // Management returns the broker's exact symbol, which can include a suffix.\n"
         "    if (typeof symbol === 'string' && symbol && [this.config.spxSymbol, this.config.ustecSymbol].includes(symbol)) return symbol;")
    for source in sorted((payload / 'levelOrder').glob('*.js')):
        copy(source, addon / source.name)
    for name in ('durableFile.js', 'journalWriter.js', 'tvListener/candle-mappings.js'):
        copy(payload / name, services / name)
    copy(kit / 'selection.js', services / 'selection.js')
    copy(kit / 'module/featurePolicy.js', addon / 'featurePolicy.js')
    for name in ('main.js', 'renderer.js', 'mt5-config.js'):
        copy(TOOLS / name, addon / name)
    edit(app / 'main.js', '  createWindow();\n  setupIpc(orderCardService);',
         "  require('./services/bml-sml/main').install({\n"
         '    servicesApi, tradeRules, orderCalc, normalizeQuoteForValidation,\n'
         "    log: row => appendJsonl(EXEC_LOG, {t: nowTs(), ...row})\n"
         '  });\n  createWindow();\n  setupIpc(orderCardService);')
    edit(app / 'renderer.js', "const {ipcRenderer} = require('electron');",
         "const {ipcRenderer} = require('electron');\n"
         "const bmlSml = document.querySelector('.toolbar') && require('./services/bml-sml/renderer').mount(ipcRenderer);")
    edit(app / 'renderer.js', '  card.appendChild(btns);\n  const note =',
         "  card.appendChild(btns);\n"
         "  if (row.cardType === 'levelOrder') bmlSml?.addCardButton(card, row, body.line);\n"
         '  const note =')

    descriptor_name = 'levelOrder/config/level-order-settings-descriptor.json'
    descriptor = services / descriptor_name
    original = json.loads(descriptor.read_text())
    additions = json.loads((payload / descriptor_name).read_text())
    for group, fields in [('defaults', original['options']['defaults']),
                          ('symbols', original['options']['symbols']['item'])]:
        extra = additions['options'][group]
        if group == 'symbols':
            extra = extra['item']
        for name in ('chunkPercent', 'stopMode'):
            fields[name] = extra[name]
    descriptor.write_text(json.dumps(original, ensure_ascii=False, indent=2) + '\n')
    defaults_path = services / 'levelOrder/config/level-order.json'
    defaults = json.loads(defaults_path.read_text())
    defaults['defaults'].update(chunkPercent=30, stopMode='entry')
    defaults_path.write_text(json.dumps(defaults, indent=2) + '\n')

    # Adapt the reference service to this host. Its private SSH recovery
    # dependency is absent from the public kit.
    reference = (kit / 'reference/mt5-service-manifest.js.txt').read_text()
    start = reference.index('  let reconnecting;')
    end = reference.index("  ipcMain.handle('mt5-vps:trade-settings'")
    reference = reference[:start] + reference[end:]
    reference = replace_once(reference, "const settings = require('../settings');\nconst loadConfig = require('../../config/load');",
                             "const {readConfig, saveConfig} = require('../bml-sml/mt5-config');")
    start = reference.index("settings.register('mt5-vps',")
    end = reference.index('function initService(api)', start)
    reference = reference[:start] + reference[end:]
    reference = replace_once(reference, 'function initService(api)', 'function initService(api, handle, publishQuote)')
    reference = replace_once(reference, "  const {app, ipcMain, powerSaveBlocker} = require('electron');",
                             "  const {app, powerSaveBlocker} = require('electron');\n  const ipcMain = {handle};")
    reference = replace_once(reference, "  const tunnelRecovery=require('./tunnelRecovery').createTunnelRecovery(app.getPath('userData'));\n", '')
    reference = replace_once(reference, '        const connection = new MT5VPSAdapter(readConfig());',
                             "        const config = readConfig();\n"
                             "        if (config.enabled !== true) throw Error('MT5 VPS is disabled in the local configuration');\n"
                             '        const connection = new MT5VPSAdapter(config);')
    reference = replace_once(reference, "  require('../brokerage/brokerageAdapters')['mt5-vps'] = () => api.mt5VPS.getAdapter();\n", '')
    reference = replace_once(reference, "        connection.on('quote:updated', snapshot => {",
                             "        connection.on('quote:updated', snapshot => {\n"
                             "          publishQuote({...snapshot, provider: 'mt5-vps'});")
    reference = reference.replace(",canRecoverConnection:await tunnelRecovery.available(config)", "")
    reference = replace_once(reference, "if (!settings.writeConfig('mt5-vps',changed)) throw Error('Не удалось сохранить настройки');",
                             'saveConfig({followers:next,mirrorAccount:changed.mirrorAccount});')
    reference = replace_once(reference, "if (!settings.writeConfig('mt5-vps',{...config,timeExit})) throw Error('Не удалось сохранить время закрытия');",
                             'saveConfig({timeExit});')
    if 'tunnelRecovery' in reference or 'settings.writeConfig' in reference:
        raise ValueError('The updated MT5 service reference needs review')
    (mt5 / 'manifest.js').write_text(reference)

    edit(services / 'autoUpdater/config/auto-updater.json', '"enabled": true', '"enabled": false')
    edit(services / 'tradeRules/index.js', '  validate(card = {}, quote) {\n    for (const rule of this.rules) {',
         '  validate(card = {}, quote, {deferMarketPrice = false} = {}) {\n'
         '    for (const rule of this.rules) {\n'
         '      // Conditional VPS entries validate executable prices at the receiver.\n'
         '      if (deferMarketPrice && rule instanceof MaxOrderPriceDeviationRule) continue;')

    # The Windows-only base release hardcodes Windows separators in its mock.
    dwx_test = project / 'test/dwxMarketHedge.test.js'
    test = dwx_test.read_text()
    windows_path = r"'app\\services\\brokerage-adapter-dwx\\comps\\dwx.js'"
    if test.count(windows_path) != 2:
        raise ValueError('The DWX test fixture needs review')
    dwx_test.write_text(test.replace(windows_path,
        "require('node:path').join('app', 'services', 'brokerage-adapter-dwx', 'comps', 'dwx.js')"))

    retry_adapter = "    const adapter = new DWXAdapter({ metatraderDirPath: 'test', provider: 'mt5-j2t-dwx', openOrderRetryDelayMs: 1 });"
    edit(dwx_test, retry_adapter, retry_adapter + '\n    adapter.setExecutionRetryPolicy({ shouldRetry: () => true });')

    with tempfile.TemporaryDirectory() as temporary:
        installer.install(project, {'schema': 2, 'platform': 'macos', 'adapterMode': 'iscc', 'publishToLT': True},
                          Path(temporary) / 'levels')
    # Ship the Windows-side receiver sources and the matching MetaTrader
    # indicator alongside the app so a recipient can configure their VPS.
    shutil.copytree(kit / 'payload/vps', project / 'extensions/iscc-mt5-vps', ignore=shutil.ignore_patterns('__pycache__'))
    copy(kit / 'components/level-renderer/mt5/ISCC Candle Levels.mq5',
         project / 'extensions/iscc-mt5-vps/ISCC Candle Levels.mq5')
    copy(TOOLS / 'mt5-vps.example.json', project / 'extensions/iscc-mt5-vps/mt5-vps.example.json')
    (app / 'build-info.json').write_text(json.dumps({'buildId': 'bml-sml-' + manifest['version']}) + '\n')


if __name__ == '__main__':
    assemble(*(Path(arg).resolve() for arg in sys.argv[1:]))
