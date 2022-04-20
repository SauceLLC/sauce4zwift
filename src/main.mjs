import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import * as storage from './storage.mjs';
import menu from './menu.mjs';
import * as patreon from './patreon.mjs';
import * as rpc from './rpc.mjs';
import Sentry from '@sentry/node';
import * as webServer from './webserver.mjs';
import sauce from '../shared/sauce/index.mjs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const {autoUpdater} = require('electron-updater');
const {app, BrowserWindow, ipcMain, nativeImage, dialog, screen, shell} = require('electron');

let appQuiting = false;
let started;

try {
    storage.load(0);
} catch(e) {
    appQuiting = true;
    console.error('Storage error:', e);
    Promise.all([
        storage.reset(),
        dialog.showErrorBox('Storage error. Reseting database...', '' + e)
    ]).then(() => app.exit(1));
}

let sentryAnonId;
if (app.isPackaged) {
    Sentry.init({
        dsn: "https://df855be3c7174dc89f374ef0efaa6a92@o1166536.ingest.sentry.io/6257001",
        // Sentry changes the uncaught exc behavior to exit the process.  I think that's a bug
        // but this is the only workaround for now.
        integrations: data => data.filter(x => x.name !== 'OnUncaughtException'),
        beforeSend: sauce.beforeSentrySend,
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
const appIcon = nativeImage.createFromPath(path.join(appPath,
    'build/images/app-icon.icos'));
const windows = new Map();
// Use non-electron naming for windows updater.
// https://github.com/electron-userland/electron-builder/issues/2700
app.setAppUserModelId('io.saucellc.sauce4zwift'); // must match build.appId for windows



let _appSettings;
export function getAppSetting(key) {
    if (!_appSettings) {
        _appSettings = storage.load(appSettingsKey) || {...appSettingDefaults};
    }
    // migrate legacy... remove after a couple releases past 0.5.1 XXX
    let migrated;
    for (const [k, v] of Object.entries(appSettingDefaults)) {
        if (!Object.prototype.hasOwnProperty.call(_appSettings, k)) {
            console.debug("Migrating app setting:", k, v);
            _appSettings[k] = v;
            migrated = true;
        }
    }
    if (migrated) {
        storage.save(appSettingsKey, _appSettings);
    }
    // /XXX
    return _appSettings[key];
}


export function setAppSetting(key, value) {
    if (!_appSettings) {
        _appSettings = storage.load(appSettingsKey) || {...appSettingDefaults};
    }
    _appSettings[key] = value;
    storage.save(appSettingsKey, _appSettings);
    app.emit('app-setting-change', key, value);
}

app.on('app-setting-change', async (key, value) => {
    if (key === 'disableGPU') {
        const disableGPUFile = path.join(app.getPath('userData'), 'disabled-gpu');
        if (value) {
            await (await fs.open(disableGPUFile, 'w')).close();
        } else {
            await fs.unlink(disableGPUFile);
        }
    }
});

rpc.register('getAppSetting', getAppSetting);
rpc.register('setAppSetting', setAppSetting);
rpc.register('appIsPackaged', () => app.isPackaged);
rpc.register('getVersion', () => pkg.version);
rpc.register('getMonitorIP', () => pkg.version);
rpc.register('getSentryAnonId', () => sentryAnonId);
rpc.register('openExternalLink', url => shell.openExternal(url));
rpc.register('restart', () => {
    appQuiting = true;
    app.relaunch();
    app.quit();
});
rpc.register('quit', () => {
    appQuiting = true;
    app.quit();
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


async function makeFloatingWindow(page, options={}, defaultState={}) {
    const state = getWindowState(page) || defaultState;
    const win = new BrowserWindow({
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
            devTools: !app.isPackaged,
            preload: path.join(appPath, 'src', 'preload', 'common.js'),
        },
        ...options,
        ...state,
    });
    if (app.isPackaged) {
        win.removeMenu();
    }
    const hasPosition = state.x != null && state.y != null && state.width && state.height;
    if (!hasPosition && (options.relWidth != null || options.relHeight != null ||
        options.relX != null || options.relY != null || options.x < 0 || options.y < 0)) {
        const {width: sWidth, height: sHeight} = screen.getPrimaryDisplay().size;
        const width = options.width == null ? Math.round(options.relWidth * sWidth) : options.width;
        const height = options.height == null ? Math.round(options.relHeight * sHeight) : options.height;
        const x = options.x == null ? Math.round(options.relX * sWidth) :
            options.x < 0 ? sWidth + options.x - width : options.x;
        const y = options.y == null ? Math.round(options.relY * sHeight) :
            options.y < 0 ? sHeight + options.y - height : options.y;
        win.setSize(width, height);
        win.setPosition(x, y, false);
    }
    if (win.isAlwaysOnTop()) {
        win.setAlwaysOnTop(true, 'screen-saver');  // Fix borderless mode apps
    }
    windows.set(win.webContents, {win, state, options});
    let closed;
    win.webContents.on('new-window', (ev, url) => {
        // Popups...
        ev.preventDefault();
        const q = new URLSearchParams((new URL(url)).search);
        const newWin = new BrowserWindow({
            icon: appIcon,
            resizable: true,
            maximizable: true,
            fullscreenable: true,
            show: false,
            webPreferences: {
                sandbox: true,
                devTools: !app.isPackaged,
                preload: path.join(appPath, 'src', 'preload', 'common.js'),
            }
        });
        if (app.isPackaged) {
            newWin.removeMenu();
        }
        const wHint = Number(q.get('widthHint'));
        const hHint = Number(q.get('heightHint'));
        if (wHint || hHint) {
            const {width: sWidth, height: sHeight} = screen.getPrimaryDisplay().size;
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
        ipcMain.on(name, (ev, ...args) => {
            if (!closed && ev.sender === win.webContents) {
                callback(ev, ...args);
            }
        });
    }
    if (options.show !== false) {
        if (state.hidden) {
            win.minimize();
        } else {
            win.show();
        }
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
    return win;
}


async function createWindows(monitor) {
    const nearbyOverlayMode = getAppSetting('nearbyOverlayMode');
    const nearbyOptions = nearbyOverlayMode ? {} : {alwaysOnTop: false,
        transparent: false, frame: true, maximizable: true, fullscreenable: true, autoHide: false};
    makeFloatingWindow('watching.html', {width: 260, height: 260, x: 8, y: 64});
    makeFloatingWindow('groups.html', {width: 235, height: 650, x: -280, y: -10});
    makeFloatingWindow('chat.html', {width: 280, height: 580, x: 320, y: 230});
    makeFloatingWindow('overview.html', {relWidth: 0.6, height: 40, relX: 0.2, y: 0, hideable: false});
    makeFloatingWindow('nearby.html', {width: 800, height: 400, x: 20, y: 20, ...nearbyOptions}, {hidden: true});
}

if (app.dock) {
    app.dock.setIcon(appIcon);
}

app.on('window-all-closed', () => {
    if (started) {
        app.quit();
    }
});


function makeCaptiveWindow(options={}, webPrefs={}) {
    const win = new BrowserWindow({
        icon: appIcon,
        center: true,
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
            sandbox: true,
            devTools: !app.isPackaged,
            preload: path.join(appPath, 'src', 'preload', 'common.js'),
            ...webPrefs,
        },
        ...options
    });
    if (app.isPackaged) {
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
    ipcMain.on('patreon-auth-code', (ev, code) => resolve({code}));
    ipcMain.on('patreon-special-token', (ev, token) => resolve({token}));
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
    if (!app.isPackaged && storage.load('zwift-token')) {
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
        ipcMain.on('zwift-login-required', (ev, needLogin) => resolve(needLogin));
    });
    let closed;
    const tokenPromise = new Promise(resolve => {
        ipcMain.on('zwift-token', (ev, token) => resolve(token));
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
    await app.whenReady();
    app.on('before-quit', () => {
        appQuiting = true;
        Sentry.flush();
    });
    menu.setAppMenu();
    try {
        if (!await eulaConsent() || !await patronLink()) {
            appQuiting = true;
            app.quit();
            return;
        }
    } catch(e) {
        await dialog.showErrorBox('EULA or Patreon Link Error', '' + e);
        appQuiting = true;
        app.exit(1);
        return;
    }
    if (getAppSetting('zwiftLogin')) {
        await zwiftLogin();
    }
    autoUpdater.checkForUpdatesAndNotify().catch(Sentry.captureException);
    let mon;
    try {
        //mon = (await import('./garmin_live_track.mjs')).default;
        mon = (await import('./game.mjs')).default;
    } catch(e) {
        if (e.message.includes('cap.node')) {
            shell.beep();
            const installPrompt = makeCaptiveWindow({width: 400, height: 400});
            installPrompt.loadFile(path.join(pagePath, 'npcap-install.html'));
            return;
        } else {
            await dialog.showErrorBox('Startup Error', '' + e);
            appQuiting = true;
            app.exit(1);
        }
        return;
    }
    const monitor = await mon.Sauce4ZwiftMonitor.factory();
    rpc.register('getMonitorIP', () => monitor.ip);
    try {
        await monitor.start();
    } catch(e) {
        try {
            if (e.message.match(/permission denied/i)) {
                await mon.getCapturePermission();
                appQuiting = true;
                app.relaunch();
                app.quit();
                return;
            } else {
                throw e;
            }
        } catch(e) {
            await dialog.showErrorBox('Startup Error', '' + e);
            Sentry.captureException(e);
            appQuiting = true;
            setTimeout(() => app.exit(1), 1000);
            return;
        }
    }
    ipcMain.on('subscribe', (ev, {event, domEvent}) => {
        const win = windows.get(ev.sender).win;
        const cb = data => win.webContents.send('browser-message', {domEvent, data});
        const enableEvents = ['responsive', 'show'];
        const disableEvents = ['unresponsive', 'hide', 'close'];
        function enable() {
            console.debug("Enable subscription:", event, domEvent);
            monitor.on(event, cb);
        }
        function disable() {
            console.debug("Disable subscription:", event, domEvent);
            monitor.off(event, cb);
        }
        function shutdown() {
            console.debug("Shutdown subscription:", event, domEvent);
            monitor.off(event, cb);
            for (const x of enableEvents) {
                win.off(x, enable);
            }
            for (const x of disableEvents) {
                win.off(x, disable);
            }
        }
        if (win.isVisible()) {
            enable();
        }
        win.webContents.once('destroyed', shutdown);
        win.webContents.once('did-start-loading', shutdown);
        for (const x of enableEvents) {
            win.on(x, enable);
        }
        for (const x of disableEvents) {
            win.on(x, disable);
        }
    });
    app.on('activate', async () => {
        // Clicking on the app icon..
        if (BrowserWindow.getAllWindows().length === 0) {
            await createWindows(monitor);
        }
    });
    await createWindows(monitor);
    if (_appSettings.webServerEnabled) {
        webServer.setMonitor(monitor);
        await webServer.start(_appSettings.webServerPort);
    }
    started = true;
}

if (!appQuiting) {
    main();
}
