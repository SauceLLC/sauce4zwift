import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import * as storage from './storage.mjs';
import menu from './menu.mjs';
import * as patreon from './patreon.mjs';
import * as rpc from './rpc.mjs';
import * as Sentry from '@sentry/node';
import {Dedupe} from '@sentry/integrations';
import * as webServer from './webserver.mjs';
import * as game from './game.mjs';
import {beforeSentrySend, setSentry} from '../shared/sentry-util.mjs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const {autoUpdater} = require('electron-updater');
const electron = require('electron');

let appQuiting = false;
let started;

try {
    storage.load(0);
} catch(e) {
    appQuiting = true;
    console.error('Storage error:', e);
    Promise.all([
        storage.reset(),
        electron.dialog.showErrorBox('Storage error. Reseting database...', '' + e)
    ]).then(() => electron.app.exit(1));
}

let sentryAnonId;
if (electron.app.isPackaged) {
    setSentry(Sentry);
    Sentry.init({
        dsn: "https://df855be3c7174dc89f374ef0efaa6a92@o1166536.ingest.sentry.io/6257001",
        // Sentry changes the uncaught exc behavior to exit the process.  I think that's a bug
        // but this is the only workaround for now.
        integrations: data => [new Dedupe(), ...data.filter(x => x.name !== 'OnUncaughtException')],
        beforeSend: beforeSentrySend,
    });
    // No idea, just copied from https://github.com/getsentry/sentry-javascript/issues/1661
    global.process.on('uncaughtException', e => {
        const hub = Sentry.getCurrentHub();
        hub.withScope(async scope => {
            scope.setLevel('fatal');
            hub.captureException(e, {originalException: e});
        });
        console.error('Uncaught (but reported)', e);
    });
    Sentry.setTag('version', pkg.version);
    let id = storage.load('sentry-id');
    if (!id) {
        // It's just an anonymous value to distinguish errors and feedback
        id = crypto.randomBytes(16).toString("hex");
        storage.save('sentry-id', id);
    }
    Sentry.setUser({id});
    sentryAnonId = id;
} else {
    console.info("Sentry disabled for unpackaged app");
}

const appSettingDefaults = {
    zwiftLogin: false,
    webServerEnabled: true,
    webServerPort: 1080,
};

const windowManifests = [{
    type: 'overview',
    page: 'overview.html',
    prettyName: 'Overview',
    prettyDesc: 'Main top window for overall control and stats.',
    private: true,
    options: {relWidth: 0.6, height: 40, relX: 0.2, y: 0},
    webPreferences: {backgroundThrottling: false}, // XXX Doesn't appear to work
    hideable: false,
}, {
    type: 'watching',
    page: 'watching.html',
    prettyName: 'Currently Watching',
    prettyDesc: 'Replacement window for stats of the athlete being watched.',
    options: {relWidth: 0.18, aspectRatio: 1},
}, {
    type: 'groups',
    page: 'groups.html',
    prettyName: 'Groups',
    prettyDesc: 'A zoomable view of groups of athletes.',
    options: {relWidth: 0.15, relHeight: 0.65},
}, {
    type: 'chat',
    page: 'chat.html',
    prettyName: 'Chat',
    prettyDesc: 'Chat dialog from nearby athletes.',
    options: {relWidth: 0.18, aspectRatio: 2},
}, {
    type: 'nearby',
    page: 'nearby.html',
    prettyName: 'Nearby Athletes',
    prettyDesc: 'A sortable data table of nearby athletes.',
    options: {width: 800, height: 400, center: true},
    overlay: false,
}];
rpc.register('getWindowManifests', () => windowManifests);

const defaultWindows = [{
    id: 'default-overview-1',
    type: 'overview',
}, {
    id: 'default-watching-1',
    type: 'watching',
    options: {x: 8, y: 64},
}, {
    id: 'default-groups-1',
    type: 'groups',
    options: {x: -280, y: -10},
}, {
    id: 'default-chat-1',
    type: 'chat',
    options: {x: 320, y: 230},
}];

