import process from 'node:process';
import os from 'node:os';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import * as report from '../shared/report.mjs';
import * as storage from './storage.mjs';
import * as menu from './menu.mjs';
import * as rpc from './rpc.mjs';
import {databases} from './db.mjs';
import * as webServer from './webserver.mjs';
import * as stats from './stats.mjs';
import {createRequire} from 'node:module';
import * as secrets from './secrets.mjs';
import * as zwift from './zwift.mjs';
import * as windows from './windows.mjs';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const {autoUpdater} = require('electron-updater');
const electron = require('electron');
const isDEV = !electron.app.isPackaged;
const zwiftAPI = new zwift.ZwiftAPI();
const zwiftMonitorAPI = new zwift.ZwiftAPI();

let started;
let quiting;
let sauceApp;
const rpcSources = {
    windows: windows.eventEmitter,
};


export function getApp() {
    return sauceApp;
}


function quit(retcode) {
    quiting = true;
    if (retcode) {
        electron.app.exit(retcode);
    } else {
        electron.app.quit();
    }
}
rpc.register(quit);


function restart() {
    electron.app.relaunch();
    quit();
}
rpc.register(restart);


try {
    storage.load(0);
} catch(e) {
    quiting = true;
    console.error('Storage error:', e);
    Promise.all([
        storage.reset(),
        electron.dialog.showErrorBox('Storage error. Resetting database...', '' + e)
    ]).finally(() => quit(1));
}

electron.app.on('window-all-closed', () => {
    if (started) {
        quit();
    }
});
electron.app.on('second-instance', (ev,_, __, {type}) => {
    if (type === 'quit') {
        console.warn("Another instance requested us to quit.");
        quit();
    }
});
electron.app.on('activate', async () => {
    // Clicking on the app icon..
    if (electron.BrowserWindow.getAllWindows().length === 0) {
        windows.openAllWindows();
    }
});
electron.app.on('before-quit', () => void (quiting = true));

const serialCache = new WeakMap();
electron.ipcMain.on('subscribe', (ev, {event, domEvent, persistent, source='stats'}) => {
    const {win, activeSubs, spec} = windows.getMetaByWebContents(ev.sender);
    // NOTE: Electron webContents.send is incredibly hard ON CPU and GC for deep objects.  Using JSON is
    // a massive win for CPU and memory.
    const sendMessage = data => {
        let json = serialCache.get(data);
        if (!json) {
            json = JSON.stringify(data);
            serialCache.set(data, json);
        }
        win.webContents.send('browser-message', {domEvent, json});
    };
    // NOTE: MacOS emits show/hide AND restore/minimize but Windows only does restore/minimize
    const resumeEvents = ['responsive', 'show', 'restore'];
    const suspendEvents = ['unresponsive', 'hide', 'minimize'];
    const shutdownEvents = ['destroyed', 'did-start-loading'];
    const emitter = rpcSources[source];
    if (!emitter) {
        throw new TypeError('Invalid emitter source: ' + source);
    }
    const listeners = [];
    function resume(who) {
        if (!activeSubs.has(event)) {
            if (who) {
                console.debug("Resume subscription:", event, spec.id, who);
            } else {
                console.debug("Startup subscription:", event, spec.id);
            }
            emitter.on(event, sendMessage);
            activeSubs.add(event);
        }
    }
    function suspend(who) {
        if (activeSubs.has(event)) {
            console.debug("Suspending subscription:", event, spec.id, who);
            emitter.off(event, sendMessage);
            activeSubs.delete(event);
        }
    }
    function shutdown(ev) {
        emitter.off(event, sendMessage);
        if (!win.isDestroyed()) {
            for (const x of shutdownEvents) {
                win.webContents.off(x, shutdown);
            }
            for (const [name, cb] of listeners) {
                win.off(name, cb);
            }
        }
        activeSubs.clear();
        // Must log last because of logs source which eats its own tail otherwise.
        console.debug("Shutdown subscription:", event, spec.id);
    }
    if (persistent || (win.isVisible() && !win.isMinimized())) {
        resume();
    }
    for (const x of shutdownEvents) {
        win.webContents.once(x, shutdown);
    }
    if (!persistent) {
        for (const x of resumeEvents) {
            const cb = ev => resume(x, ev);
            win.on(x, cb);
            listeners.push([x, cb]);
        }
        for (const x of suspendEvents) {
            const cb = ev => suspend(x, ev);
            win.on(x, cb);
            listeners.push([x, cb]);
        }
    }
});

