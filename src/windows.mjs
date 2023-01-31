import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import * as storage from './storage.mjs';
import * as patreon from './patreon.mjs';
import * as rpc from './rpc.mjs';
import * as mods from './mods.mjs';
import {EventEmitter} from 'node:events';
import {sleep} from '../shared/sauce/base.mjs';
import {createRequire} from 'node:module';
import * as menu from './menu.mjs';
import * as app from './main.mjs';

const require = createRequire(import.meta.url);
const electron = require('electron');

const isWindows = os.platform() === 'win32';
const isMac = !isWindows && os.platform() === 'darwin';
const isLinux = !isWindows && !isMac && os.platform() === 'linux';
const modContentScripts = [];
const modContentStyle = [];
const sessions = new Map();
const magicLegacySessionId = '___LEGACY-SESSION___';
const profilesKey = 'window-profiles';

let profiles;
let activeProfile;
let activeProfileSession;
let swappingProfiles;

electron.app.on('window-all-closed', () => {
    if (app.started && !app.quiting && !swappingProfiles) {
        electron.app.quit();
    }
});


class SauceBrowserWindow extends electron.BrowserWindow {
    static getAllWindows() {
        return electron.BaseWindow.getAllWindows().filter(x => x instanceof this);
    }

    constructor(options) {
        super(options);
        this.frame = options.frame !== false;
        this.spec = options.spec;
        this.subWindow = options.subWindow;
    }

    ident() {
        return (this.subWindow ? '[sub-window] ' : '') +
            (this.spec ? `specId:${this.spec.id}` : `id:${this.id}`);
    }
}


export const windowManifests = [{
    type: 'overview',
    file: '/pages/overview.html',
    prettyName: 'Overview',
    prettyDesc: 'Main top window for overall control and stats',
    private: true,
    options: {width: 0.6, height: 40, x: 0.2, y: 28},
    webPreferences: {backgroundThrottling: false}, // XXX Doesn't appear to work
    alwaysVisible: true,
}, {
    type: 'watching',
    file: '/pages/watching.html',
    prettyName: 'Currently Watching',
    prettyDesc: 'Replacement window for stats of the athlete being watched',
    options: {width: 0.18, aspectRatio: 1},
}, {
    type: 'groups',
    file: '/pages/groups.html',
    prettyName: 'Groups',
    prettyDesc: 'A zoomable view of groups of athletes',
    options: {width: 0.15, height: 0.65},
}, {
    type: 'chat',
    file: '/pages/chat.html',
    prettyName: 'Chat',
    prettyDesc: 'Chat dialog from nearby athletes',
    options: {width: 0.18, aspectRatio: 2},
}, {
    type: 'geo',
    file: '/pages/geo.html',
    prettyName: 'Map and Profile',
    prettyDesc: 'Map and of nearby athletes with optional profile',
    options: {width: 0.20, aspectRatio: 1},
}, {
    type: 'nearby',
    file: '/pages/nearby.html',
    prettyName: 'Nearby Athletes',
    prettyDesc: 'A sortable data table of nearby athletes',
    options: {width: 900, height: 0.8},
    overlay: false,
}, {
    type: 'events',
    file: '/pages/events.html',
    prettyName: 'Events',
    prettyDesc: 'Event listings and entrant information',
    options: {width: 900, height: 0.8},
    overlay: false,
}, {
    type: 'analysis',
    file: '/pages/analysis.html',
    prettyName: 'Analysis',
    prettyDesc: 'Analyze your session laps, segments and other stats',
    options: {width: 900, height: 600},
    overlay: false,
}, {
    type: 'game-control',
    file: '/pages/game-control.html',
    prettyName: 'Game Control',
    prettyDesc: 'Control game actions like view, shouting, HUD toggle, etc',
    options: {width: 300, aspectRatio: 1.65},
}, {
    type: 'power-gauge',
    groupTitle: 'Gauges',
    file: '/pages/gauges/power.html',
    prettyName: 'Power Gauge',
    prettyDesc: 'Car style power (watts) gauge',
    options: {width: 0.20, aspectRatio: 0.8},
}, {
    type: 'draft-gauge',
    groupTitle: 'Gauges',
    file: '/pages/gauges/draft.html',
    prettyName: 'Draft Gauge',
    prettyDesc: 'Car style draft (% power reduction) gauge',
    options: {width: 0.20, aspectRatio: 0.8},
}, {
    type: 'pace-gauge',
    groupTitle: 'Gauges',
    file: '/pages/gauges/pace.html',
    prettyName: 'Speed Gauge',
    prettyDesc: 'Car style pace/speed gauge',
    options: {width: 0.20, aspectRatio: 0.8},
}, {
    type: 'hr-gauge',
    groupTitle: 'Gauges',
    file: '/pages/gauges/hr.html',
    prettyName: 'Heart Rate Gauge',
    prettyDesc: 'Car style heart rate gauge',
    options: {width: 0.20, aspectRatio: 0.8},
}, {
    type: 'cadence-gauge',
    groupTitle: 'Gauges',
    file: '/pages/gauges/cadence.html',
    prettyName: 'Cadence Gauge',
    prettyDesc: 'Car style cadence gauge',
    options: {width: 0.20, aspectRatio: 0.8},
}, {
    type: 'wbal-gauge',
    groupTitle: 'Gauges',
    file: '/pages/gauges/wbal.html',
    prettyName: 'W\'bal Gauge',
    prettyDesc: 'Car style W\'bal gauge',
    options: {width: 0.20, aspectRatio: 0.8},
}, {
    type: 'stats-for-nerds',
    groupTitle: 'Misc',
    file: '/pages/stats-for-nerds.html',
    prettyName: 'Stats for Nerds',
    prettyDesc: 'Debug info (cpu/mem) about Sauce',
    options: {width: 900, height: 600},
    overlay: false,
}, {
    type: 'logs',
    groupTitle: 'Misc',
    file: '/pages/logs.html',
    prettyName: 'Debug Logs',
    prettyDesc: 'Internal logs from the Sauce app for debugging and support',
    options: {width: 900, height: 600},
    overlay: false,
}];
rpc.register(() => windowManifests, {name: 'getWindowManifests'});
const windowManifestsByType = new Map(windowManifests.map(x => [x.type, x]));

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
}, {
    id: 'default-geo-1',
    type: 'geo',
    options: {x: -8, y: 40},
}];

