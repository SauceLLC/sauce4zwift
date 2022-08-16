import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import * as storage from './storage.mjs';
import * as patreon from './patreon.mjs';
import * as rpc from './rpc.mjs';
import {EventEmitter} from 'node:events';
import {sleep} from '../shared/sauce/base.mjs';
import {createRequire} from 'node:module';
import * as menu from './menu.mjs';

const require = createRequire(import.meta.url);
const electron = require('electron');

let quiting;
electron.app.on('before-quit', () => quiting = true);

const isDEV = !electron.app.isPackaged;
const isWindows = os.platform() === 'win32';
const isMac = !isWindows && os.platform() === 'darwin';
const isLinux = !isWindows && !isMac && os.platform() === 'linux';



export const windowManifests = [{
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
    type: 'game-control',
    page: 'game-control.html',
    prettyName: 'Game Control',
    prettyDesc: 'Control game actions like view, shouting, HUD toggle, etc.',
    options: {width: 300, aspectRatio: 1.65},
}, {
    type: 'power-gauge',
    groupTitle: 'Gauges',
    pageURL: 'gauge.html?t=power',
    prettyName: 'Power Gauge',
    prettyDesc: 'Car style power (watts) gauge.',
    options: {relWidth: 0.20, aspectRatio: 0.8},
}, {
    type: 'draft-gauge',
    groupTitle: 'Gauges',
    pageURL: 'gauge.html?t=draft',
    prettyName: 'Draft Gauge',
    prettyDesc: 'Car style draft (% power reduction) gauge.',
    options: {relWidth: 0.20, aspectRatio: 0.8},
}, {
    type: 'pace-gauge',
    groupTitle: 'Gauges',
    pageURL: 'gauge.html?t=pace',
    prettyName: 'Pace Gauge',
    prettyDesc: 'Car style pace/speed gauge.',
    options: {relWidth: 0.20, aspectRatio: 0.8},
}, {
    type: 'hr-gauge',
    groupTitle: 'Gauges',
    pageURL: 'gauge.html?t=hr',
    prettyName: 'Heart Rate Gauge',
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

// NEVER use app.getAppPath() it uses asar for universal builds
const appPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = path.join(appPath, 'pages');
export const activeWindows = new Map();
export const subWindows = new WeakMap();
export const eventEmitter = new EventEmitter();


export function getMetaByWebContents(wc) {
    return activeWindows.get(wc) || subWindows.get(wc);
}


electron.ipcMain.on('getWindowContextSync', ev => {
    let returnValue = {
        id: null,
        type: null,
    };
    try {
        const m = getMetaByWebContents(ev.sender);
        if (m) {
            returnValue = {
                id: m.spec.id,
                type: m.spec.type,
            };
        }
    } finally {
        ev.returnValue = returnValue; // MUST set otherwise page blocks.
    }
});

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
        let w;
        let subWindow;
        if (activeWindows.has(wc)) {
            w = activeWindows.get(wc);
            subWindow = false;
        } else if (subWindows.has(wc)) {
            w = subWindows.get(wc);
            subWindow = true;
        }
        if (w) {
            return {
                spec: w.spec,
                title: w.title,
                subWindow,
            }
        }
    }
}, {name: 'getWindowInfoForPID'});


export function getActiveWindow(id) {
    for (const w of activeWindows.values()) {
        if (w.spec.id === id) {
            return w.win;
        }
    }
}


