import path from 'node:path';
import events from 'node:events';
import os from 'node:os';
import * as report from '../shared/report.mjs';
import * as time from '../shared/sauce/time.mjs';
import * as storage from './storage.mjs';
import * as menu from './menu.mjs';
import * as rpc from './rpc.mjs';
import {createRequire} from 'node:module';
import * as secrets from './secrets.mjs';
import * as zwift from './zwift.mjs';
import * as windows from './windows.mjs';
import * as mods from './mods.mjs';
import {parseArgs} from './argparse.mjs';
import * as app from './app.mjs';
import * as hotkeys from './hotkeys.mjs';

events.defaultMaxListeners = 100;

const sauceScheme = 'sauce4zwift';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const {autoUpdater} = require('electron-updater');
const electron = require('electron');
const isDEV = !electron.app.isPackaged;
const defaultUpdateChannel = pkg.version.match(/alpha/) ? 'alpha' :
    pkg.version.match(/beta/) ?  'beta' : 'stable';
const updateChannelLevels = {stable: 10, beta: 20, alpha: 30};
const serialCache = new WeakMap();
const windowEventSubs = new WeakMap();
const windowManifests = require('./window-manifests.json');

let startupDialog;


export let sauceApp;
export let started;
export let quiting;

export class Exiting extends Error {}


class RobustRealTimeClock extends events.EventEmitter {

    resyncDelay = 3600_000;

    static singleton() {
        if (!this._instance) {
            this._instance = new this();
        }
        return this._instance;
    }

    constructor() {
        super();
        if (this.constructor._instance) {
            throw new Error('Invalid instantiation');
        }
        this._retryBackoff = 30_000;
        this._resyncId = null;
        this._offset = 0;
        this.sync();
    }

    sync() {
        console.info("Establishing robust real-time clock...");
        clearTimeout(this._resyncId);
        const p = this._syncing = time.establish(/*force*/ true);
        p.then(() => {
            if (p === this._syncing) {
                this._resyncId = setTimeout(() => this.sync(), this.resyncDelay);
            }
            this._checkOffset();
        });
        p.catch(e => {
            console.error("Could not establish robust time source:", e);
            this._resyncId = setTimeout(() => this.sync(), this._retryBackoff);
            this._retryBackoff *= 2;
        });
    }

    wait() {
        return this._syncing;
    }

    getTime() {
        try {
            return time.getTime();
        } catch(e) {
            return Date.now();
        }
    }

    _checkOffset() {
        const prevOffset = this._offset;
        this._offset = Date.now() - this.getTime();
        const delta = this._offset - prevOffset;
        if (Math.abs(delta) > 100) {
            this.emit('delta', {offset: this._offset, delta});
            if (Math.abs(delta) > 5000) {
                console.warn("Course clock offset detected:", this._offset);
                this.emit('course-delta', {offset: this._offset, delta});
            }
        }
    }
}
RobustRealTimeClock.singleton();


function quit(retcode) {
    quiting = true;
    if (retcode) {
        electron.app.exit(retcode);
    } else {
        electron.app.quit();
    }
}
rpc.register(quit);


function timeout(ms) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


async function quitAfterDelay(delay) {
    const dialog = windows.confirmDialog({
        width: 390,
        height: 272,
        confirmButton: 'Quit Now',
        confirmClass: 'caution',
        cancelButton: 'Cancel',
        title: 'Sauce Shutdown',
        message: 'Sauce Shutdown',
        detail: `Automatic shutdown in ${delay} seconds...`,
        parent: this?.getOwnerBrowserWindow(),
    });
    await dialog.visible;
    const start = performance.now();
    let countdown;
    const timeout = new Promise(resolve => {
        countdown = setInterval(() => {
            const rem = delay - (performance.now() - start) / 1000;
            if (rem >= 0) {
                dialog.setDetail(`Automatic shutdown in ${Math.round(rem)} seconds...`);
            } else {
                clearInterval(countdown);
                resolve(true);
            }
        }, 1000);
    });
    try {
        if (await Promise.race([dialog, timeout])) {
            electron.app.quit();
        }
    } finally {
        clearInterval(countdown);
        dialog.close();
    }
}
rpc.register(quitAfterDelay);


function restart() {
    electron.app.relaunch();
    quit();
}
rpc.register(restart);