// NEVER use app.getAppPath() it uses asar for universal builds
const appPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const eventEmitter = new EventEmitter();


export function loadSession(name, options={}) {
    if (sessions.has(name)) {
        return sessions.get(name);
    }
    const persist = options.persist !== false;
    const partition = name !== magicLegacySessionId ? (persist ? 'persist:' : '') + name : '';
    const s = electron.session.fromPartition(partition);
    s.protocol.interceptFileProtocol('file', onInterceptFileProtocol);
    sessions.set(name, s);
    return s;
}


function onInterceptFileProtocol(request, callback) {
    let file = fileURLToPath(request.url);
    const fInfo = path.parse(file);
    file = file.substr(fInfo.root.length);
    let rootPath = appPath;
    if (file.startsWith('mods' + path.sep)) {
        for (const x of mods.available) {
            const prefix = path.normalize(`mods/${x.id}/`);
            if (file.startsWith(prefix)) {
                rootPath = x.modPath;
                file = file.substr(prefix.length);
                break;
            }
        }
    }
    // This allows files to be loaded like watching.___id-here___.html which ensures
    // some settings like zoom factor are unique to each window.
    let m;
    if (fInfo.ext === '.html' && (m = fInfo.name.match(/.\.___.+___$/))) {
        const p = path.parse(file);
        p.name = p.name.substr(0, m.index + 1);
        p.base = undefined;
        file = path.format(p);
    }
    callback(path.join(rootPath, file));
}

electron.protocol.interceptFileProtocol('file', onInterceptFileProtocol);

