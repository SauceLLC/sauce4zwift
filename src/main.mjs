import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import * as storage from './storage.mjs';
import * as menu from './menu.mjs';
import * as patreon from './patreon.mjs';
import * as rpc from './rpc.mjs';
import {databases} from './db.mjs';
import * as Sentry from '@sentry/node';
import {Dedupe} from '@sentry/integrations';
import * as webServer from './webserver.mjs';
import * as game from './game.mjs';
import {beforeSentrySend, setSentry} from '../shared/sentry-util.mjs';
import {sleep} from '../shared/sauce/base.mjs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import * as secrets from './secrets.mjs';
import * as zwift from './zwift.mjs';

// Dev tools prototyping
global.zwift = zwift;
global.game = game;

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const {autoUpdater} = require('electron-updater');
const electron = require('electron');

const isDEV = !electron.app.isPackaged;
const isWindows = os.platform() === 'win32';
const isMac = !isWindows && os.platform() === 'darwin';
const isLinux = !isWindows && !isMac && os.platform() === 'linux';

let appQuiting = false;
let started;
let gameMonitor;
let tray;

try {
    storage.load(0);
} catch(e) {
    appQuiting = true;
    console.error('Storage error:', e);
    Promise.all([
        storage.reset(),
        electron.dialog.showErrorBox('Storage error. Reseting database...', '' + e)
    ]).finally(() => quit(1));
}
rpc.register(async function() {
    const {response} = await electron.dialog.showMessageBox(this.getOwnerBrowserWindow(), {
        type: 'question',
        title: 'Confirm Reset State',
        message: 'This operation will reset all settings completely.\n\n' +
            'Are you sure you want continue?',
        buttons: ['Yes, reset to defaults', 'Cancel'],
        cancelId: 1,
    });
    if (response === 0) {
        console.warn('Reseting state and restarting...');
        await storage.reset();
        await secrets.remove('zwift-login');
        await electron.session.defaultSession.clearStorageData();
        await electron.session.defaultSession.clearCache();
        restart();
    }
}, {name: 'resetStorageState'});

let sentryAnonId;
if (!isDEV) {
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
    console.info("Sentry disabled by dev mode");
}

electron.nativeTheme.themeSource = 'dark';