rpc.register(() => isDEV, {name: 'isDEV'});
rpc.register(() => pkg.version, {name: 'getVersion'});
rpc.register(url => electron.shell.openExternal(url), {name: 'openExternalLink'});
rpc.register(() => sauceApp && sauceApp.webServerURL, {name: 'getWebServerURL'});
rpc.register(() => {
    return {
        main: {
            username: zwiftAPI.username,
            id: zwiftAPI.profile ? zwiftAPI.profile.id : null,
            authenticated: zwiftAPI.isAuthenticated(),
        },
        monitor: {
            username: zwiftMonitorAPI.username,
            id: zwiftMonitorAPI.profile ? zwiftMonitorAPI.profile.id : null,
            authenticated: zwiftMonitorAPI.isAuthenticated(),
        },
    };
}, {name: 'getZwiftLoginInfo'});


async function zwiftLogout(id) {
    const key = {
        main: 'zwift-login',
        monitor: 'zwift-monitor-login',
    }[id];
    if (!id) {
        throw new TypeError('Invalid id for zwift logout');
    }
    await secrets.remove(key);
}
rpc.register(zwiftLogout);


function registerRPCMethods(instance, ...methodNames) {
    for (const name of methodNames) {
        if (!instance[name]) {
            throw new TypeError('Invalid method name: ' + name);
        }
        rpc.register(instance[name].bind(instance), {name});
    }
}


async function getLocalRoutedIP() {
    const conn = net.createConnection(80, 'www.zwift.com');
    return await new Promise((resolve, reject) => {
        conn.on('connect', () => {
            try {
                resolve(conn.address().address);
            } finally {
                conn.end();
            }
        });
        conn.on('error', reject);
    });
}


class SauceApp extends EventEmitter {
    _defaultSettings = {
        webServerEnabled: true,
        webServerPort: 1080,
    };
    _settings;
    _settingsKey = 'app-settings';
    _metricsPromise;
    _lastMetricsTS = 0;

    constructor() {
        super();
        const _this = this;
        rpc.register(function() {
            _this._resetStorageState.call(_this, /*sender*/ this);
        }, {name: 'resetStorageState'});
        registerRPCMethods(this, 'getSetting', 'setSetting', 'pollMetrics', 'getDebugInfo',
            'getGameConnectionStatus');
    }

    getSetting(key, def) {
        if (!this._settings) {
            this._settings = storage.load(this._settingsKey) || {...this._defaultSettings};
        }
        if (!Object.prototype.hasOwnProperty.call(this._settings, key) && def !== undefined) {
            this._settings[key] = def;
            storage.save(this._settingsKey, this._settings);
        }
        return this._settings[key];
    }

    setSetting(key, value) {
        if (!this._settings) {
            this._settings = storage.load(this._settingsKey) || {...this._defaultSettings};
        }
        this._settings[key] = value;
        storage.save(this._settingsKey, this._settings);
        this.emit('setting-change', {
            key,
            value
        });
    }

    _getMetrics(reentrant) {
        return new Promise(resolve => setTimeout(() => {
            if (reentrant !== true) {
                // Schedule one more in anticipation of pollers
                this._metricsPromise = this._getMetrics(true);
            } else {
                this._metricsPromise = null;
            }
            this._lastMetricsTS = Date.now();
            resolve(electron.app.getAppMetrics());
        }, 2000 - (Date.now() - this._lastMetricsTS)));
    }

    async pollMetrics() {
        if (!this._metricsPromise) {
            this._metricsPromise = this._getMetrics();
        }
        return await this._metricsPromise;
    }

    async getDebugInfo() {
        return {
            app: {
                version: pkg.version,
                uptime: process.uptime(),
                mem: process.memoryUsage(),
                cpu: process.cpuUsage(),
                cwd: process.cwd(),
            },
            gpu: electron.app.getGPUFeatureStatus(),
            sys: {
                arch: process.arch,
                platform: os.platform(),
                release: os.release(),
                version: os.version(),
                productVersion: process.getSystemVersion(),
                mem: process.getSystemMemoryInfo(),
                uptime: os.uptime(),
                cpus: os.cpus(),
            },
            stats: this.statsProc.getDebugInfo(),
            databases: [].concat(...Array.from(databases.entries()).map(([dbName, db]) => {
                const stats = db.prepare('SELECT * FROM sqlite_schema WHERE type = ? AND name NOT LIKE ?')
                    .all('table', 'sqlite_%');
                return stats.map(t => ({
                    dbName,
                    tableName: t.name,
                    rows: db.prepare(`SELECT COUNT(*) as rows FROM ${t.name}`).get().rows,
                }));
            })),
        };
    }

    startGameConnectionServer(ip) {
        const gcs = new zwift.GameConnectionServer({ip, zwiftAPI});
        registerRPCMethods(gcs, 'watch', 'join', 'teleportHome', 'say', 'wave', 'elbow',
            'takePicture', 'powerup', 'changeCamera', 'enableHUD', 'disableHUD', 'chatMessage',
            'reverse', 'toggleGraphs', 'sendCommands', 'turnLeft', 'turnRight', 'goStraight');
        gcs.start().catch(report.error);
        return gcs;
    }