const appSettingsKey = 'app-settings';
// NEVER use app.getAppPath() it uses asar for universal builds
const appPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = path.join(appPath, 'pages');
const appIcon = electron.nativeImage.createFromPath(path.join(appPath,
    'build/images/app-icon.icos'));
const activeWindows = new Map();
const subWindows = new WeakMap();
const windowsUpdateListeners = new Map();
// Use non-electron naming for windows updater.
// https://github.com/electron-userland/electron-builder/issues/2700
electron.app.setAppUserModelId('io.saucellc.sauce4zwift'); // must match build.appId for windows
if (electron.app.dock) {
    electron.app.dock.setIcon(appIcon);
}
electron.app.on('window-all-closed', () => {
    if (started) {
        electron.app.quit();
    }
});
electron.app.on('activate', async () => {
    // Clicking on the app icon..
    if (electron.BrowserWindow.getAllWindows().length === 0) {
        openAllWindows();
    }
});
electron.app.on('app-setting-change', async (key, value) => {
    if (key === 'disableGPU') {
        const disableGPUFile = path.join(electron.app.getPath('userData'), 'disabled-gpu');
        if (value) {
            await (await fs.open(disableGPUFile, 'w')).close();
        } else {
            await fs.unlink(disableGPUFile);
        }
    }
});
electron.app.on('before-quit', () => {
    appQuiting = true;
    Sentry.flush();
});
electron.ipcMain.on('getWindowContextSync', ev => {
    let returnValue = {
        id: null,
        type: null,
    };
    try {
        const o = activeWindows.get(ev.sender) || subWindows.get(ev.sender);
        if (o) {
            returnValue = {
                id: o.spec.id,
                type: o.spec.type,
            };
        }
    } finally {
        ev.returnValue = returnValue; // MUST set otherwise page blocks.
    }
});


let _appSettings;
export function getAppSetting(key, def) {
    if (!_appSettings) {
        _appSettings = storage.load(appSettingsKey) || {...appSettingDefaults};
    }
    if (!Object.prototype.hasOwnProperty.call(_appSettings, key) && def !== undefined) {
        _appSettings[key] = def;
        storage.save(appSettingsKey, _appSettings);
    }
    return _appSettings[key];
}
rpc.register('getAppSetting', getAppSetting);


export function setAppSetting(key, value) {
    if (!_appSettings) {
        _appSettings = storage.load(appSettingsKey) || {...appSettingDefaults};
    }
    _appSettings[key] = value;
    storage.save(appSettingsKey, _appSettings);
    electron.app.emit('app-setting-change', key, value);
}
rpc.register('setAppSetting', setAppSetting);

rpc.register('appIsPackaged', () => electron.app.isPackaged);
rpc.register('getVersion', () => pkg.version);
rpc.register('getMonitorIP', () => pkg.version);
rpc.register('getSentryAnonId', () => sentryAnonId);
rpc.register('openExternalLink', url => electron.shell.openExternal(url));
rpc.register('restart', () => {
    appQuiting = true;
    electron.app.relaunch();
    electron.app.quit();
});
rpc.register('quit', () => {
    appQuiting = true;
    electron.app.quit();
});
rpc.register('hideAllWindows', () => {
    for (const {win, spec} of activeWindows.values()) {
        if (spec.hideable !== false && spec.overlay !== false) {
            win.hide();
        }
    }
});
rpc.register('showAllWindows', () => {
    for (const {win, spec} of activeWindows.values()) {
        if (spec.hideable !== false && spec.overlay !== false) {
            win.show();
        }
    }
});
rpc.register('closeWindow', function() {
    const {win, spec} = activeWindows.get(this);
    console.debug('Window close requested:', spec.id);
    win.close();
});
rpc.register('minimizeWindow', function() {
    const {win, spec} = activeWindows.get(this);
    console.debug('Window close requested:', spec.id);
    win.minimize();
});
rpc.register('getGPUFeatureStatus', () => electron.app.getGPUFeatureStatus());
rpc.register('getGPUInfo', () => electron.app.getGPUInfo('complete'));
let _appMetricsPromise;
let _lastAppMetricsTS = 0;
function _getAppMetrics(reentrant) {
    return new Promise(resolve => setTimeout(() => {
        if (reentrant !== true) {
            // Schedule one more in anticipation of pollers
            _appMetricsPromise = _getAppMetrics(true);
        } else {
            _appMetricsPromise = null;
        }
        _lastAppMetricsTS = Date.now();
        resolve(electron.app.getAppMetrics());
    }, 1000 - (Date.now() - _lastAppMetricsTS)));
}
rpc.register('pollAppMetrics', async () => {
    if (!_appMetricsPromise) {
        _appMetricsPromise = _getAppMetrics();
    }
    return await _appMetricsPromise;
});
rpc.register('getWindowSpecForPID', pid => {
    for (const x of electron.BrowserWindow.getAllWindows()) {
        let wc;
        try {
            wc = x.webContents;
        } catch(e) {
            continue;
        }
        if (wc.getOSProcessId() !== pid) {
            continue;
        }
        if (activeWindows.has(wc)) {
            return activeWindows.get(wc).spec;
        } else if (subWindows.has(wc)) {
            return subWindows.get(wc).spec;
        }
    }
});