function quit(retcode) {
    appQuiting = true;
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


const appSettingDefaults = {
    webServerEnabled: true,
    webServerPort: 1080,
};

const windowManifests = [{
    type: 'overview',
    page: 'overview.html',
    prettyName: 'Overview',
    prettyDesc: 'Main top window for overall control and stats.',
    private: true,
    options: {relWidth: 0.6, height: 40, relX: 0.2, y: 28},
    webPreferences: {backgroundThrottling: false}, // XXX Doesn't appear to work
    alwaysVisible: true,
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
    options: {width: 800, height: 400},
    overlay: false,
}, {
    type: 'power-gauge',
    groupTitle: 'Gauges',
    pageURL: 'gauge.html?t=power',
    prettyName: 'Power Gauge [experiment]',
    prettyDesc: 'Car style power (watts) gauge.',
    options: {relWidth: 0.20, aspectRatio: 0.8},
}, {
    type: 'draft-gauge',
    groupTitle: 'Gauges',
    pageURL: 'gauge.html?t=draft',
    prettyName: 'Draft Gauge [experiment]',
    prettyDesc: 'Car style draft (% power reduction) gauge.',
    options: {relWidth: 0.20, aspectRatio: 0.8},
}, {
    type: 'pace-gauge',
    groupTitle: 'Gauges',
    pageURL: 'gauge.html?t=pace',
    prettyName: 'Pace Gauge [experiment]',
    prettyDesc: 'Car style pace/speed gauge.',
    options: {relWidth: 0.20, aspectRatio: 0.8},
}, {
    type: 'hr-gauge',
    groupTitle: 'Gauges',
    pageURL: 'gauge.html?t=hr',
    prettyName: 'Heart Rate Gauge [experiment]',
    prettyDesc: 'Car style heart rate gauge.',
    options: {relWidth: 0.20, aspectRatio: 0.8},
}, {
    type: 'stats-for-nerds',
    groupTitle: 'Misc',
    page: 'stats-for-nerds.html',
    prettyName: 'Stats for Nerds',
    prettyDesc: 'Debug info (cpu/mem) about Sauce.',
    options: {width: 900, height: 600},
    overlay: false,
}];
rpc.register(() => windowManifests, {name: 'getWindowManifests'});
const windowManifestsByType = Object.fromEntries(windowManifests.map(x => [x.type, x]));

const defaultWindows = [{
    id: 'default-overview-1',
    type: 'overview',
}, {
    id: 'default-watching-1',
    type: 'watching',
    options: {x: 8, y: 40},
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
// Otherwise is done via builder
const activeWindows = new Map();
const subWindows = new WeakMap();
const windowsUpdateListeners = new Map();
// Use non-electron naming for windows updater.
// https://github.com/electron-userland/electron-builder/issues/2700
electron.app.setAppUserModelId('io.saucellc.sauce4zwift'); // must match build.appId for windows
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
        openAllWindows();
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
rpc.register(getAppSetting);


export function setAppSetting(key, value) {
    if (!_appSettings) {
        _appSettings = storage.load(appSettingsKey) || {...appSettingDefaults};
    }
    _appSettings[key] = value;
    storage.save(appSettingsKey, _appSettings);
    electron.app.emit('app-setting-change', key, value);
}
rpc.register(setAppSetting);

rpc.register(() => isDEV, {name: 'isDEV'});
rpc.register(() => pkg.version, {name: 'getVersion'});
rpc.register(() => gameMonitor.ip, {name: 'getMonitorIP'});
rpc.register(() => sentryAnonId, {name: 'getSentryAnonId'});
rpc.register(url => electron.shell.openExternal(url), {name: 'openExternalLink'});

rpc.register(() => {
    for (const {win, spec} of activeWindows.values()) {
        const manifest = windowManifestsByType[spec.type];
        if (!manifest.alwaysVisible && spec.overlay !== false) {
            win.hide();
        }
    }
}, {name: 'hideAllWindows'});

rpc.register(() => {
    for (const {win, spec} of activeWindows.values()) {
        const manifest = windowManifestsByType[spec.type];
        if (!manifest.alwaysVisible && spec.overlay !== false) {
            win.showInactive();
        }
    }
}, {name: 'showAllWindows'});

rpc.register(function() {
    const {win, spec} = activeWindows.get(this);
    console.debug('Window close requested:', spec.id);
    win.close();
}, {name: 'closeWindow'});

rpc.register(function() {
    const {win, spec} = activeWindows.get(this);
    console.debug('Window close requested:', spec.id);
    win.minimize();
}, {name: 'minimizewindow'});



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
    }, 2000 - (Date.now() - _lastAppMetricsTS)));
}

rpc.register(async () => {
    if (!_appMetricsPromise) {
        _appMetricsPromise = _getAppMetrics();
    }
    return await _appMetricsPromise;
}, {name: 'pollAppMetrics'});


async function getDebugInfo() {
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
        game: gameMonitor.getDebugInfo(),
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
rpc.register(getDebugInfo);

rpc.register(pid => {
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
            return {
                subWindow: true,
                ...subWindows.get(wc).spec,
            };
        }
    }
}, {name: 'getWindowSpecForPID'});


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
rpc.register(getWindows);


rpc.register(function(domEvent) {
    if (this) {
        windowsUpdateListeners.set(new WeakRef(this), domEvent);
    } else {
        // XXX Doesn't work for web clients, but I think we could proxy to the webServer
        console.warn("listenForWindowUpdates is only supported on electron");
    }
}, {name: 'listenForWindowUpdates'});


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
rpc.register(getWindow);


function setWindow(id, data) {
    const wins = getWindows();
    wins[id] = data;
    setWindows(wins);
}
rpc.register(setWindow);


function setWindowOpacity(id, opacity) {
    updateWindow(id, {opacity});
    const win = getActiveWindow(id);
    if (win) {
        win.setOpacity(opacity);
    }
}
rpc.register(setWindowOpacity);


function updateWindow(id, updates) {
    const w = getWindow(id);
    Object.assign(w, updates);
    setWindow(id, w);
    if ('closed' in updates) {
        setTimeout(updateTrayMenu, 100);
    }
    return w;
}
rpc.register(updateWindow);


function removeWindow(id) {
    const win = getActiveWindow(id);
    if (win) {
        win.close();
    }
    const wins = getWindows();
    delete wins[id];
    setWindows(wins);
    setTimeout(updateTrayMenu, 100);
}
rpc.register(removeWindow);


