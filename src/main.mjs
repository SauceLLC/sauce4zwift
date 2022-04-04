import path from 'node:path';
import {fileURLToPath} from 'node:url';
import storage from './storage.mjs';
import menu from './menu.mjs';
import * as rpc from './rpc.mjs';
import Sentry from '@sentry/node';
import * as web from './webserver.mjs';
import sauce from '../shared/sauce/index.mjs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const {autoUpdater} = require('electron-updater');
const {app, BrowserWindow, ipcMain, nativeImage, dialog, screen, shell} = require('electron');
let started;

Error.stackTraceLimit = 50;

// Use non-electron naming for windows updater.
// https://github.com/electron-userland/electron-builder/issues/2700
app.setAppUserModelId('io.saucellc.sauce4zwift'); // must match build.appId for windows

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
let sentryAnonId;
storage.load(`sentry-id`).then(async id => {
    if (!id) {
        // It's just an anonymous value to distinguish errors and feedback
        id = crypto.randomBytes(16).toString("hex");
        await storage.save(`sentry-id`, id);
    }
    Sentry.setUser({id});
    sentryAnonId = id;
});

rpc.register('getVersion', () => pkg.version);
rpc.register('getSentryAnonId', () => sentryAnonId);

const WD = path.dirname(fileURLToPath(import.meta.url));
const PAGES = path.join(WD, '../pages');
const appIcon = nativeImage.createFromPath(path.join(WD, 'build/images/app-icon.icos'));
const windows = new Map();
let appQuiting = false;


async function getWindowState(page) {
    const id = page.split('.')[0];
    return await storage.load(`window-${id}`);
}


async function setWindowState(page, data) {
    const id = page.split('.')[0];
    await storage.save(`window-${id}`, data);
}


async function clearWindowState(page) {
    const id = page.split('.')[0];
    await storage.save(`window-${id}`, null);
}