electron.app.on('second-instance', (ev,_, __, {type, ...args}) => {
    if (type === 'quit') {
        console.warn("Another instance requested us to quit.");
        quit();
    } else if (type === 'open-url') {
        electron.app.focus();
        electron.app.emit('open-url', null, args.url);
    }
});
electron.app.on('before-quit', () => void (quiting = true));


function monitorWindowForEventSubs(win, subs) {
    // NOTE: MacOS emits show/hide AND restore/minimize but Windows only does restore/minimize
    const resumeEvents = ['responsive', 'show', 'restore'];
    const suspendEvents = ['unresponsive', 'hide', 'minimize'];
    const shutdownEvents = ['destroyed', 'did-navigate'];
    const listeners = [];
    const resume = (who) => {
        for (const x of subs) {
            if (x.suspended) {
                console.debug("Resume subscription:", x.event, win.ident(), who);
                sauceApp.rpcEventEmitters.subscribe(x.source, x.event, x.callback, x.options);
                x.suspended = false;
            }
        }
    };
    const suspend = (who) => {
        for (const x of subs) {
            if (!x.suspended && !x.persistent) {
                console.debug("Suspending subscription:", x.event, win.spec.id, who);
                sauceApp.rpcEventEmitters.unsubscribe(x.source, x.event, x.callback, x.options);
                x.suspended = true;
            }
        }
    };
    const shutdown = () => {
        windowEventSubs.delete(win);
        for (const x of subs) {
            if (!x.suspended) {
                sauceApp.rpcEventEmitters.unsubscribe(x.source, x.event, x.callback, x.options);
            }
            // Must be after unsubscribe() because of logs source which eats its own tail otherwise.
            console.debug("Shutdown subscription:", x.event, win.ident());
        }
        if (!win.isDestroyed()) {
            for (const x of shutdownEvents) {
                win.webContents.off(x, shutdown);
            }
            for (const [name, cb] of listeners) {
                win.off(name, cb);
            }
        }
        subs.length = 0;
    };
    for (const x of shutdownEvents) {
        win.webContents.once(x, shutdown);
    }
    for (const x of resumeEvents) {
        const cb = ev => resume(x, ev);
        win.on(x, cb);
        listeners.push([x, cb]);
    }
    for (const x of suspendEvents) {
        const cb = ev => {
            suspend(x, ev);
        };
        win.on(x, cb);
        listeners.push([x, cb]);
    }
}


let _ipcSubIdInc = 1;
electron.ipcMain.handle('subscribe', (ev, {event, persistent, source='stats', options}) => {
    const win = ev.sender.getOwnerBrowserWindow();
    if (!sauceApp.rpcEventEmitters.has(source)) {
        throw new TypeError('Invalid emitter source: ' + source);
    }
    const ch = new electron.MessageChannelMain();
    const ourPort = ch.port1;
    const theirPort = ch.port2;
    // Using JSON is a massive win for CPU and memory.
    const callback = data => {
        let json = serialCache.get(data);
        if (!json) {
            if (data === undefined) {
                console.warn("Converting undefined to null: prevent this at the emitter source");
                data = null;
            }
            json = JSON.stringify(data);
            if (data != null && typeof data === 'object') {
                serialCache.set(data, json);
            }
        }
        ourPort.postMessage(json);
    };
    const subId = _ipcSubIdInc++;
    const sub = {subId, event, source, persistent, options, callback};
    let subs = windowEventSubs.get(win);
    if (subs) {
        subs.push(sub);
    } else {
        subs = [sub];
        windowEventSubs.set(win, subs);
        monitorWindowForEventSubs(win, subs);
    }
    if (persistent || (win.isVisible() && !win.isMinimized())) {
        console.debug("Startup subscription:", event, win.ident());
        sauceApp.rpcEventEmitters.subscribe(source, event, callback, options);
    } else {
        console.debug("Added suspended subscription:", event, win.ident());
    }
    ev.sender.postMessage('subscribe-port', subId, [theirPort]);
    return subId;
});

electron.ipcMain.handle('unsubscribe', (ev, {subId}) => {
    const win = ev.sender.getOwnerBrowserWindow();
    const subs = windowEventSubs.get(win);
    if (!subs) {
        return;
    }
    const idx = subs.findIndex(x => x.subId === subId);
    if (idx === -1) {
        return;
    }
    const {source, event, callback, options} = subs.splice(idx, 1)[0];
    console.debug("Remove subscription:", event, win.ident());
    sauceApp.rpcEventEmitters.unsubscribe(source, event, callback, options);
});
electron.ipcMain.handle('rpc', (ev, name, ...args) =>
    rpc.invoke.call(ev.sender, name, ...args).then(JSON.stringify));