electron.ipcMain.on('getWindowContextSync', ev => {
    const returnValue = {
        id: null,
        type: null,
    };
    try {
        const win = ev.sender.getOwnerBrowserWindow();
        returnValue.frame = win.frame;
        if (win.spec) {
            Object.assign(returnValue, {
                id: win.spec.id,
                type: win.spec.type,
                spec: win.spec,
                manifest: windowManifestsByType.get(win.spec.type),
            });
        }
    } finally {
        ev.returnValue = returnValue; // MUST set otherwise page blocks.
    }
});

rpc.register(() => {
    for (const win of SauceBrowserWindow.getAllWindows()) {
        const manifest = windowManifestsByType.get(win.spec && win.spec.type);
        if (manifest && !manifest.alwaysVisible && win.spec.overlay !== false) {
            win.hide();
        }
    }
}, {name: 'hideAllWindows'});

rpc.register(() => {
    for (const win of SauceBrowserWindow.getAllWindows()) {
        const manifest = windowManifestsByType.get(win.spec && win.spec.type);
        if (manifest && !manifest.alwaysVisible && win.spec.overlay !== false) {
            win.showInactive();
        }
    }
}, {name: 'showAllWindows'});

rpc.register(function closeWindow() {
    const win = this.getOwnerBrowserWindow();
    console.debug('Window close requested:', win.ident());
    win.close();
});

rpc.register(function minimizeWindow() {
    const win = this.getOwnerBrowserWindow();
    if (win) {
        win.minimize();
    }
});

rpc.register(function resizeWindow(width, height, options={}) {
    const win = this.getOwnerBrowserWindow();
    if (win) {
        let x, y;
        if (options.constrainToDisplay) {
            const bounds = getCurrentDisplay().bounds;
            const aspectRatio = width / height;
            if (width > bounds.width) {
                width = bounds.width;
                height = width / aspectRatio;
            }
            if (height > bounds.height) {
                height = bounds.height;
                width = height * aspectRatio;
            }
            [x, y] = win.getPosition();
            if (x < bounds.x) {
                x = bounds.x;
            } else if (x + width > bounds.x + bounds.width) {
                x = bounds.x + bounds.width - width;
            }
            if (y < bounds.y) {
                y = bounds.y;
            } else if (y + height > bounds.y + bounds.height) {
                y = bounds.y + bounds.height - height;
            }
            win.setPosition(x, y);
        }
        win.setSize(Math.round(width), Math.round(height));
        if (options.center) {
            win.center();
        }
    }
});

rpc.register(pid => {
    for (const win of SauceBrowserWindow.getAllWindows()) {
        if (win.webContents.getOSProcessId() !== pid) {
            continue;
        }
        return {
            spec: win.spec,
            title: win.webContents.getTitle().replace(/( - )?Sauce for Zwift™?$/, ''),
            subWindow: win.subWindow,
        };
    }
}, {name: 'getWindowInfoForPID'});


export function getActiveWindow(id) {
    return SauceBrowserWindow.getAllWindows().find(x =>
        !x.subWindow && (x.spec && x.spec.id === id));
}


function initProfiles() {
    if (profiles) {
        throw new Error("Already activated");
    }
    profiles = storage.get(profilesKey);
    if (!profiles || !profiles.length) {
        const legacy = storage.get('windows');
        if (legacy) {
            console.warn("Upgrading legacy window mgmt system to profiles system...");
            profiles = [{
                id: magicLegacySessionId,
                name: 'Default',
                active: true,
                windows: legacy,
            }];
            storage.remove('windows');
        } else {
            const profile = _createProfile('Default', 'default');
            profile.active = true;
            profiles = [profile];
        }
        storage.set(profilesKey, profiles);
    }
    activeProfile = profiles.find(x => x.active);
    if (!activeProfile) {
        console.warn('No default profile found: Using first entry...');
        activeProfile = profiles[0];
        activeProfile.active = true;
    }
    activeProfileSession = loadSession(activeProfile.id);
}


export function getProfiles() {
    if (!profiles) {
        initProfiles();
    }
    return profiles;
}
rpc.register(getProfiles);