    async _resetStorageState(sender) {
        const {response} = await electron.dialog.showMessageBox(sender.getOwnerBrowserWindow(), {
            type: 'question',
            title: 'Confirm Reset State',
            message: 'This operation will reset all settings completely.\n\n' +
                'Are you sure you want continue?',
            buttons: ['Yes, reset to defaults', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
        });
        if (response === 0) {
            console.warn('Reseting state and restarting...');
            await storage.reset();
            await secrets.remove('zwift-login');
            await secrets.remove('zwift-monitor-login');
            await electron.session.defaultSession.clearStorageData();
            await electron.session.defaultSession.clearCache();
            const patreonSession = electron.session.fromPartition('persist:patreon');
            await patreonSession.clearStorageData();
            await patreonSession.clearCache();
            restart();
        }
    }

    getGameConnectionStatus() {
        return this.gameConnection && this.gameConnection.getStatus();
    }

    async start(args) {
        const gameMonitor = this.gameMonitor = new zwift.GameMonitor({
            zwiftMonitorAPI,
            gameAthleteId: args.athleteId || zwiftAPI.profile.id,
            randomWatch: args.randomWatch,
        });
        gameMonitor.on('multiple-logins', () => {
            electron.dialog.showErrorBox('Multiple Logins Detected',
                'Your Monitor Zwift Login is being used by more than 1 application. ' +
                'This is usually an indicator that your Monitor Login is not the correct one. ' +
                'Go to the main settings panel and logout if it is incorrect.');
        });
        let ip;
        let gameConnection;
        if (this.getSetting('gameConnectionEnabled') && !args.disableGameConnection) {
            ip = ip || await getLocalRoutedIP();
            gameConnection = this.startGameConnectionServer(ip);
            // This isn't required but reduces latency..
            gameConnection.on('watch-command', id => gameMonitor.setWatching(id));
            this.gameConnection = gameConnection; // debug
        }
        rpcSources.gameConnection = gameConnection || new EventEmitter();
        this.statsProc = new stats.StatsProcessor({zwiftAPI, gameMonitor, gameConnection});
        this.statsProc.start();
        rpcSources.stats = this.statsProc;
        rpcSources.app = this;
        if (this.getSetting('webServerEnabled')) {
            ip = ip || await getLocalRoutedIP();
            this.webServerEnabled = true;
            this.webServerPort = this.getSetting('webServerPort');
            this.webServerURL = `http://${ip}:${this.webServerPort}`;
            // Will stall when there is a port conflict..
            webServer.start({
                ip,
                port: this.webServerPort,
                rpcSources,
                statsProc: this.statsProc,
            }).catch(report.error);
        }
    }
}


async function zwiftAuthenticate(options) {
    let creds;
    const ident = options.ident;
    if (!options.forceLogin) {
        creds = await secrets.get(ident);
        if (creds) {
            try {
                await options.api.authenticate(creds.username, creds.password, options);
                console.info(`Using Zwift username [${ident}]:`, creds.username);
                return creds.username;
            } catch(e) {
                console.warn("Previous Zwift login invalid:", e);
                // We could remove them, but it might be a network error; just leave em for now.
            }
        }
    }
    creds = await windows.zwiftLogin(options);
    if (creds) {
        await secrets.set(ident, creds);
        return creds.username;
    } else {
        return false;
    }
}


function snakeToCamelCase(v) {
    return v.split(/[_-]/).map((x, i) =>
        i ? x[0].toUpperCase() + x.substr(1) : x).join('');
}


function parseArgs() {
    const iter = process.argv.values();
    const args = {};
    const switches = ['help', 'headless', 'force-login', 'random-watch', 'disable-game-connection'];
    const options = ['host', 'athlete-id'];
    for (let x of iter) {
        if (!x.startsWith('--')) {
            continue;
        }
        x = x.substr(2);
        if (switches.includes(x)) {
            args[snakeToCamelCase(x)] = true;
        } else if (options.includes(x)) {
            let value = iter.next().value;
            if (value === undefined) {
                throw new TypeError('Missing value for option: ' + x);
            }
            if (Number(value).toString() === value) {
                value = Number(value);
            }
            args[snakeToCamelCase(x)] = value;
        }
    }
    if (args.help) {
        console.warn(`Usage: ${process.argv[0]} ` +
            switches.map(x => `[--${x}]`).join(' ') + ' ' +
            options.map(x => `[--${x} VALUE]`).join(' '));
        quit(1);
    }
    return args;
}


async function checkForUpdates() {
    autoUpdater.disableWebInstaller = true;
    autoUpdater.autoDownload = false;
    let updateAvail;
    // Auto updater was written by an alien.  Must use events to affirm update status.
    autoUpdater.once('update-available', () => void (updateAvail = true));
    try {
        const update = await autoUpdater.checkForUpdates();
        if (updateAvail) {
            return update.versionInfo;
        }
    } catch(e) {
        // A variety of non critical conditions can lead to this, log and move on.
        console.warn("Auto update problem:", e);
        return;
    }
}


async function maybeDownloadAndInstallUpdate({version}) {
    const confirmWin = await windows.updateConfirmationWindow(version);
    if (!confirmWin) {
        return;  // later
    }
    autoUpdater.on('download-progress', ev => {
        console.info('Sauce update download progress:', ev.percent);
        confirmWin.webContents.send('browser-message',
            {domEvent: 'update-download-progress', json: JSON.stringify(ev)});
    });
    try {
        await autoUpdater.downloadUpdate();
    } catch(e) {
        report.error(e);
        await electron.dialog.showErrorBox('Update error', '' + e);
        if (!confirmWin.isDestroyed()) {
            confirmWin.close();
        }
        return;
    }
    quiting = true;  // auto updater closes windows before quiting. Must not save state.
    autoUpdater.quitAndInstall();
    return true;
}

export async function main({logEmitter, logFile, logQueue, sentryAnonId}) {
    const s = Date.now();
    const args = parseArgs();
    if (quiting) {
        return;
    }
    if (logEmitter) {
        rpcSources['logs'] = logEmitter;
        rpc.register(() => logQueue, {name: 'getLogs'});
        rpc.register(() => logQueue.length = 0, {name: 'clearLogs'});
        rpc.register(() => electron.shell.showItemInFolder(logFile), {name: 'showLogInFolder'});
    }
    rpc.register(() => sentryAnonId, {name: 'getSentryAnonId'});
    sauceApp = new SauceApp();
    global.app = sauceApp;  // devTools debug
    if (!args.headless) {
        menu.installTrayIcon();
        menu.setAppMenu();
    }
    let updater;
    const lastVersion = sauceApp.getSetting('lastVersion');
    if (lastVersion !== pkg.version) {
        if (!args.headless) {
            if (lastVersion) {
                console.info("Sauce recently updated");
                await electron.session.defaultSession.clearCache();
                await windows.showReleaseNotes();
            } else {
                console.info("First time invocation: Welcome to Sauce for Zwift");
                await windows.welcomeSplash();
            }
        }
        sauceApp.setSetting('lastVersion', pkg.version);
    } else if (!isDEV) {
        updater = checkForUpdates();
    }
    try {
        if (!await windows.eulaConsent() || !await windows.patronLink()) {
            return quit();
        }
    } catch(e) {
        await electron.dialog.showErrorBox('EULA or Patreon Link Error', '' + e);
        return quit(1);
    }
    const mainUser = await zwiftAuthenticate({api: zwiftAPI, ident: 'zwift-login', ...args});
    if (!mainUser) {
        return quit(1);
    }
    const monUser = await zwiftAuthenticate({api: zwiftMonitorAPI, ident: 'zwift-monitor-login',
        monitor: true, ...args});
    if (!monUser) {
        return quit(1);
    }
    if (mainUser === monUser) {
        const {response} = await electron.dialog.showMessageBox({
            type: 'warning',
            title: 'Duplicate Zwift Logins',
            message: 'Your Main Zwift Login is the same as the Monitor Zwift Login.\n\n' +
                `Both are set to: ${mainUser}\n\n` +
                'Please select which login should be changed...',
            detail: 'HINT: The Main Login should be your normal Zwift Game login and ' +
                'the Monitor Login should be a FREE secondary login used ONLY by Sauce.',
            buttons: [`Logout Main`, `Logout Monitor`],
            noLink: true,
            textWidth: 400,
        });
        await zwiftLogout(response === 0 ? 'main' : 'monitor');
        return restart();
    }
    const updateInfo = await updater;
    if (updateInfo && await maybeDownloadAndInstallUpdate(updateInfo)) {
        return; // updated, will restart
    }
    await sauceApp.start(args);
    console.debug('Startup bench:', Date.now() - s);
    if (!args.headless) {
        windows.openAllWindows();
        menu.updateTrayMenu();
    }
    started = true;
}

// Dev tools prototyping
global.zwift = zwift;
global.stats = stats;
global.zwiftAPI = zwiftAPI;
global.zwiftMonitorAPI = zwiftMonitorAPI;
global.windows = windows;
global.electron = electron;
global.report = report;