function createWindow({id, type, options, ...state}) {
    id = id || `user-${type}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
    const manifest = windowManifestsByType[type];
    setWindow(id, {
        ...manifest,
        id,
        type,
        options,
        ...state,
    });
    setTimeout(updateTrayMenu, 100);
    return id;
}
rpc.register(createWindow);


function highlightWindow(id) {
    const win = getActiveWindow(id);
    if (win) {
        if (!win.isVisible() || win.isMinimized()) {
            win.show();
        } else {
            win.focus();
        }
        win.webContents.send('browser-message', {domEvent: 'sauce-highlight-window'});
    }
}
rpc.register(highlightWindow);


function openWindow(id) {
    const spec = getWindow(id);
    if (spec.closed) {
        updateWindow(id, {closed: false});
    }
    _openWindow(id, spec);
}
rpc.register(openWindow);


function reopenWindow(id) {
    const win = getActiveWindow(id);
    if (win) {
        win.close();
    }
    openWindow(id);
}
rpc.register(reopenWindow);


function _openWindow(id, spec) {
    console.debug("Opening window:", id, spec.type);
    const overlayOptions = {
        transparent: true,
        hasShadow: false,
        frame: false,
        roundedCorners: false,  // macos only, we use page style instead.
        alwaysOnTop: true,
        maximizable: false,
        fullscreenable: false,
    };
    const manifest = windowManifestsByType[spec.type];
    // Order of options is crucial...
    const options = {
        ...(spec.overlay !== false ? overlayOptions : {}),
        ...manifest.options,
        ...spec.options,
        ...spec.position,
        opacity: spec.opacity,
    };
    const win = new electron.BrowserWindow({
        type: isLinux ? 'splash' : undefined,
        show: false,
        webPreferences: {
            sandbox: true,
            devTools: isDEV,
            preload: path.join(appPath, 'src', 'preload', 'common.js'),
            webgl: false,
            ...manifest.webPreferences,
            ...spec.webPreferences,
        },
        ...options,
    });
    if (!isDEV) {
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
        win.setAlwaysOnTop(true, 'pop-up-menu');
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
            width = wHint <= 1 ? Math.round(sWidth * (wHint || 0.5)) : Math.round(wHint);
            height = hHint <= 1 ? Math.round(sHeight * (hHint || 0.5)) : Math.round(hHint) ;
        }
        const newWin = new electron.BrowserWindow({
            type: isLinux ? 'splash' : undefined,
            show: false,
            width,
            height,
            alwaysOnTop: spec.overlay !== false,
            webPreferences: {
                sandbox: true,
                devTools: isDEV,
                preload: path.join(appPath, 'src', 'preload', 'common.js'),
            }
        });
        if (spec.overlay !== false) {
            newWin.setAlwaysOnTop(true, 'pop-up-menu');
        }
        subWindows.set(newWin.webContents, {win: newWin, spec, activeSubs: new Set()});
        if (!isDEV) {
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
    win.on('move', onPositionUpdate);
    win.on('resize', onPositionUpdate);
    win.on('close', () => {
        activeWindows.delete(webContents);
        if (!appQuiting && !manifest.alwaysVisible) {
            updateWindow(id, {closed: true});
        }
    });
    if (spec.page) {
        win.loadFile(path.join(pagePath, spec.page));
    } else if (spec.pageURL) {
        win.loadURL(`file://${path.join(pagePath, spec.pageURL)}`);
    } else if (spec.url) {
        win.loadURL(spec.url);
    } else {
        throw new TypeError("No page or pageURL defined");
    }
    win.show();
    return win;
}


function openAllWindows() {
    for (const [id, spec] of Object.entries(getWindows())) {
        const manifest = windowManifestsByType[spec.type];
        if (manifest.alwaysVisible || !spec.closed) {
            _openWindow(id, spec);
        }
    }
}


function makeCaptiveWindow(options={}, webPrefs={}) {
    const win = new electron.BrowserWindow({
        type: isLinux ? 'splash' : undefined,
        center: true,
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
            sandbox: true,
            devTools: isDEV,
            preload: path.join(appPath, 'src', 'preload', 'common.js'),
            ...webPrefs,
        },
        ...options
    });
    if (!isDEV) {
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
        rpc.register(async agree => {
            if (agree === true) {
                storage.save('eula-consent', true);
                resolve(true);
            } else {
                console.warn("User does not agree to EULA");
                resolve(false);
            }
        }, {name: 'eulaConsent'});
        win.on('closed', () => (closed = true, resolve(false)));
    });
    win.loadFile(path.join(pagePath, 'eula.html'));
    const consent = await consenting;
    if (!closed) {
        win.close();
    }
    return consent;
}