export function createProfile(name='New Profile', ident='custom') {
    const profile = _createProfile(name, ident);
    profiles.push(profile);
    storage.set(profilesKey, profiles);
    return profile;
}
rpc.register(createProfile);


function _createProfile(name, ident) {
    const windows = {};
    for (const x of defaultWindows) {
        const [id, data] = initWindow(x);
        windows[id] = data;
    }
    return {
        id: `${ident}-${Date.now()}-${Math.random() * 10000000 | 0}`,
        name,
        active: false,
        windows,
    };
}


export function activateProfile(id) {
    if (activeProfile && activeProfile.id === id) {
        console.warn("Profile already active");
        return activeProfile;
    }
    swappingProfiles = true;
    try {
        const sourceWin = this && this.getOwnerBrowserWindow();
        for (const win of SauceBrowserWindow.getAllWindows()) {
            if (win !== sourceWin && win.spec && win.webContents.session === activeProfileSession) {
                win.suspendUpdates = true;
                win.close();
            }
        }
        for (const x of profiles) {
            x.active = x.id === id;
        }
        activeProfile = profiles.find(x => x.active);
        activeProfileSession = loadSession(activeProfile.id);
        storage.set(profilesKey, profiles);
    } finally {
        swappingProfiles = false;
    }
    openAllWindows();
}
rpc.register(activateProfile);


function flushSessionStorage() {
    activeProfileSession.flushStorageData();
}
rpc.register(flushSessionStorage);


export function renameProfile(id, name) {
    for (const x of profiles) {
        if (x.id === id) {
            x.name = name;
        }
    }
    storage.set(profilesKey, profiles);
}
rpc.register(renameProfile);


export function removeProfile(id) {
    const idx = profiles.findIndex(x => x.id === id);
    if (idx === -1) {
        throw new Error("Invalid profile id");
    }
    if (profiles.length < 2) {
        throw new Error("Cannot remove last profile");
    }
    const profile = profiles.splice(idx, 1)[0];
    storage.set(profilesKey, profiles);
    if (profile.active) {
        activateProfile(profiles[0].id);
    }
}
rpc.register(removeProfile);


export function getWindows() {
    if (!activeProfile) {
        initProfiles();
    }
    return activeProfile.windows;
}
rpc.register(getWindows);