rpc.register(() => isDEV, {name: 'isDEV'});
rpc.register(url => electron.shell.openExternal(url), {name: 'openExternalLink'});


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


async function checkForUpdates(channel) {
    autoUpdater.disableWebInstaller = true;
    autoUpdater.autoDownload = false;
    autoUpdater.channel = {
        stable: 'latest',
        beta: 'beta',
        alpha: 'alpha'
    }[channel] || 'latest';
    // NOTE: The github provider for electron-updater is pretty nuanced.
    // We might want to replace it with our own at some point as this very
    // important logic.
    autoUpdater.allowPrerelease = autoUpdater.channel !== 'latest';
    let updateAvail;
    // Auto updater was written by an alien.  Must use events to affirm update status.
    autoUpdater.once('update-available', () => void (updateAvail = true));
    console.info(`Checking for update on channel: ${autoUpdater.channel}`);
    try {
        const update = await autoUpdater.checkForUpdates();
        if (updateAvail) {
            return update.updateInfo;
        }
    } catch(e) {
        // A variety of non critical conditions can lead to this, log and move on.
        console.warn("Auto update problem:", e.stack);
        return;
    }
}


class ElectronSauceApp extends app.SauceApp {
    getAppMetrics() {
        return electron.app.getAppMetrics();
    }

    getDebugInfo() {
        return Object.assign(super.getDebugInfo(), {
            gpu: electron.app.getGPUFeatureStatus(),
        });
    }

    async resetStorageState(sender) {
        const confirmed = await windows.confirmDialog({
            title: 'Confirm Reset State',
            message: '<h3>This operation will reset ALL settings completely!</h3>' +
                '<h4>Are you sure you want continue?</h4>',
            confirmButton: 'Yes, reset to defaults',
            confirmClass: 'danger',
            parent: sender.getOwnerBrowserWindow(),
            height: 280,
        });
        if (confirmed) {
            console.warn('Reseting state and restarting...');
            await secrets.remove('zwift-login').catch(report.error);
            await secrets.remove('zwift-monitor-login').catch(report.error);
            await electron.session.defaultSession.clearStorageData().catch(report.error);
            await electron.session.defaultSession.clearCache().catch(report.error);
            const patreonSession = electron.session.fromPartition('persist:patreon');
            await patreonSession.clearStorageData().catch(report.error);
            await patreonSession.clearCache().catch(report.error);
            for (const {id} of windows.getProfiles()) {
                const s = windows.loadSession(id);
                await s.clearStorageData().catch(report.error);
                await s.clearCache().catch(report.error);
            }
            super.resetStorageState();
            restart();
        }
    }

    async start(options) {
        await super.start(options);
        hotkeys.registerAction({
            id: 'statsproc-start-lap',
            name: 'Trigger Lap',
            callback: () => this.statsProc.startLap()
        });
        hotkeys.registerAction({
            id: 'statsproc-reset-stats',
            name: 'Reset Stats',
            callback: () => this.statsProc.resetStats()
        });
        if (this.gameMonitor) {
            this.gameMonitor.on('multiple-logins', () => {
                electron.dialog.showErrorBox(
                    'Multiple Logins Detected',
                    'Your Monitor Zwift Login is being used by more than 1 application. ' +
                    'This is usually an indicator that your Monitor Login is not the correct one. ' +
                    'Go to the main settings panel and logout if it is incorrect.');
            });
        }
    }
}


async function zwiftAuthenticate({ident, ...options}) {
    let creds;
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
    if (startupDialog) {
        startupDialog.close();
    }
    creds = await windows.zwiftLogin(options);
    if (creds) {
        await secrets.set(ident, creds);
        return creds.username;
    } else {
        return false;
    }
}


async function zwiftReauthenticate({ident, api}) {
    const creds = await secrets.get(ident);
    if (!creds) {
        throw new Error("No credentials available");
    }
    await api.authenticate(creds.username, creds.password);
}