function showReleaseNotes() {
    const win = makeCaptiveWindow({width: 500, height: 600});
    win.loadFile(path.join(pagePath, 'release-notes.html'));
    return new Promise(resolve => {
        win.on('closed', () => {
            resolve();
            if (!appQuiting) {
                setAppSetting('lastVersion', pkg.version);
            }
        });
    });
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
    if (process.argv.includes('--zwift-logout')) {
        await secrets.remove('zwift-login');
    }
    const login = await secrets.get('zwift-login');
    if (login) {
        try {
            return await zwift.authenticate(login.username, login.password);
        } catch(e) {
            console.debug("Previous Zwift login invalid:", e);
            // We could remove them, but it might be a network error; just leave em for now.
        }
    }
    const win = makeCaptiveWindow({
        width: 400,
        height: 600,
        show: false,
    }, {
        preload: path.join(appPath, 'src', 'preload', 'zwift-login.js'),
    });
    let closed;
    let setDone;
    const done = new Promise(resolve => setDone = resolve);
    electron.ipcMain.on('zwift-creds', async (ev, {username, password}) => {
        try {
            await zwift.authenticate(username, password);
            await secrets.set('zwift-login', {username, password});
            setDone();
        } catch(e) {
            win.webContents.send('validation-error', e);
        }
    });
    win.on('closed', () => {
        closed = true;
        setDone();
    });
    win.loadFile(path.join(pagePath, 'zwift-login.html'));
    win.show();
    try {
        await done;
    } finally {
        if (!closed) {
            win.close();
        }
    }
}


async function ensureSingleInstance() {
    if (electron.app.requestSingleInstanceLock({type: 'probe'})) {
        return;
    }
    const {response} = await electron.dialog.showMessageBox({
        type: 'question',
        message: 'Another Sauce process detected.\n\nThere can only be one, you must choose...',
        buttons: ['Take the prize!', 'Run away'],
        noLink: true,
        cancelId: 1,
    });
    if (response === 1) {
        console.debug("Quiting due to existing instance");
        quit();
        return false;
    }
    let hasLock = electron.app.requestSingleInstanceLock({type: 'quit'});
    for (let i = 0; i < 10; i++) {
        if (hasLock) {
            return;
        }
        await sleep(500);
        hasLock = electron.app.requestSingleInstanceLock({type: 'quit'});
    }
    await electron.dialog.showErrorBox('Existing Sauce process hung',
        'Consider using Activity Monitor (mac) or Task Manager (windows) to find ' +
        'and stop any existing Sauce processes');
    quit(1);
    return false;
}


async function welcomeSplash() {
    const {width, height} = electron.screen.getPrimaryDisplay().size; // XXX
    const welcomeWin = new electron.BrowserWindow({
        type: isLinux ? 'splash' : undefined,
        center: true,
        width,
        height,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        show: false,
        transparent: true,
        hasShadow: false,
        frame: false,
        focusable: false,
        skipTaskbar: true,
        roundedCorners: false,
        alwaysOnTop: true,
        webPreferences: {
            sandbox: true,
            devTools: isDEV,
            preload: path.join(appPath, 'src', 'preload', 'common.js'),
        },
    });
    welcomeWin.removeMenu();
    welcomeWin.excludedFromShownWindowsMenu = true;
    welcomeWin.setAlwaysOnTop(true, 'screen-saver');
    welcomeWin.setIgnoreMouseEvents(true);
    welcomeWin.loadFile(path.join(pagePath, 'welcome.html'));
    welcomeWin.show();
    return await sleep(16500).then(() => welcomeWin.close());
}


function initShortcuts() {
    if (isDEV) {
        electron.globalShortcut.register('F12', () => {
            const focused = electron.BrowserWindow.getFocusedWindow();
            if (focused) {
                focused.webContents.openDevTools();
            }
        });
    }
}