let _windowsUpdatedTimeout;
export function setWindows(wins) {
    if (app.quiting || swappingProfiles) {
        return;
    }
    if (!activeProfile) {
        initProfiles();
    }
    activeProfile.windows = wins;
    storage.set(profilesKey, profiles);
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
    if (app.quiting || swappingProfiles) {
        return w;
    }
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


function initWindow({id, type, options, ...state}) {
    id = id || `user-${type}-${Date.now()}-${Math.random() * 1000000 | 0}`;
    const manifest = windowManifestsByType.get(type);
    return [
        id,
        {
            ...manifest,
            id,
            type,
            options,
            ...state,
        }
    ];
}


export function createWindow(options) {
    const [id, data] = initWindow(options);
    setWindow(id, data);
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
    win.webContents.send('sauce-highlight-window');
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


export async function exportProfile(id) {
    const profile = profiles.find(x => x.id === id);
    if (!profile) {
        throw new Error("Profile not found");
    }
    const session = loadSession(id);
    const storage = await getWindowsStorage(session);
    return {
        version: 1,
        profile: {...JSON.parse(JSON.stringify(profile)), active: undefined, id: undefined},
        storage,
    };
}
rpc.register(exportProfile);


export async function cloneProfile(id) {
    const data = await exportProfile(id);
    data.profile.name += ' [COPY]';
    return await importProfile(data);
}
rpc.register(cloneProfile);


export async function importProfile(data) {
    if (!data || data.version !== 1) {
        throw new TypeError('Invalid data or unsupported version');
    }
    const profile = data.profile;
    profile.id = `import-${Date.now()}-${Math.random() * 10000000 | 0}`;
    profile.active = false;
    profiles.push(profile);
    const session = loadSession(profile.id);
    await setWindowsStorage(data.storage, session);
    return profile;
}
rpc.register(importProfile);


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
    // Make sure it fits...
    const finalAspectRatio = width / height;
    if (width > dSize.width) {
        width = dSize.width;
        height = width / finalAspectRatio;
    }
    if (height > dSize.height) {
        height = dSize.height;
        width = height * finalAspectRatio;
    }
    ({x, y} = _getPositionForDisplay(display, {x, y, width, height}));
    return {x, y, width, height};
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


function handleNewSubWindow(parent, spec, webPrefs) {
    // These are target=... popups...
    const targetRefs = new Map();
    parent.webContents.setWindowOpenHandler(({url, frameName: target, disposition}) => {
        if (['save-to-disk', 'other'].includes(disposition)) {
            return {action: 'allow'};
        }
        if (targetRefs.has(target)) {
            const targetWin = targetRefs.get(target).deref();
            if (!targetWin || targetWin.isDestroyed()) {
                targetRefs.delete(target);
            } else {
                if (targetWin._url !== url) {
                    targetWin._url = url;
                    targetWin.loadURL(url);
                }
                _highlightWindow(targetWin);
                return {action: 'deny'};
            }
        }
        const q = new URLSearchParams((new URL(url)).search);
        const width = Number(q.get('width')) || undefined;
        const height = Number(q.get('height')) || undefined;
        const isChildWindow = q.has('child-window');
        const display = getDisplayForWindow(parent);
        const bounds = getBoundsForDisplay(display, {width, height});
        const frame = q.has('frame') || !url.startsWith('file://');
        const newWin = new SauceBrowserWindow({
            subWindow: true,
            spec,
            frame,
            show: false,
            transparent: frame === false,
            hasShadow: frame !== false,
            roundedCorners: frame !== false,
            parent: isChildWindow ? parent : undefined,
            ...bounds,
            webPreferences: {
                sandbox: true,
                preload: path.join(appPath, 'src/preload/common.js'),
                ...webPrefs,
            }
        });
        newWin.setMenuBarVisibility(false);
        if (spec && spec.overlay !== false) {
            newWin.setAlwaysOnTop(true, 'pop-up-menu');
        }
        if (target && target !== '_blank') {
            newWin._url = url;
            targetRefs.set(target, new WeakRef(newWin));
        }
        handleNewSubWindow(newWin, spec, webPrefs);
        if (modContentScripts.length) {
            for (const x of modContentScripts) {
                newWin.webContents.on('did-finish-load', () => newWin.webContents.executeJavaScript(x));
            }
        }
        if (modContentStyle.length) {
            for (const x of modContentStyle) {
                newWin.webContents.on('did-finish-load', () => newWin.webContents.insertCSS(x));
            }
        }
        newWin.loadURL(url);
        newWin.show();
        return {action: 'deny'};
    });
}


export async function getWindowsStorage(session) {
    session || activeProfileSession;
    const win = new electron.BrowserWindow({
        show: false,
        webPreferences: {
            sandbox: true,
            session,
            preload: path.join(appPath, 'src/preload/storage-proxy.js'),
        }
    });
    const p = new Promise(resolve => win.webContents.on('ipc-message',
        (ev, ch, storage) => resolve(storage)));
    let storage;
    win.webContents.on('did-finish-load', () => win.webContents.send('export'));
    win.loadFile('/pages/dummy.html');
    try {
        storage = await p;
    } finally {
        if (!win.isDestroyed()) {
            win.destroy();
        }
    }
    return storage;
}


export async function setWindowsStorage(storage, session) {
    session || activeProfileSession;
    const win = new electron.BrowserWindow({
        show: false,
        webPreferences: {
            sandbox: true,
            session,
            preload: path.join(appPath, 'src/preload/storage-proxy.js'),
        }
    });
    const p = new Promise((resolve, reject) => win.webContents.on('ipc-message',
        (ev, ch, success) => success ? resolve() : reject()));
    win.webContents.on('did-finish-load', () => win.webContents.send('import', storage));
    win.loadFile('/pages/dummy.html');
    try {
        await p;
    } finally {
        if (!win.isDestroyed()) {
            win.destroy();
        }
    }
}


function _openWindow(id, spec) {
    console.debug("Opening window:", id, spec.type);
    const overlayOptions = {
        alwaysOnTop: true,
        maximizable: false,
        fullscreenable: false,
    };
    const manifest = windowManifestsByType.get(spec.type);
    let bounds = spec.bounds;
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
    const frame = !!options.frame;
    const win = new SauceBrowserWindow({
        spec,
        show: false,
        frame,
        transparent: frame === false,
        hasShadow: frame !== false,
        roundedCorners: frame !== false,
        webPreferences: {
            sandbox: true,
            preload: path.join(appPath, 'src/preload/common.js'),
            ...manifest.webPreferences,
            ...spec.webPreferences,
            session: activeProfileSession,
        },
        ...options,
    });
    win.setMenuBarVisibility(false);
    try {
        win.setBounds(bounds); // https://github.com/electron/electron/issues/10862
    } catch(e) {
        // If the value is something like 9000, setBounds() throws.  Just carry on as the
        // user may have had some crazy wide multi monitor setup and now does not.
        console.error("Set bounds error:", e);
    }
    if (spec.overlay !== false) {
        win.setAlwaysOnTop(true, 'pop-up-menu');
    }
    const webContents = win.webContents;  // Save to prevent electron from killing us.
    handleNewSubWindow(win, spec, {session: activeProfileSession});
    let saveStateTimeout;
    function onBoundsUpdate() {
        clearTimeout(saveStateTimeout);
        saveStateTimeout = setTimeout(() => updateWindow(id, {bounds: win.getBounds()}), 200);
    }
    win.on('move', onBoundsUpdate);
    win.on('resize', onBoundsUpdate);
    win.on('close', () => {
        if (!manifest.alwaysVisible) {
            updateWindow(id, {closed: true});
        }
    });
    if (modContentScripts.length) {
        for (const x of modContentScripts) {
            webContents.on('did-finish-load', () => webContents.executeJavaScript(x));
        }
    }
    if (modContentStyle.length) {
        for (const x of modContentStyle) {
            webContents.on('did-finish-load', () => webContents.insertCSS(x));
        }
    }
    const query = manifest.query;
    const p = path.parse(manifest.file);
    p.name += `.___${id}___`;
    p.base = undefined;
    win.loadFile(path.format(p), {query});
    win.show();
    return win;
}


let _loadedMods;
export function openAllWindows() {
    if (!_loadedMods) {
        _loadedMods = true;
        try {
            const manifests = mods.getWindowManifests();
            windowManifests.push(...manifests);
            windowManifestsByType.clear();
            for (const x of windowManifests) {
                windowManifestsByType.set(x.type, x);
            }
            modContentScripts.push(...mods.getWindowContentScripts());
            modContentStyle.push(...mods.getWindowContentStyle());
        } catch(e) {
            console.error("Failed to load mod window data", e);
        }
    }
    for (const [id, spec] of Object.entries(getWindows())) {
        const manifest = windowManifestsByType.get(spec.type);
        if (manifest && (manifest.alwaysVisible || !spec.closed)) {
            try {
                _openWindow(id, spec);
            } catch(e) {
                console.error("Failed to open window", id, spec, e);
            }
        }
    }
}


export function makeCaptiveWindow(options={}, webPrefs={}) {
    const display = getCurrentDisplay();
    const bounds = getBoundsForDisplay(display, options);
    const session = webPrefs.session || activeProfileSession;
    const win = new SauceBrowserWindow({
        center: true,
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
            sandbox: true,
            preload: path.join(appPath, 'src/preload/common.js'),
            ...webPrefs,
            session,
        },
        ...options,
        ...bounds,
    });
    win.setMenuBarVisibility(false);
    if (!options.disableNewWindowHandler) {
        handleNewSubWindow(win, null, {...webPrefs, session});
    }
    if (options.file) {
        const query = options.query;
        win.loadFile(options.file, {query});
    }
    return win;
}


export async function eulaConsent() {
    if (storage.get('eula-consent')) {
        return true;
    }
    const win = makeCaptiveWindow({file: '/pages/eula.html'});
    let closed;
    const consenting = new Promise(resolve => {
        rpc.register(async agree => {
            if (agree === true) {
                storage.set('eula-consent', true);
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
        file: '/pages/update.html',
        query: {newVersion: `v${version}`},
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
        file: '/pages/release-notes.html',
        width: 512,
        height: 600,
    });
    await new Promise(resolve => win.on('closed', resolve));
}


export async function zwiftLogin(options) {
    const win = makeCaptiveWindow({
        file: options.monitor ? '/pages/zwift-monitor-login.html' : '/pages/zwift-login.html',
        width: options.monitor ? 500 : 460,
        height: options.monitor ? 720 : 500,
        show: false,
    }, {
        preload: path.join(appPath, 'src/preload/zwift-login.js'),
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
    win.webContents.ipc.on('zwift-creds', onCreds);
    win.show();
    try {
        return await done;
    } finally {
        if (!closed) {
            win.close();
        }
    }
}


export async function confirmDialog(options) {
    const modal = !!options.parent;
    const win = makeCaptiveWindow({
        file: '/pages/confirm-dialog.html',
        width: options.width || 400,
        height: options.height || 500,
        show: false,
        modal,
        parent: options.parent,
        spec: {options: {...options, parent: undefined}},
    });
    let closed;
    const done = new Promise(resolve => {
        win.on('closed', () => {
            closed = true;
            resolve(false);
        });
        win.webContents.ipc.handle('confirm-dialog-response', (ev, confirmed) => resolve(confirmed));
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
            preload: path.join(appPath, 'src/preload/common.js'),
        },
    });
    welcomeWin.removeMenu();
    welcomeWin.excludedFromShownWindowsMenu = true;
    welcomeWin.setAlwaysOnTop(true, 'screen-saver');
    welcomeWin.setIgnoreMouseEvents(true);
    welcomeWin.loadFile('/pages/welcome.html');
    welcomeWin.show();
    return await sleep(16500).then(() => welcomeWin.close());
}


export async function patronLink() {
    let membership = storage.get('patron-membership');
    if (membership && membership.patronLevel >= 10) {
        // XXX Implement refresh once in a while.
        return true;
    }
    const win = makeCaptiveWindow({
        file: '/pages/patron.html',
        width: 400,
        height: 720,
        disableNewWindowHandler: true,
    }, {
        preload: path.join(appPath, 'src/preload/patron-link.js'),
        session: loadSession('patreon'),
    });
    // Prevent Patreon's datedome.co bot service from blocking us.
    const ua = win.webContents.userAgent;
    win.webContents.userAgent = ua.replace(/ SauceforZwift.*? /, ' ').replace(/ Electron\/.*? /, ' ');
    let resolve;
    win.webContents.ipc.on('patreon-reset-session', async () => {
        win.webContents.session.clearStorageData();
        win.webContents.session.clearCache();
        electron.app.relaunch();
        win.close();
    });
    win.webContents.ipc.on('patreon-auth-code', (ev, code) => resolve({code}));
    win.webContents.ipc.on('patreon-special-token', (ev, token) => resolve({token}));
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
            storage.set('patron-membership', membership);
            win.close();
            return true;
        } else {
            const query = {};
            if (isAuthed) {
                query.id = patreon.getUserId();
                if (membership) {
                    query.isPatron = true;
                    query.patronLevel = membership.patronLevel;
                }
            }
            win.loadFile('/pages/non-patron.html', {query});
        }
    }
}


export async function systemMessage(msg) {
    const overviewWin = SauceBrowserWindow.getAllWindows().find(x => x.spec && x.spec.type === 'overview');
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
            preload: path.join(appPath, 'src/preload/common.js'),
        },
    });
    sysWin.removeMenu();
    sysWin.excludedFromShownWindowsMenu = true;
    sysWin.setAlwaysOnTop(true, 'screen-saver');
    sysWin.setIgnoreMouseEvents(true);
    sysWin.loadFile('/pages/system-message.html');
    sysWin.show();
}
