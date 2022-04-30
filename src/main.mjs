import path from 'node:path';
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

const appSettingsKey = 'app-settings';
// NEVER use app.getAppPath() it uses asar for universal builds
const appPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = path.join(appPath, 'pages');
const appIcon = electron.nativeImage.createFromPath(path.join(appPath,
    'build/images/app-icon.icos'));
const windows = new Map();
// Use non-electron naming for windows updater.
// https://github.com/electron-userland/electron-builder/issues/2700
electron.app.setAppUserModelId('io.saucellc.sauce4zwift'); // must match build.appId for windows


let _appSettings;
export function getAppSetting(key) {
    if (!_appSettings) {
        _appSettings = storage.load(appSettingsKey) || {...appSettingDefaults};
    }
    return _appSettings[key];
}


export function setAppSetting(key, value) {
    if (!_appSettings) {
        _appSettings = storage.load(appSettingsKey) || {...appSettingDefaults};
    }
    _appSettings[key] = value;
    storage.save(appSettingsKey, _appSettings);
    electron.app.emit('app-setting-change', key, value);
}

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

rpc.register('getAppSetting', getAppSetting);
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
rpc.register('hideAllWindows', (options={}) => {
    const autoHide = options.autoHide;
    for (const {win, state, options} of windows.values()) {
        if (options.hideable !== false && !state.hidden && (options.autoHide !== false || !autoHide)) {
            win.hide();
        }
    }
});
rpc.register('showAllWindows', (options={}) => {
    const autoHide = options.autoHide;
    for (const {win, state, options} of windows.values()) {
        if (options.hideable !== false && !state.hidden && (options.autoHide !== false || !autoHide)) {
            win.show();
        }
    }
});


function getWindowState(page) {
    const id = page.split('.')[0];
    return storage.load(`window-${id}`);
}


function setWindowState(page, data) {
    const id = page.split('.')[0];
    storage.save(`window-${id}`, data);
}


function makeFloatingWindow(page, options={}, defaultState={}) {
    const state = getWindowState(page) || defaultState;
    const winOptions = {
        icon: appIcon,
        transparent: true,
        hasShadow: false,
        frame: false,
        roundedCorners: false,  // macos only, we use page style instead.
        alwaysOnTop: true,
        resizable: true,
        maximizable: false,
        fullscreenable: false,
        show: false,
        webPreferences: {
            sandbox: true,
            devTools: !electron.app.isPackaged,
            preload: path.join(appPath, 'src', 'preload', 'common.js'),
        },
        ...options,
        ...state,
    };
    const win = new electron.BrowserWindow(winOptions);
    if (electron.app.isPackaged) {
        win.removeMenu();
    }
    const hasPosition = state.x != null && state.y != null && state.width && state.height;
    if (!hasPosition && (options.relWidth != null || options.relHeight != null ||
        options.relX != null || options.relY != null || options.x < 0 || options.y < 0)) {
        const {width: sWidth, height: sHeight} = electron.screen.getPrimaryDisplay().size;
        const width = options.width == null ? Math.round(options.relWidth * sWidth) : options.width;
        const height = options.height == null ? Math.round(options.relHeight * sHeight) : options.height;
        const x = options.x == null ? Math.round(options.relX * sWidth) :
            options.x < 0 ? sWidth + options.x - width : options.x;
        const y = options.y == null ? Math.round(options.relY * sHeight) :
            options.y < 0 ? sHeight + options.y - height : options.y;
        win.setSize(width, height);
        win.setPosition(x, y, false);
    }
    if (winOptions.alwaysOnTop) {
        win.setAlwaysOnTop(true, 'screen-saver');
    }
    windows.set(win.webContents, {win, state, options, activeSubs: new Set()});
    let closed;
    win.webContents.on('new-window', (ev, url) => {
        // Popups...
        ev.preventDefault();
        const q = new URLSearchParams((new URL(url)).search);
        const newWin = new electron.BrowserWindow({
            icon: appIcon,
            resizable: true,
            maximizable: true,
            fullscreenable: true,
            show: false,
            webPreferences: {
                sandbox: true,
                devTools: !electron.app.isPackaged,
                preload: path.join(appPath, 'src', 'preload', 'common.js'),
            }
        });
        if (electron.app.isPackaged) {
            newWin.removeMenu();
        }
        const wHint = Number(q.get('widthHint'));
        const hHint = Number(q.get('heightHint'));
        if (wHint || hHint) {
            const {width: sWidth, height: sHeight} = electron.screen.getPrimaryDisplay().size;
            const width = Math.round(sWidth * (wHint || 0.5));
            const height = Math.round(sHeight * (hHint || 0.5));
            newWin.setSize(width, height);
            newWin.setPosition(Math.round((sWidth - width) / 2), Math.round((sHeight - height) / 2));  // centered
        }
        newWin.loadURL(url);
        newWin.show();
    });
    let saveStateTimeout;
    function onPositionUpdate() {
        Object.assign(state, win.getBounds());
        clearTimeout(saveStateTimeout);
        saveStateTimeout = setTimeout(() => setWindowState(page, state), 200);
    }
    function onHide(ev) {
        if (appQuiting || options.hideable === false) {
            return;
        }
        state.hidden = true;
        setWindowState(page, state);
    }
    function onShow(ev) {
        state.hidden = false;
        setWindowState(page, state);
    }
    function onWindowMessage(name, callback) {
        electron.ipcMain.on(name, (ev, ...args) => {
            if (!closed && ev.sender === win.webContents) {
                callback(ev, ...args);
            }
        });
    }
    onWindowMessage('close', () => win.minimize());
    win.on('moved', onPositionUpdate);
    win.on('resized', onPositionUpdate);
    win.on('minimize', onHide);
    win.on('closed', () => {
        closed = true;
        windows.delete(win);
        onHide();
    });
    win.on('restore', onShow);
    win.loadFile(path.join(pagePath, page));
    if (options.show !== false) {
        if (state.hidden) {
            win.minimize();
        } else {
            win.show();
        }
    }
    return win;
}