async function makeFloatingWindow(page, options={}, defaultState={}) {
    const state = (await getWindowState(page)) || defaultState;
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
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            enableRemoteModule: false,
            preload: path.join(PAGES, 'src/preload.js'),
        },
        ...options,
        ...state,
    });
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
    // Allow iframes to work for any site..
    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: Object.fromEntries(Object.entries(details.responseHeaders)
                .filter(header => !/x-frame-options/i.test(header[0])))
        });
    });
    windows.set(win.webContents, {win, state, options});
    win.webContents.on('new-window', (ev, url) => {
        // Popups...
        ev.preventDefault();
        const newWin = new BrowserWindow({
            resizable: true,
            maximizable: true,
            fullscreenable: true,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                enableRemoteModule: false,
                preload: path.join(PAGES, 'src/preload.js'),
            }
        });
        const q = new URLSearchParams((new URL(url)).search);
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
    async function onHide(ev) {
        if (appQuiting) {
            return;
        }
        state.hidden = true;
        await setWindowState(page, state);
    }
    async function onShow(ev) {
        state.hidden = false;
        await setWindowState(page, state);
    }
    function onWindowMessage(name, callback) {
        ipcMain.on(name, (ev, ...args) => {
            if (ev.sender === win.webContents) {
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
    win.on('closed', onHide);
    win.on('restore', onShow);
    win.loadFile(path.join(PAGES, page));
    return win;
}


async function createWindows(monitor) {
    void clearWindowState;  // delint while unused
    //await clearWindowState('overview.html'); // XXX TESTING
    //await clearWindowState('watching.html'); // XXX TESTING
    //await clearWindowState('groups.html'); // XXX TESTING
    //await clearWindowState('chat.html'); // XXX TESTING
    //await clearWindowState('nearby.html'); // XXX TESTING
    await Promise.all([
        makeFloatingWindow('watching.html',
            {width: 260, height: 260, x: 8, y: 64}),
        makeFloatingWindow('groups.html',
            {width: 235, height: 650, x: -280, y: -10}),
        makeFloatingWindow('chat.html',
            {width: 280, height: 580, x: 320, y: 230}),
        makeFloatingWindow('overview.html',
            {relWidth: 0.6, height: 40, relX: 0.2, y: 0, hideable: false}),
        makeFloatingWindow('nearby.html',
            {width: 800, height: 400, x: 20, y: 20, alwaysOnTop: false, frame: true,
             maximizable: true, fullscreenable: true, transparent: false, autoHideMenuBar: true},
            {hidden: true})
    ]);
}

if (app.dock) {
    app.dock.setIcon(appIcon);
}

app.on('window-all-closed', () => {
    if (started) {
        app.exit(0);
    }
});


async function main() {
    await app.whenReady();
    app.on('before-quit', () => {
        appQuiting = true;
        Sentry.flush();
    });
    menu.setAppMenu();
    if (!await storage.load(`eula-consent`)) {
        const eulaWin = new BrowserWindow({
            width: 800,
            height: 600,
            center: true,
            maximizable: false,
            fullscreenable: false,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                enableRemoteModule: false,
                preload: path.join(PAGES, 'src/preload.js'),
            },
        });
        const consent = new Promise(resolve => {
            rpc.register('eulaConsent', async agree => {
                if (agree === true) {
                    await storage.save(`eula-consent`, true);
                    resolve();
                } else {
                    console.warn("User does not agree to EULA");
                    appQuiting = true;
                    app.exit(0);
                }
            });
        });
        eulaWin.loadFile(path.join(PAGES, 'eula.html'));
        await consent;
        eulaWin.close();
    }
    autoUpdater.checkForUpdatesAndNotify().catch(Sentry.captureException);
    let mon;
    try {
        //mon = (await import('./garmin_live_track.mjs')).default;
        mon = (await import('./game.mjs')).default;
    } catch(e) {
        if (e.message.includes('The specified module could not be found.') &&
            e.message.includes('cap.node')) {
            shell.beep();
            const installPrompt = new BrowserWindow({
                width: 400,
                height: 400,
                center: true,
                maximizable: false,
                fullscreenable: false,
                autoHideMenuBar: true
            });
            installPrompt.webContents.on('new-window', (ev, url) => {
                ev.preventDefault();
                if (url === 'sauce://restart') {
                    appQuiting = true;
                    app.relaunch();
                    app.exit(0);
                } else {
                    shell.openExternal(url);
                }
            });
            installPrompt.loadFile(path.join(PAGES, 'npcap-install.html'));
            return;
        } else {
            await dialog.showErrorBox('Startup Error', '' + e);
            appQuiting = true;
            app.exit(1);
        }
        return;
    }
    const monitor = await mon.Sauce4ZwiftMonitor.factory();
    try {
        await monitor.start();
    } catch(e) {
        try {
            if (e.message.match(/permission denied/i)) {
                await mon.getCapturePermission();
                await monitor.start();  // Try once more
            } else {
                throw e;
            }
        } catch(e) {
            await dialog.showErrorBox('Startup Error', '' + e);
            Sentry.captureException(e);
            appQuiting = true;
            setTimeout(() => app.exit(0), 1000);
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
    ipcMain.on('hideAllWindows', ev => {
        for (const {win, state, options} of windows.values()) {
            if (options.hideable !== false && !state.hidden) {
                win.hide();
            }
        }
    });
    ipcMain.on('showAllWindows', ev => {
        for (const {win, state, options} of windows.values()) {
            if (options.hideable !== false && !state.hidden) {
                win.show();
            }
        }
    });
    ipcMain.on('quit', () => {
        appQuiting = true;
        app.exit(0);
    });
    app.on('activate', async () => {
        // Clicking on the app icon..
        if (BrowserWindow.getAllWindows().length === 0) {
            await createWindows(monitor);
        }
    });
    web.setMonitor(monitor);
    await createWindows(monitor);
    await web.start();
    started = true;
}

main();