function getActiveWindow(id) {
    for (const w of activeWindows.values()) {
        if (w.spec.id === id) {
            return w.win;
        }
    }
}


let _windows;
function getWindows() {
    if (!_windows) {
        _windows = storage.load('windows');
        if (!_windows) {
            _windows = {};
            for (const x of defaultWindows) {
                createWindow(x);
            }
        }
    }
    return _windows;
}
rpc.register('getWindows', getWindows);


rpc.register('listenForWindowUpdates', function(domEvent) {
    windowsUpdateListeners.set(new WeakRef(this), domEvent);
});


let _windowsUpdatedTimeout;
function setWindows(wins) {
    _windows = wins;
    storage.save('windows', _windows);
    clearTimeout(_windowsUpdatedTimeout);
    _windowsUpdatedTimeout = setTimeout(() => {
        for (const [ref, domEvent] of windowsUpdateListeners.entries()) {
            const sender = ref.deref();
            if (!sender || sender.isDestroyed()) {
                windowsUpdateListeners.delete(ref);
            } else {
                sender.send('browser-message', {domEvent});
            }
        }
    }, 200);
}


function getWindow(id) {
    return getWindows()[id];
}
rpc.register('getWindow', getWindow);


function setWindow(id, data) {
    const wins = getWindows();
    wins[id] = data;
    setWindows(wins);
}
rpc.register('setWindow', setWindow);


function setWindowOpacity(id, opacity) {
    updateWindow(id, {opacity});
    const win = getActiveWindow(id);
    if (win) {
        win.setOpacity(opacity);
    }
}
rpc.register('setWindowOpacity', setWindowOpacity);


function updateWindow(id, updates) {
    const w = getWindow(id);
    Object.assign(w, updates);
    setWindow(id, w);
    return w;
}
rpc.register('updateWindow', updateWindow);


function removeWindow(id) {
    const win = getActiveWindow(id);
    if (win) {
        win.close();
    }
    const wins = getWindows();
    delete wins[id];
    setWindows(wins);
}
rpc.register('removeWindow', removeWindow);


