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


class SauceBrowserWindow extends electron.BrowserWindow {
    constructor(options) {
        super(options);
        this.frame = options.frame !== false;
    }
}


export const windowManifests = [{
    type: 'overview',
    page: 'overview.html',
    prettyName: 'Overview',
    prettyDesc: 'Main top window for overall control and stats',
    private: true,
    options: {width: 0.6, height: 40, x: 0.2, y: 28},
    webPreferences: {backgroundThrottling: false}, // XXX Doesn't appear to work
    alwaysVisible: true,
}, {
    type: 'watching',
    page: 'watching.html',
    prettyName: 'Currently Watching',
    prettyDesc: 'Replacement window for stats of the athlete being watched',
    options: {width: 0.18, aspectRatio: 1},
}, {
    type: 'groups',
    page: 'groups.html',
    prettyName: 'Groups',
    prettyDesc: 'A zoomable view of groups of athletes',
    options: {width: 0.15, height: 0.65},
}, {
    type: 'chat',
    page: 'chat.html',
    prettyName: 'Chat',
    prettyDesc: 'Chat dialog from nearby athletes',
    options: {width: 0.18, aspectRatio: 2},
}, {
    type: 'nearby',
    page: 'nearby.html',
    prettyName: 'Nearby Athletes',
    prettyDesc: 'A sortable data table of nearby athletes',
    options: {width: 900, height: 0.8},
    overlay: false,
}, {
    type: 'events',
    page: 'events.html',
    prettyName: 'Events',
    prettyDesc: 'Event listings and entrant information',
    options: {width: 900, height: 0.8},
    overlay: false,
}, {
    type: 'game-control',
    page: 'game-control.html',
    prettyName: 'Game Control',
    prettyDesc: 'Control game actions like view, shouting, HUD toggle, etc',
    options: {width: 300, aspectRatio: 1.65},
}, {
    type: 'power-gauge',
    groupTitle: 'Gauges',
    pageURL: 'gauge.html?t=power',
    prettyName: 'Power Gauge',
    prettyDesc: 'Car style power (watts) gauge',
    options: {width: 0.20, aspectRatio: 0.8},
}, {
    type: 'draft-gauge',
    groupTitle: 'Gauges',
    pageURL: 'gauge.html?t=draft',
    prettyName: 'Draft Gauge',
    prettyDesc: 'Car style draft (% power reduction) gauge',
    options: {width: 0.20, aspectRatio: 0.8},
}, {
    type: 'pace-gauge',
    groupTitle: 'Gauges',
    pageURL: 'gauge.html?t=pace',
    prettyName: 'Pace Gauge',
    prettyDesc: 'Car style pace/speed gauge',
    options: {width: 0.20, aspectRatio: 0.8},
}, {
    type: 'hr-gauge',
    groupTitle: 'Gauges',
    pageURL: 'gauge.html?t=hr',
    prettyName: 'Heart Rate Gauge',
    prettyDesc: 'Car style heart rate gauge',
    options: {width: 0.20, aspectRatio: 0.8},
}, {
    type: 'wbal-gauge',
    groupTitle: 'Gauges',
    pageURL: 'gauge.html?t=wbal',
    prettyName: 'W\'bal Gauge',
    prettyDesc: 'Car style W\'bal gauge',
    options: {width: 0.20, aspectRatio: 0.8},
}, {
    type: 'stats-for-nerds',
    groupTitle: 'Misc',
    page: 'stats-for-nerds.html',
    prettyName: 'Stats for Nerds',
    prettyDesc: 'Debug info (cpu/mem) about Sauce',
    options: {width: 900, height: 600},
    overlay: false,
}, {
    type: 'logs',
    groupTitle: 'Misc',
    page: 'logs.html',
    prettyName: 'Debug Logs',
    prettyDesc: 'Internal logs from the Sauce app for debugging and support',
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
    const returnValue = {
        id: null,
        type: null,
    };
    try {
        const win = ev.sender.getOwnerBrowserWindow();
        returnValue.frame = win.frame;
        const m = getMetaByWebContents(ev.sender);
        if (m) {
            const manifest = windowManifestsByType[m.spec.type];
            Object.assign(returnValue, {
                id: m.spec.id,
                type: m.spec.type,
                spec: m.spec,
                manifest,
            });
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

rpc.register(function closeWindow() {
    const win = this.getOwnerBrowserWindow();
    if (activeWindows.has(this)) {
        const {spec} = activeWindows.get(this);
        console.debug('Window close requested:', spec.id);
        win.close();
    } else {
        console.debug('Generic window close requested');
        win.close();
    }
});

rpc.register(function minimizeWindow() {
    const win = this.getOwnerBrowserWindow();
    if (win) {
        win.minimize();
    }
});

rpc.register(function toggleMaximizeWindow() {
    const win = this.getOwnerBrowserWindow();
    if (win) {
        if (win.isMaximized()) {
            win.unmaximize();
        } else {
            win.maximize();
        }
    }
});

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
            };
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
        _highlightWindow(win);
    }
}
rpc.register(highlightWindow);


function _highlightWindow(win) {
    if (!win.isVisible() || win.isMinimized()) {
        win.show();
    } else {
        win.focus();
    }
    win.webContents.send('browser-message', {domEvent: 'sauce-highlight-window'});
}


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


function _getPositionForDisplay(display, {x, y, width, height}) {
    const db = display.bounds;
    if (x == null) {
        x = db.x + Math.round((db.width - width) / 2);
    } else if (x < 0) {
        x = db.x + db.width + x - width;
    } else if (x <= 1) {
        x = db.x + Math.round(db.width * x);
    } else {
        x = db.x + x;
    }
    if (y == null) {
        y = db.y + Math.round((db.height - height) / 2);
    } else if (y < 0) {
        y = db.y + db.height + y - height;
    } else if (y <= 1) {
        y = db.y + Math.round(db.height * y);
    } else {
        y = db.y + y;
    }
    return {x, y};
}


function getBoundsForDisplay(display, {x, y, width, height, aspectRatio}) {
    const defaultWidth = 800;
    const defaultHeight = 600;
    const dSize = display.size;
    width = width != null && width <= 1 ? Math.round(dSize.width * width) : width;
    height = height != null && height <= 1 ? Math.round(dSize.height * height) : height;
    if (aspectRatio) {
        if (width == null && height == null) {
            width = defaultWidth;
        }
        if (height == null) {
            height = Math.round(width * aspectRatio);
        } else {
            width = Math.round(width / aspectRatio);
        }
    } else {
        width = width || defaultWidth;
        height = height || defaultHeight;
    }
    ({x, y} = _getPositionForDisplay(display, {x, y, width, height}));
    return {x, y, width, height};
}


function handleNewSubWindow(parent, spec) {
    // These are target=... popups...
    const targetRefs = new Map();
    parent.webContents.on('new-window', (ev, url, target) => {
        ev.preventDefault();
        if (targetRefs.has(target)) {
            const targetWin = targetRefs.get(target).deref();
            if (!targetWin) {
                targetRefs.delete(target);
            } else if (!targetWin.isDestroyed()) {
                _highlightWindow(targetWin);
                return;
            }
        }
        const q = new URLSearchParams((new URL(url)).search);
        const width = Number(q.get('width')) || undefined;
        const height = Number(q.get('height')) || undefined;
        const display = getDisplayForWindow(parent);
        const bounds = getBoundsForDisplay(display, {width, height});
        const frame = q.has('frame') || !url.startsWith('file://');
        const newWin = new SauceBrowserWindow({
            type: isLinux ? 'splash' : undefined,
            show: false,
            frame,
            transparent: frame === false,
            hasShadow: frame !== false,
            roundedCorners: frame !== false,
            parent,
            ...bounds,
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
        if (target && target !== '_blank') {
            targetRefs.set(target, new WeakRef(newWin));
        }
        newWin.on('page-title-updated', (ev, title) =>
            subWindows.get(newWin.webContents).title = title.replace(/( - )?Sauce for Zwift™?$/, ''));
        handleNewSubWindow(newWin, spec);
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
        alwaysOnTop: true,
        maximizable: false,
        fullscreenable: false,
    };
    const manifest = windowManifestsByType[spec.type];
    let bounds = spec.bounds || spec.position; // XXX spec.position is the legacy prop, remove in a few rels
    const inBounds = !bounds || isWithinDisplayBounds(bounds);
    if (!inBounds) {
        console.warn("Reseting window that is out of bounds:", bounds);
    }
    if (!inBounds || !bounds) {
        bounds = getBoundsForDisplay(getCurrentDisplay(),
            {...manifest.options, ...spec.options});
    }
    // Order of options is crucial...
    const options = {
        ...(spec.overlay !== false ? overlayOptions : {}),
        ...manifest.options,
        ...spec.options,
        ...bounds,
    };
    const win = new SauceBrowserWindow({
        type: isLinux ? 'splash' : undefined,
        show: false,
        frame: false,
        transparent: true,
        hasShadow: false,
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
    win.setBounds(bounds); // https://github.com/electron/electron/issues/10862
    if (!isDEV) {
        win.removeMenu();
    }
    if (spec.overlay !== false) {
        win.setAlwaysOnTop(true, 'pop-up-menu');
    }
    const webContents = win.webContents;  // Save to prevent electron from killing us.
    activeWindows.set(webContents, {win, spec, activeSubs: new Set()});
    handleNewSubWindow(win, spec);
    let saveStateTimeout;
    function onBoundsUpdate() {
        clearTimeout(saveStateTimeout);
        saveStateTimeout = setTimeout(() => updateWindow(id, {bounds: win.getBounds()}), 200);
    }
    win.on('page-title-updated', (ev, title) =>
            activeWindows.get(webContents).title = title.replace(/( - )?Sauce for Zwift™?$/, ''));
    win.on('move', onBoundsUpdate);
    win.on('resize', onBoundsUpdate);
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
    const display = getCurrentDisplay();
    const bounds = getBoundsForDisplay(display, options);
    const win = new SauceBrowserWindow({
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
        ...options,
        ...bounds,
    });
    if (!isDEV) {
        win.removeMenu();
    }
    if (options.page) {
        win.loadFile(path.join(pagePath, options.page));
    } else if (options.pageURL) {
        win.loadURL(`file://${path.join(pagePath, options.pageURL)}`);
    }
    return win;
}


export async function eulaConsent() {
    if (storage.load('eula-consent')) {
        return true;
    }
    const win = makeCaptiveWindow({page: 'eula.html'});
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


export async function updateConfirmationWindow(version) {
    const win = makeCaptiveWindow({
        pageURL: `update.html?newVersion=v${version}`,
        width: 400,
        height: 440,
    });
    let closed;
    const prompting = new Promise(resolve => {
        rpc.register(resolve, {name: 'confirmAppUpdate'});
        win.on('closed', () => (closed = true, resolve(false)));
    });
    const doUpdate = await prompting;
    if (!closed && !doUpdate) {
        win.close();
    }
    if (doUpdate) {
        return win;
    }
}


export async function showReleaseNotes() {
    const win = makeCaptiveWindow({
        page: 'release-notes.html',
        width: 512,
        height: 600,
    });
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
        // XXX Implement refresh once in a while.
        return true;
    }
    const win = makeCaptiveWindow({
        page: 'patron.html',
        width: 400,
        height: 720,
    }, {
        preload: path.join(appPath, 'src', 'preload', 'patron-link.js'),
        partition: 'persist:patreon',
    });
    scrubUA(win);
    let resolve;
    electron.ipcMain.on('patreon-auth-code', (ev, code) => resolve({code}));
    electron.ipcMain.on('patreon-special-token', (ev, token) => resolve({token}));
    electron.ipcMain.on('patreon-reset-session', async () => {
        win.webContents.session.clearStorageData();
        win.webContents.session.clearCache();
        electron.app.relaunch();
        win.close();
    });
    win.on('closed', () => resolve({closed: true}));
    while (true) {
        const {code, token, closed} = await new Promise(_resolve => resolve = _resolve);
        let isAuthed;
        if (closed) {
            return false;
        } else if (token) {
            membership = await patreon.getLegacyMembership(token);
        } else {
            isAuthed = code && await patreon.link(code);
            membership = isAuthed && await patreon.getMembership();
        }
        if (membership && membership.patronLevel >= 10) {
            storage.save('patron-membership', membership);
            win.close();
            return true;
        } else {
            const q = new URLSearchParams();
            if (isAuthed) {
                q.set('id', patreon.getUserId());
                if (membership) {
                    q.set('isPatron', true);
                    q.set('patronLevel', membership.patronLevel);
                }
            }
            win.loadURL(`file://${path.join(pagePath, 'non-patron.html')}?${q}`);
        }
    }
}


export async function zwiftLogin(options) {
    const win = makeCaptiveWindow({
        page: options.monitor ? 'zwift-monitor-login.html' : 'zwift-login.html',
        width: 460,
        height: 600,
        show: false,
    }, {
        preload: path.join(appPath, 'src', 'preload', 'zwift-login.js'),
    });
    let closed;
    let setDone;
    const done = new Promise(resolve => setDone = resolve);
    const onCreds = async (ev, {username, password}) => {
        try {
            await options.api.authenticate(username, password, options);
            setDone({username, password});
        } catch(e) {
            win.webContents.send('validation-error', e);
        }
    };
    win.on('closed', () => {
        closed = true;
        setDone();
    });
    electron.ipcMain.on('zwift-creds', onCreds);
    try {
        win.show();
        return await done;
    } finally {
        electron.ipcMain.off('zwift-creds', onCreds);
        if (!closed) {
            win.close();
        }
    }
}


export async function welcomeSplash() {
    const welcomeWin = new SauceBrowserWindow({
        type: isLinux ? 'splash' : undefined,
        center: true,
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
        ...getCurrentDisplay().bounds,
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


export function isWithinDisplayBounds({x, y, width, height}) {
    const centerX = x + (width || 0) / 2;
    const centerY = y + (height || 0) / 2;
    return electron.screen.getAllDisplays().some(({bounds}) =>
        centerX >= bounds.x && centerX < bounds.x + bounds.width &&
        centerY >= bounds.y && centerY < bounds.y + bounds.height);
}


export function getDisplayForWindow(win) {
    const bounds = win.getBounds();
    const centerX = Math.round(bounds.x + bounds.width / 2);
    const centerY = Math.round(bounds.y + bounds.height / 2);
    return electron.screen.getDisplayNearestPoint({x: centerX, y: centerY});
}


export function getCurrentDisplay() {
    const point = electron.screen.getCursorScreenPoint();
    return electron.screen.getDisplayNearestPoint(point) || electron.screen.getPrimaryDisplay();
}


export async function systemMessage(msg) {
    const overviewWin = Array.from(activeWindows.values()).find(x => x.spec.type === 'overview').win;
    const oBounds = overviewWin.getBounds();
    const dBounds = getDisplayForWindow(overviewWin).bounds;
    const height = 400;
    const y = (oBounds.y - dBounds.y < dBounds.height / 2) ? oBounds.y + oBounds.height : oBounds.y - height;
    const x = oBounds.x;
    const sysWin = new SauceBrowserWindow({
        type: isLinux ? 'splash' : undefined,
        width: oBounds.width,
        height,
        x,
        y,
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
    sysWin.removeMenu();
    sysWin.excludedFromShownWindowsMenu = true;
    sysWin.setAlwaysOnTop(true, 'screen-saver');
    sysWin.setIgnoreMouseEvents(true);
    sysWin.loadFile(path.join(pagePath, 'system-message.html'));
    sysWin.show();
}