async function maybeDownloadAndInstallUpdate({version}) {
    if (startupDialog) {
        startupDialog.close();
    }
    const confirmWin = await windows.updateConfirmationWindow(version);
    if (!confirmWin) {
        return;  // later
    }
    autoUpdater.on('download-progress', ev => {
        console.info('Sauce update download progress:', ev.percent);
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
    quiting = true;  // auto updater closes windows before quitting. Must not save state.
    autoUpdater.quitAndInstall();
    throw new Exiting();
}


function createStartupDialog() {
    const d = windows.dialog({
        width: 500,
        height: 270,
        title: 'Starting Sauce for Zwift™',
        message: '<h2>Starting Sauce for Zwift™</h2>',
        show: false,
    });
    d.progress = 0;
    d.setProgress = p => {
        d.progress = p;
        if (p > 1) {
            console.warn("Startup progress incremented past 1.0");
        }
        d.setFooter(`<progress style="width: 80vw" value="${p}"></progress>`);
        return d;
    };
    d.addProgress = t => d.setProgress(d.progress + t);
    d.setProgress(0);
    return d;
}


export async function main({logEmitter, logFile, logQueue, sentryAnonId,
                            loaderSettings, saveLoaderSettings, buildEnv}) {
    const s = Date.now();
    const args = parseArgs([
        // Do not remove headless arg.  It's informational here but handled by loader.mjs
        {arg: 'headless', type: 'switch',
         help: 'Run in headless mode.  NOTE: All settings for headless mode are separate from normal mode.'},
        {arg: 'disable-monitor', type: 'switch',
         help: 'Do not start the Zwift monitor (no data)'},
        {arg: 'athlete-id', type: 'num', label: 'ATHLETE_ID',
         help: 'Override the athlete ID for the main Zwift account'},
        {arg: 'random-watch', type: 'num', optional: true, label: 'COURSE_ID',
         help: 'Watch random athlete; optionally specify a Course ID to choose the athlete from'},
        {arg: 'disable-game-connection', type: 'switch',
         help: 'Disable the companion protocol service'},
        {arg: 'debug-game-fields', type: 'switch', default: isDEV,
         help: 'Include otherwise hidden fields from game data'},
    ]);
    if (!args || args.help) {
        quit(!args ? 1 : 0);
        return;
    }
    const appPath = electron.app.getPath('userData');
    storage.initialize(appPath);
    sauceApp = new ElectronSauceApp({appPath, buildEnv});
    global.sauceApp = sauceApp;
    startupDialog = createStartupDialog();
    if (logEmitter) {
        sauceApp.rpcEventEmitters.set('logs', logEmitter);
        rpc.register(() => logQueue, {name: 'getLogs'});
        rpc.register(() => logQueue.length = 0, {name: 'clearLogs'});
        rpc.register(() => electron.shell.showItemInFolder(logFile), {name: 'showLogInFolder'});
    }
    rpc.register(() => sentryAnonId, {name: 'getSentryAnonId'});
    rpc.register(() => !isDEV ? buildEnv.sentry_dsn : null, {name: 'getSentryDSN'});
    rpc.register(key => loaderSettings[key], {name: 'getLoaderSetting'});
    rpc.register((key, value) => {
        loaderSettings[key] = value;
        saveLoaderSettings(loaderSettings);
    }, {name: 'setLoaderSetting'});
    sauceApp.rpcEventEmitters.set('windows', windows.eventEmitter);
    sauceApp.rpcEventEmitters.set('updater', autoUpdater);
    sauceApp.rpcEventEmitters.set('mods', mods.eventEmitter);
    menu.installTrayIcon();
    menu.setAppMenu();
    const exclusionsLoading = app.getExclusions(appPath);
    let maybeUpdateAndRestart = () => undefined;
    const lastVersion = sauceApp.getSetting('lastVersion');
    if (lastVersion !== pkg.version) {
        const upChLevel = updateChannelLevels[sauceApp.getSetting('updateChannel')] || 0;
        if (upChLevel < updateChannelLevels[defaultUpdateChannel]) {
            sauceApp.setSetting('updateChannel', defaultUpdateChannel);
            console.info("Update channel set to:", defaultUpdateChannel);
        }
        if (lastVersion) {
            console.info(`Sauce was updated: ${lastVersion} -> ${pkg.version}`);
            await electron.session.defaultSession.clearCache();
            for (const {id} of windows.getProfiles()) {
                await windows.loadSession(id).clearCache();
            }
            await windows.showReleaseNotes();
        } else {
            console.info("First time invocation: Welcome to Sauce for Zwift");
            await windows.welcomeSplash();
        }
        sauceApp.setSetting('lastVersion', pkg.version);
    } else if (!isDEV) {
        const channel = sauceApp.getSetting('updateChannel', defaultUpdateChannel);
        const updateCheck = checkForUpdates(channel);
        maybeUpdateAndRestart = async () => {
            const updateInfo = await updateCheck;
            if (updateInfo) {
                await maybeDownloadAndInstallUpdate(updateInfo);
            }
        };
    }
    const isSauceProtoHandler = electron.app.setAsDefaultProtocolClient(sauceScheme);
    if (!isSauceProtoHandler) {
        if (os.platform() !== 'linux') {
            console.error("Unable to register as protocol handler for:", sauceScheme);
        }
    } else {
        electron.app.on('open-url', (ev, _url) => {
            const url = new URL(_url);
            if (url.protocol !== sauceScheme + ':') {
                console.error("Unexpected protocol:", url.protocol);
                return;
            }
            // XXX Just make a signal thing between this and windows.patronLink..
            // It's silly to proxy through sauceApp just because it's an EventEmitter
            sauceApp.emit('external-open', {
                name: url.host,
                path: url.pathname,
                data: Object.fromEntries(url.searchParams),
            });
        });
    }
    try {
        if (!await windows.eulaConsent() ||
            !await windows.patronLink({sauceApp, requireLegacy: !isSauceProtoHandler})) {
            console.error('Activation failed or aborted by user.');
            await maybeUpdateAndRestart();
            return quit();
        }
    } catch(e) {
        console.error('Activation error:', e);
        await electron.dialog.showErrorBox('Activation Error', '' + e);
        await maybeUpdateAndRestart();
        return quit(1);
    }
    startupDialog.setDetail('Logging into Zwift...');
    startupDialog.addProgress(0.1);
    startupDialog.show();
    const rrtClock = RobustRealTimeClock.singleton();
    const getTime = rrtClock.getTime.bind(rrtClock);
    try {
        await Promise.race([
            rrtClock.wait(),
            timeout(10_000)
        ]);
    } catch(e) {
        console.warn("Failed to get robust time source (in timely manor):", e);
    }
    const zwiftAPI = new zwift.ZwiftAPI({getTime});
    const zwiftMonitorAPI = new zwift.ZwiftAPI({getTime});
    const mainUser = await zwiftAuthenticate({api: zwiftAPI, ident: 'zwift-login'});
    startupDialog.addProgress(0.1);
    if (!mainUser) {
        await maybeUpdateAndRestart();
        return quit(1);
    }
    const monUser = await zwiftAuthenticate({
        api: zwiftMonitorAPI,
        ident: 'zwift-monitor-login',
        monitor: true,
    });
    startupDialog.addProgress(0.1);
    if (!monUser) {
        await maybeUpdateAndRestart();
        return quit(1);
    }
    if (mainUser === monUser) {
        startupDialog.close();
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
    startupDialog.setDetail('Checking for updates...');
    await maybeUpdateAndRestart();
    const exclusions = await exclusionsLoading;
    zwiftAPI.setExclusions(exclusions);
    zwiftMonitorAPI.setExclusions(exclusions);
    startupDialog.addProgress(0.2);
    for (const x of windowManifests) {
        if (!x.webOnly) {
            windows.registerWidgetWindow(x);
        }
    }
    mods.eventEmitter.on('initializing', avail =>
        avail.length && startupDialog.setDetail(`Initializing ${avail.length} MODS...`));
    mods.eventEmitter.on('updating-mod', ({mod, latestRelease}) =>
        startupDialog.setDetail(`Updating Mod: ${mod.manifest.name} -> ${latestRelease.version}`));
    const modPath = path.join(electron.app.getPath('documents'), 'SauceMods');
    let enablingNewMods;
    const availMods = await mods.init(modPath, path.join(appPath, 'mods'));
    startupDialog.addProgress(0.2);
    for (const mod of availMods) {
        if (mod.isNew) {
            startupDialog.close();
            const enable = await windows.confirmDialog({
                title: 'New Sauce MOD Found',
                width: 460,
                height: 500,
                message: `<h3>New Sauce MOD was found:</h3><h4>Would you like to enable it now?</h4>`,
                detail: `
                    <b>${mod.manifest.name} </b> | by: ${(mod.manifest.author || '<Unknown>')}
                    <hr/>
                    <small>${mod.manifest.description || ''}</small>
                `,
                footer: `<b>CAUTION:</b> Only enable this if you trust the author and have ` +
                    `intentionally added it.`,
                confirmButton: 'Enable Now',
                cancelButton: 'Ignore',
                confirmClass: 'caution',
            });
            mods.setEnabled(mod.id, enable);
            if (enable) {
                enablingNewMods = true;
            }
        }
    }
    if (enablingNewMods) {
        await Promise.race([
            electron.dialog.showMessageBox({
                type: 'info',
                title: 'Activating New Mods',
                message: `Sauce for Zwift™ will restart in 4 seconds...`,
                noLink: true,
                textWidth: 400,
            }),
            sleep(4000)
        ]);
        return restart();
    }
    for (const x of mods.contentScripts) {
        try {
            windows.registerModContentScript(x);
        } catch(e) {
            console.error("Failed to register Mod Content Script:", e);
        }
    }
    for (const x of mods.contentCSS) {
        try {
            windows.registerModContentStylesheet(x);
        } catch(e) {
            console.error("Failed to register Mod Content Stylesheet:", e);
        }
    }
    for (const x of mods.getWindowManifests()) {
        try {
            windows.registerWidgetWindow(x);
        } catch(e) {
            console.error("Failed to register Mod window:", x, e);
        }
    }
    startupDialog.addProgress(0.1);
    startupDialog.setDetail(`Starting data processor...`);
    await sauceApp.start({...args, exclusions, zwiftAPI, zwiftMonitorAPI});
    startupDialog.addProgress(0.1);
    startupDialog.setDetail(`Opening windows...`);
    const openingWindows = windows.openWidgetWindows();
    const winProgressOfft = startupDialog.progress;
    openingWindows.on('progress', (p, count, total) => {
        startupDialog.setProgress(winProgressOfft + (1 - winProgressOfft) * p);
        if (p >= (1 - 1e-5)) {
            startupDialog.close();
        }
    });
    menu.setWebServerURL(sauceApp.getWebServerURL());
    menu.updateTrayMenu();
    hotkeys.initHotkeys();
    electron.powerMonitor.on('thermal-state-change', state =>
        console.warn("Power thermal state change:", state));
    electron.powerMonitor.on('speed-limit-change', limit =>
        console.warn("Power CPU speed limit change:", limit));

    async function reauthZwift() {
        console.info("Reauthenticating with zwift...");
        try {
            if (!zwiftAPI.isAuthenticated()) {
                if (zwiftAPI.canRefreshToken()) {
                    await zwiftAPI.refreshToken();
                } else {
                    await zwiftReauthenticate({api: zwiftAPI, ident: 'zwift-login'});
                }
            }
            if (!zwiftMonitorAPI.isAuthenticated()) {
                if (zwiftMonitorAPI.canRefreshToken()) {
                    await zwiftMonitorAPI.refreshToken();
                } else {
                    await zwiftReauthenticate({api: zwiftMonitorAPI, ident: 'zwift-monitor-login'});
                }
            }
        } catch(e) {
            console.error("Zwift reauth failed:", e);
        }
    }

    let schedReauth;
    electron.powerMonitor.on('suspend', () => console.warn("System is being suspended"));
    electron.powerMonitor.on('resume', () => {
        console.warn("System is waking from suspend");
        // Provide grace period for OS to get its clocks in order (or not)..
        clearTimeout(schedReauth);
        setTimeout(() => {
            clearTimeout(schedReauth);
            schedReauth = setTimeout(reauthZwift, 10_000);
            this.sync();
        }, 5000);
    });
    rrtClock.on('course-delta', () => {
        console.warn("Large time delta detected");
        clearTimeout(schedReauth);
        schedReauth = setTimeout(reauthZwift, 10_000);
    });

    if (os.platform() === 'darwin' && sauceApp.getSetting('emulateFullscreenZwift')) {
        windows.activateFullscreenZwiftEmulation();
    }

    console.debug(`Startup took ${Date.now() - s}ms`);
    started = true;
}

// Dev tools prototyping
global.zwift = zwift;
global.windows = windows;
global.electron = electron;
global.mods = mods;