let _windows;
export function getWindows() {
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


let _windowsUpdatedTimeout;
export function setWindows(wins) {
    _windows = wins;
    storage.save('windows', _windows);
    clearTimeout(_windowsUpdatedTimeout);
    _windowsUpdatedTimeout = setTimeout(() => eventEmitter.emit('set-windows', wins), 200);
}


export function getWindow(id) {
    return getWindows()[id];
}
rpc.register(getWindow);


export function setWindow(id, data) {
    const wins = getWindows();
    wins[id] = data;
    setWindows(wins);
}
rpc.register(setWindow);


export function setWindowOpacity(id, opacity) {
    updateWindow(id, {opacity});
    const win = getActiveWindow(id);
    if (win) {
        win.setOpacity(opacity);
    }
}
rpc.register(setWindowOpacity);


export function updateWindow(id, updates) {
    const w = getWindow(id);
    Object.assign(w, updates);
    setWindow(id, w);
    if ('closed' in updates) {
        setTimeout(menu.updateTrayMenu, 100);
    }
    return w;
}
rpc.register(updateWindow);


export function removeWindow(id) {
    const win = getActiveWindow(id);
    if (win) {
        win.close();
    }
    const wins = getWindows();
    delete wins[id];
    setWindows(wins);
    setTimeout(menu.updateTrayMenu, 100);
}
rpc.register(removeWindow);


export function createWindow({id, type, options, ...state}) {
    id = id || `user-${type}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
    const manifest = windowManifestsByType[type];
    setWindow(id, {
        ...manifest,
        id,
        type,
        options,
        ...state,
    });
    setTimeout(menu.updateTrayMenu, 100);
    return id;
}
rpc.register(createWindow);


export function highlightWindow(id) {
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


export function reopenWindow(id) {
    const win = getActiveWindow(id);
    if (win) {
        win.close();
    }
    openWindow(id);
}
rpc.register(reopenWindow);


export function openWindow(id) {
    const spec = getWindow(id);
    if (spec.closed) {
        updateWindow(id, {closed: false});
    }
    _openWindow(id, spec);
}
rpc.register(openWindow);


function handleNewSubWindow(webContents, spec) {
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
        newWin.on('page-title-updated', (ev, title) =>
            subWindows.get(newWin.webContents).title = title.replace(/( - )?Sauce for Zwift™?$/, ''));
        handleNewSubWindow(newWin.webContents, spec);
        if (!isDEV) {
            newWin.removeMenu();
        }
        newWin.loadURL(url);
        newWin.show();
    });
}


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
        options.relX != null || options.relY != null || options.x < 0 || options.y < 0 ||
        options.aspectRatio)) {
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
    handleNewSubWindow(webContents, spec);
    let saveStateTimeout;
    function onPositionUpdate() {
        const position = win.getBounds();
        clearTimeout(saveStateTimeout);
        saveStateTimeout = setTimeout(() => updateWindow(id, {position}), 200);
    }
    win.on('page-title-updated', (ev, title) =>
            activeWindows.get(webContents).title = title.replace(/( - )?Sauce for Zwift™?$/, ''));
    win.on('move', onPositionUpdate);
    win.on('resize', onPositionUpdate);
    win.on('close', () => {
        activeWindows.delete(webContents);
        if (!quiting && !manifest.alwaysVisible) {
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


export function openAllWindows() {
    for (const [id, spec] of Object.entries(getWindows())) {
        const manifest = windowManifestsByType[spec.type];
        if (manifest.alwaysVisible || !spec.closed) {
            _openWindow(id, spec);
        }
    }
}


export function makeCaptiveWindow(options={}, webPrefs={}) {
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
    if (options.page) {
        win.loadFile(path.join(pagePath, options.page));
    }
    return win;
}


export async function eulaConsent() {
    if (storage.load('eula-consent')) {
        return true;
    }
    const win = makeCaptiveWindow({width: 800, height: 600, page: 'eula.html'});
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
    const consent = await consenting;
    if (!closed) {
        win.close();
    }
    return consent;
}


export async function showReleaseNotes() {
    const win = makeCaptiveWindow({width: 600, height: 600, page: 'release-notes.html'});
    await new Promise(resolve => win.on('closed', resolve));
}


function scrubUA(win) {
    // Prevent Patreon's datedome.co bot service from blocking us.
    const ua = win.webContents.userAgent;
    win.webContents.userAgent = ua.replace(/ SauceforZwift.*? /, ' ').replace(/ Electron\/.*? /, ' ');
}


export async function patronLink() {
    let membership = storage.load('patron-membership');
    if (membership && membership.patronLevel >= 10) {
        // XXX Implment refresh once in a while.
        return true;
    }
    const win = makeCaptiveWindow({width: 400, height: 720, page: 'patron.html'}, {
        preload: path.join(appPath, 'src', 'preload', 'patron-link.js'),
    });
    scrubUA(win);
    let resolve;
    electron.ipcMain.on('patreon-auth-code', (ev, code) => resolve({code}));
    electron.ipcMain.on('patreon-special-token', (ev, token) => resolve({token}));
    win.on('closed', () => resolve({closed: true}));
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


export async function zwiftLogin(options) {
    const win = makeCaptiveWindow({
        width: 400,
        height: 600,
        show: false,
        page: options.game ? 'zwift-game-login.html' : 'zwift-login.html',
    }, {
        preload: path.join(appPath, 'src', 'preload', 'zwift-login.js'),
    });
    let closed;
    let setDone;
    const done = new Promise(resolve => setDone = resolve);
    electron.ipcMain.on('zwift-creds', async (ev, {username, password}) => {
        try {
            await options.api.authenticate(username, password, options);
            setDone({username, password});
        } catch(e) {
            win.webContents.send('validation-error', e);
        }
    });
    win.on('closed', () => {
        closed = true;
        setDone();
    });
    win.show();
    try {
        return await done;
    } finally {
        if (!closed) {
            win.close();
        }
    }
}


export async function welcomeSplash() {
    const {width, height} = electron.screen.getPrimaryDisplay().size;
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