function updateTrayMenu() {
    const pad = '  ';
    const windows = Object.values(getWindows());
    const activeWins = windows.filter(x => x.private !== true && x.closed !== true);
    const closedWins = windows.filter(x => x.private !== true && x.closed === true);
    const menu = [{
        label: `${pkg.productName} v${pkg.version}`,
        click: welcomeSplash
    }, {
        type: 'separator',
    }];
    if (activeWins.length) {
        menu.push(
            {type: 'separator'},
            {label: 'Active Windows', enabled: false},
            ...activeWins.map(x => ({
                label: pad + x.prettyName,
                tooltip: x.prettyDesc,
                click: () => highlightWindow(x.id),
            }))
        );
    }
    if (closedWins.length) {
        menu.push(
            {type: 'separator'},
            {label: 'Closed Windows', enabled: false},
            ...closedWins.map(x => ({
                label: pad + x.prettyName,
                tooltip: x.prettyDesc,
                click: () => openWindow(x.id),
            }))
        );
    }
    if (getAppSetting('webServerEnabled') && gameMonitor) {
        const url = `http://${gameMonitor.ip}:${getAppSetting('webServerPort')}`;
        menu.push({
            type: 'separator',
        }, {
            label: `Web: ${url}`,
            click: () => electron.shell.openExternal(url),
        });
    }
    menu.push({
        type: 'separator',
    }, {
        label: 'Settings',
        click: () => {
            const win = makeCaptiveWindow({width: 500, height: 600});
            // Bit of a hack to get the preload context setup so overview settings function
            const id = Object.values(getWindows()).find(x => x.type === 'overview').id;
            subWindows.set(win.webContents, {win, spec: {id, type: 'overview'}, activeSubs: new Set()});
            win.loadFile(path.join(pagePath, 'overview-settings.html'));
        },
    }, {
        label: '',
        enabled: false,
    }, {
        label: 'Quit',
        role: 'quit',
    });
    tray.setContextMenu(electron.Menu.buildFromTemplate(menu));
}


async function main() {
    if (await ensureSingleInstance() === false) {
        return;
    }
    await electron.app.whenReady();
    initShortcuts();
    const trayIcon = electron.nativeImage.createFromPath(path.join(appPath, 'images',
        isMac ? 'mac-trayicon.png' : 'win-trayicon.png'));
    tray = new electron.Tray(trayIcon);
    tray.setToolTip(pkg.productName);
    menu.setAppMenu();
    autoUpdater.checkForUpdatesAndNotify().catch(Sentry.captureException);
    const lastVersion = getAppSetting('lastVersion');
    if (lastVersion !== pkg.version) {
        if (lastVersion) {
            await electron.session.defaultSession.clearCache();
            await showReleaseNotes();
        } else {
            setAppSetting('lastVersion', pkg.version);
            console.info("First time invocation: Welcome to Sauce for Zwift");
            await welcomeSplash();
        }
    }
    try {
        if (!await eulaConsent() || !await patronLink()) {
            return quit();
        }
    } catch(e) {
        await electron.dialog.showErrorBox('EULA or Patreon Link Error', '' + e);
        return quit(1);
    }
    if (game.npcapMissing) {
        electron.shell.beep();
        const installPrompt = makeCaptiveWindow({width: 400, height: 400});
        installPrompt.loadFile(path.join(pagePath, 'npcap-install.html'));
        return;
    }
    await zwiftLogin();
    if (process.argv.includes('--garmin-live-track')) {
        const session = process.argv.find((x, i) => i && process.argv[i - 1] == '--garmin-live-track');
        const garminLiveTrack = await import('./garmin_live_track.mjs');
        gameMonitor = await garminLiveTrack.Sauce4ZwiftMonitor.factory({session});
    } else {
        const fakeData = process.argv.includes('--fake-data');
        gameMonitor = await game.Sauce4ZwiftMonitor.factory({fakeData});
    }
    try {
        await gameMonitor.start();
    } catch(e) {
        try {
            if (e.message.match(/permission denied/i)) {
                await game.getCapturePermission();
                restart();
                return;
            } else {
                throw e;
            }
        } catch(e) {
            await electron.dialog.showErrorBox('Startup Error', e.stack);
            Sentry.captureException(e);
            setTimeout(() => quit(1), 1000);
            return;
        }
    }
    electron.ipcMain.on('subscribe', (ev, {event, domEvent, persistent}) => {
        const w = activeWindows.get(ev.sender) || subWindows.get(ev.sender);
        const {win, activeSubs, spec} = w;
        // NOTE: Electron webContents.send is incredibly hard ON CPU and GC for deep objects.  Using JSON is
        // a massive win for CPU and memory.
        const sendMessage = data => win.webContents.send('browser-message', {domEvent, json: JSON.stringify(data)});
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
                gameMonitor.on(event, sendMessage);
                activeSubs.add(event);
            }
        }
        function suspend(source) {
            if (activeSubs.has(event)) {
                console.debug("Suspending subscription:", event, spec.id, source);
                gameMonitor.off(event, sendMessage);
                activeSubs.delete(event);
            }
        }
        function shutdown() {
            console.debug("Shutdown subscription:", event, spec.id);
            gameMonitor.off(event, sendMessage);
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
    updateTrayMenu();
    openAllWindows();
    if (_appSettings.webServerEnabled) {
        webServer.setMonitor(gameMonitor);
        await webServer.start(_appSettings.webServerPort, {debug: isDEV});
    }
    started = true;
}

if (!appQuiting) {
    main();
}