function createWindow({id, type, options, ...state}) {
    id = id || `user-${type}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
    const manifest = windowManifests.find(x => x.type === type);
    setWindow(id, {
        ...manifest,
        id,
        type,
        options,
        ...state,
    });
    return id;
}
rpc.register('createWindow', createWindow);


function focusWindow(id) {
    const win = getActiveWindow(id);
    if (win) {
        win.focus();
    }
}
rpc.register('focusWindow', focusWindow);


function openWindow(id) {
    const spec = getWindow(id);
    if (spec.closed) {
        updateWindow(id, {closed: false});
    }
    _openWindow(id, spec);
}
rpc.register('openWindow', openWindow);


function reopenWindow(id) {
    const win = getActiveWindow(id);
    if (win) {
        win.close();
    }
    openWindow(id);
}
rpc.register('reopenWindow', reopenWindow);


function _openWindow(id, spec) {
    console.debug("Making window:", id, spec.type);
    const overlayOptions = {
        transparent: true,
        hasShadow: false,
        frame: false,
        roundedCorners: false,  // macos only, we use page style instead.
        alwaysOnTop: true,
        maximizable: false,
        fullscreenable: false,
    };
    const manifest = windowManifests.find(x => x.type === spec.type);
    // Order of options is crucial...
    const options = {
        ...(spec.overlay !== false ? overlayOptions : {}),
        ...manifest.options,
        ...spec.options,
        ...spec.position,
        opacity: spec.opacity,
    };
    const win = new electron.BrowserWindow({
        icon: appIcon,
        show: false,
        webPreferences: {
            sandbox: true,
            devTools: !electron.app.isPackaged,
            preload: path.join(appPath, 'src', 'preload', 'common.js'),
            webgl: false,
            ...manifest.webPreferences,
            ...spec.webPreferences,
        },
        ...options,
    });
    if (electron.app.isPackaged) {
        win.removeMenu();
    }
    if (!spec.position && (options.relWidth != null || options.relHeight != null ||
        options.relX != null || options.relY != null || options.x < 0 || options.y < 0)) {
        const {width: sWidth, height: sHeight} = electron.screen.getPrimaryDisplay().size; // XXX
        const width = options.width != null ?
            options.width :
            Math.round(options.relWidth * sWidth);
        const height = options.height != null ?
            options.height :
            options.aspectRatio != null ?
                Math.round(width * options.aspectRatio) :
                Math.round(options.relHeight * sHeight);
        const x = options.x == null ?
            (options.relX ? Math.round(options.relX * sWidth) : null) :
            options.x < 0 ?
                sWidth + options.x - width :
                options.x;
        const y = options.y == null ?
            (options.relY ? Math.round(options.relY * sHeight) : null) :
            options.y < 0 ?
                sHeight + options.y - height :
                options.y;
        win.setSize(width, height);
        if (x != null && y != null) {
            win.setPosition(x, y, false);
        }
    }
    if (spec.overlay !== false) {
        win.setAlwaysOnTop(true, 'screen-saver');
    }
    const webContents = win.webContents;  // Save to prevent electron from killing us.
    activeWindows.set(webContents, {win, spec, activeSubs: new Set()});
    webContents.on('new-window', (ev, url) => {
        // Popups...
        ev.preventDefault();
        const q = new URLSearchParams((new URL(url)).search);
        const wHint = Number(q.get('widthHint'));
        const hHint = Number(q.get('heightHint'));
        let width, height;
        if (wHint || hHint) {
            const {width: sWidth, height: sHeight} = electron.screen.getPrimaryDisplay().size;
            width = Math.round(sWidth * (wHint || 0.5));
            height = Math.round(sHeight * (hHint || 0.5));
        }
        const newWin = new electron.BrowserWindow({
            icon: appIcon,
            show: false,
            width,
            height,
            alwaysOnTop: spec.overlay !== false,
            webPreferences: {
                sandbox: true,
                devTools: !electron.app.isPackaged,
                preload: path.join(appPath, 'src', 'preload', 'common.js'),
            }
        });
        if (spec.overlay !== false) {
            newWin.setAlwaysOnTop(true, 'screen-saver');
        }
        subWindows.set(newWin.webContents, {spec});
        if (electron.app.isPackaged) {
            newWin.removeMenu();
        }
        newWin.loadURL(url);
        newWin.show();
    });
    let saveStateTimeout;
    function onPositionUpdate() {
        const position = win.getBounds();
        clearTimeout(saveStateTimeout);
        saveStateTimeout = setTimeout(() => updateWindow(id, {position}), 200);
    }
    win.on('moved', onPositionUpdate);
    win.on('resized', onPositionUpdate);
    win.on('close', () => {
        activeWindows.delete(webContents);
        if (!appQuiting) {
            updateWindow(id, {closed: true});
        }
    });
    win.loadFile(path.join(pagePath, spec.page));
    win.show();
    return win;
}


function openAllWindows() {
    for (const [id, spec] of Object.entries(getWindows())) {
        if (!spec.closed) {
            _openWindow(id, spec);
        }
    }
}


function makeCaptiveWindow(options={}, webPrefs={}) {
    const win = new electron.BrowserWindow({
        icon: appIcon,
        center: true,
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
            sandbox: true,
            devTools: !electron.app.isPackaged,
            preload: path.join(appPath, 'src', 'preload', 'common.js'),
            ...webPrefs,
        },
        ...options
    });
    if (electron.app.isPackaged) {
        win.removeMenu();
    }
    return win;
}


async function eulaConsent() {
    if (storage.load('eula-consent')) {
        return true;
    }
    const win = makeCaptiveWindow({width: 800, height: 600});
    let closed;
    const consenting = new Promise(resolve => {
        rpc.register('eulaConsent', async agree => {
            if (agree === true) {
                storage.save('eula-consent', true);
                resolve(true);
            } else {
                console.warn("User does not agree to EULA");
                resolve(false);
            }
        });
        win.on('closed', () => (closed = true, resolve(false)));
    });
    win.loadFile(path.join(pagePath, 'eula.html'));
    const consent = await consenting;
    if (!closed) {
        win.close();
    }
    return consent;
}


function maybeShowReleaseNotes() {
    const lastVersion = getAppSetting('lastVersion');
    if (lastVersion === pkg.version) {
        return;
    }
    if (!lastVersion) {
        setAppSetting('lastVersion', pkg.version);
        return;
    }
    const win = makeCaptiveWindow({width: 500, height: 600});
    win.loadFile(path.join(pagePath, 'release-notes.html'));
    win.on('closed', () => setAppSetting('lastVersion', pkg.version));
}


function scrubUA(win) {
    // Prevent Patreon's datedome.co bot service from blocking us.
    const ua = win.webContents.userAgent;
    win.webContents.userAgent = ua.replace(/ SauceforZwift.*? /, ' ').replace(/ Electron\/.*? /, ' ');
}


async function patronLink() {
    let membership = storage.load('patron-membership');
    if (membership && membership.patronLevel >= 10) {
        // XXX Implment refresh once in a while.
        return true;
    }
    const win = makeCaptiveWindow({width: 400, height: 720}, {
        preload: path.join(appPath, 'src', 'preload', 'patron-link.js'),
    });
    scrubUA(win);
    let resolve;
    electron.ipcMain.on('patreon-auth-code', (ev, code) => resolve({code}));
    electron.ipcMain.on('patreon-special-token', (ev, token) => resolve({token}));
    win.on('closed', () => resolve({closed: true}));
    win.loadFile(path.join(pagePath, 'patron.html'));
    while (true) {
        const {code, token, closed} = await new Promise(_resolve => resolve = _resolve);
        if (closed) {
            return false;
        } else if (token) {
            membership = await patreon.getLegacyMembership(token);
        } else {
            const isAuthed = code && await patreon.link(code);
            membership = isAuthed && await patreon.getMembership();
        }
        if (membership && membership.patronLevel >= 10) {
            storage.save('patron-membership', membership);
            win.close();
            return true;
        } else {
            win.loadFile(path.join(pagePath, 'non-patron.html'));
        }
    }
}


async function zwiftLogin() {
    if (!electron.app.isPackaged && storage.load('zwift-token')) {
        return; // let it timeout for testing, but also avoid relentless logins
    }
    const win = makeCaptiveWindow({
        width: 400,
        height: 700,
        show: false,
    }, {
        preload: path.join(appPath, 'src', 'preload', 'zwift-login.js'),
    });
    scrubUA(win);
    const needLoginPromise = new Promise(resolve => {
        electron.ipcMain.on('zwift-login-required', (ev, needLogin) => resolve(needLogin));
    });
    let closed;
    const tokenPromise = new Promise(resolve => {
        electron.ipcMain.on('zwift-token', (ev, token) => resolve(token));
        win.on('closed', () => (closed = true, resolve(false)));
    });
    win.loadURL(`https://www.zwift.com/sign-in`);
    if (await needLoginPromise) {
        console.info("Login to Zwift required...");
        win.show();
    } else {
        console.info("Zwift token refreshing...");
    }
    const token = await tokenPromise;
    if (token) {
        console.info("Zwift token acquired");
    } else {
        console.info("Zwift login failed");
    }
    if (!closed) {
        win.close();
    }
    storage.save('zwift-token', token);
}