function createWindows(monitor) {
    const nearbyOverlayMode = getAppSetting('nearbyOverlayMode');
    const nearbyOptions = nearbyOverlayMode ? {} : {alwaysOnTop: false,
        transparent: false, frame: true, maximizable: true, fullscreenable: true, autoHide: false};
    makeFloatingWindow('overview.html', {relWidth: 0.6, height: 40, relX: 0.2, y: 0, hideable: false});
    makeFloatingWindow('watching.html', {width: 260, height: 260, x: 8, y: 64});
    makeFloatingWindow('groups.html', {width: 235, height: 650, x: -280, y: -10});
    makeFloatingWindow('chat.html', {width: 280, height: 580, x: 320, y: 230});
    makeFloatingWindow('nearby.html', {width: 800, height: 400, x: 20, y: 20, ...nearbyOptions}, {hidden: true});
}

if (electron.app.dock) {
    electron.app.dock.setIcon(appIcon);
}

electron.app.on('window-all-closed', () => {
    if (started) {
        electron.app.quit();
    }
});


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
        backgroundThrottling: false,
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
    electron.app.on('before-quit', () => {
        appQuiting = true;
        Sentry.flush();
    });
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
        monitor = await garminLiveTrack.Sauce4ZwiftMonitor.factory(session);
    } else {
        monitor = await game.Sauce4ZwiftMonitor.factory();
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
    electron.ipcMain.on('subscribe', (ev, {event, domEvent}) => {
        const {win, activeSubs} = windows.get(ev.sender);
        const sendMessage = data => win.webContents.send('browser-message', {domEvent, data});
        // NOTE: MacOS emits show/hide AND restore/minimize but Windows only does restore/minimize
        const enableEvents = ['responsive', 'show', 'restore'];
        const disableEvents = ['unresponsive', 'hide', 'minimize', 'close'];
        const listeners = [];
        function enable(source) {
            if (!activeSubs.has(event)) {
                console.debug("Enable subscription:", event, domEvent, source);
                monitor.on(event, sendMessage);
                activeSubs.add(event);
            }
        }
        function disable(source) {
            if (activeSubs.has(event)) {
                console.debug("Disable subscription:", event, domEvent, source);
                monitor.off(event, sendMessage);
                activeSubs.delete(event);
            }
        }
        function shutdown() {
            console.debug("Shutdown subscription:", event, domEvent);
            for (const x of shutdownEvents) {
                win.webContents.off(x, shutdown);
            }
            monitor.off(event, sendMessage);
            for (const [name, cb] of listeners) {
                win.off(name, cb);
            }
            activeSubs.clear();
        }
        if (win.isVisible() && !win.isMinimized()) {
            enable('startup');
        }
        const shutdownEvents = ['destroyed', 'did-start-loading'];
        for (const x of shutdownEvents) {
            win.webContents.once(x, shutdown);
        }
        for (const x of enableEvents) {
            const cb = ev => enable(x, ev);
            win.on(x, cb);
            listeners.push([x, cb]);
        }
        for (const x of disableEvents) {
            const cb = ev => disable(x, ev);
            win.on(x, cb);
            listeners.push([x, cb]);
        }
    });
    electron.app.on('activate', async () => {
        // Clicking on the app icon..
        if (electron.BrowserWindow.getAllWindows().length === 0) {
            createWindows(monitor);
        }
    });
    createWindows(monitor);
    if (_appSettings.webServerEnabled) {
        webServer.setMonitor(monitor);
        await webServer.start(_appSettings.webServerPort);
    }
    started = true;
}

if (!appQuiting) {
    main();
}