async function main() {
    await electron.app.whenReady();
    menu.setAppMenu();
    autoUpdater.checkForUpdatesAndNotify().catch(Sentry.captureException);
    try {
        if (!await eulaConsent() || !await patronLink()) {
            appQuiting = true;
            electron.app.quit();
            return;
        }
    } catch(e) {
        await electron.dialog.showErrorBox('EULA or Patreon Link Error', '' + e);
        appQuiting = true;
        electron.app.exit(1);
        return;
    }
    maybeShowReleaseNotes();
    if (getAppSetting('zwiftLogin')) {
        await zwiftLogin();
    }
    if (game.npcapMissing) {
        electron.shell.beep();
        const installPrompt = makeCaptiveWindow({width: 400, height: 400});
        installPrompt.loadFile(path.join(pagePath, 'npcap-install.html'));
        return;
    }
    let monitor;
    if (process.argv.includes('--garmin-live-track')) {
        const session = process.argv.find((x, i) => i && process.argv[i - 1] == '--garmin-live-track');
        const garminLiveTrack = await import('./garmin_live_track.mjs');
        monitor = await garminLiveTrack.Sauce4ZwiftMonitor.factory({session});
    } else {
        const fakeData = process.argv.includes('--fake-data');
        monitor = await game.Sauce4ZwiftMonitor.factory({fakeData});
    }
    rpc.register('getMonitorIP', () => monitor.ip);
    try {
        await monitor.start();
    } catch(e) {
        try {
            if (e.message.match(/permission denied/i)) {
                await game.getCapturePermission();
                appQuiting = true;
                electron.app.relaunch();
                electron.app.quit();
                return;
            } else {
                throw e;
            }
        } catch(e) {
            await electron.dialog.showErrorBox('Startup Error', '' + e);
            Sentry.captureException(e);
            appQuiting = true;
            setTimeout(() => electron.app.exit(1), 1000);
            return;
        }
    }
    electron.ipcMain.on('subscribe', (ev, {event, domEvent, persistent}) => {
        const {win, activeSubs, spec} = activeWindows.get(ev.sender);
        const sendMessage = data => win.webContents.send('browser-message', {domEvent, data});
        // NOTE: MacOS emits show/hide AND restore/minimize but Windows only does restore/minimize
        const resumeEvents = ['responsive', 'show', 'restore'];
        const suspendEvents = ['unresponsive', 'hide', 'minimize'];
        const shutdownEvents = ['destroyed', 'did-start-loading'];
        const listeners = [];
        function resume(source) {
            if (!activeSubs.has(event)) {
                if (source) {
                    console.debug("Resume subscription:", event, spec.id, source);
                } else {
                    console.debug("Startup subscription:", event, spec.id);
                }
                monitor.on(event, sendMessage);
                activeSubs.add(event);
            }
        }
        function suspend(source) {
            if (activeSubs.has(event)) {
                console.debug("Suspending subscription:", event, spec.id, source);
                monitor.off(event, sendMessage);
                activeSubs.delete(event);
            }
        }
        function shutdown() {
            console.debug("Shutdown subscription:", event, spec.id);
            monitor.off(event, sendMessage);
            for (const x of shutdownEvents) {
                win.webContents.off(x, shutdown);
            }
            for (const [name, cb] of listeners) {
                win.off(name, cb);
            }
            activeSubs.clear();
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
    openAllWindows();
    if (_appSettings.webServerEnabled) {
        webServer.setMonitor(monitor);
        await webServer.start(_appSettings.webServerPort);
    }
    started = true;
}

if (!appQuiting) {
    main();
}
