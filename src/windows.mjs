import path from 'node:path';
import os from 'node:os';
import urlMod from 'node:url';
import * as storageMod from './storage.mjs';
import * as patreon from './patreon.mjs';
import * as rpc from './rpc.mjs';
import * as mods from './mods.mjs';
import {EventEmitter} from 'node:events';
import {sleep} from '../shared/sauce/base.mjs';
import {createRequire} from 'node:module';
import * as menu from './menu.mjs';
import * as main from './main.mjs';
import * as mime from './mime.mjs';

const require = createRequire(import.meta.url);
const electron = require('electron');

const isWindows = os.platform() === 'win32';
const isMac = !isWindows && os.platform() === 'darwin';
const isLinux = !isWindows && !isMac && os.platform() === 'linux';
const sessions = new Map();
const magicLegacySessionId = '___LEGACY-SESSION___';
const profilesKey = 'window-profiles';

let profiles;
let activeProfile;
let activeProfileSession;
let swappingProfiles;

electron.app.on('window-all-closed', () => {
    if (main.started && !main.quiting && !swappingProfiles) {
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

    loadFile(pathname, options) {
        // Same as stock loadFile except we don't inject electron.app.getAppPath().
        // On windows this will add a drive letter root to all paths. This is
        // machine dependent, unnecessary and increases the complexity of our
        // electron.protocol.handle(...) interceptor.
        return this.loadURL(urlMod.format({
            protocol: 'file',
            slashes: true,
            pathname,
            ...options,
        }));
    }
}


export const widgetWindowManifests = [{
    type: 'overview',
    file: '/pages/overview.html',
    prettyName: 'Overview',
    prettyDesc: 'Main top window for overall control and stats',
    private: true,
    options: {width: 0.6, height: 40, x: 0.2, y: 28},
    webPreferences: {backgroundThrottling: false}, // XXX Doesn't appear to work
    alwaysVisible: true,
}, {
    type: 'profile',
    file: '/pages/profile.html',
    prettyName: 'Profile',
    prettyDesc: 'Athlete profile',
    options: {width: 780, height: 340},
    overlay: false,
    private: true,
}, {
    type: 'watching',
    file: '/pages/watching.html',
    prettyName: 'Grid (Currently Watching)',
    prettyDesc: 'Grid window for stats of the athlete being watched',
    options: {width: 0.18, aspectRatio: 1},
}, {
    type: 'groups',
    file: '/pages/groups.html',
    prettyName: 'Groups',
    prettyDesc: 'A zoomable view of groups of athletes',
    options: {width: 0.15, height: 0.65},
}, {
    type: 'geo',
    file: '/pages/geo.html',
    prettyName: 'Map',
    prettyDesc: 'Map and elevation profile',
    options: {width: 0.18, aspectRatio: 1},
}, {
    type: 'chat',
    file: '/pages/chat.html',
    prettyName: 'Chat',
    prettyDesc: 'Chat dialog from nearby athletes',
    options: {width: 0.18, aspectRatio: 2},
}, {
    type: 'nearby',
    file: '/pages/nearby.html',
    prettyName: 'Nearby Athletes',
    prettyDesc: 'A sortable data table of nearby athletes',
    options: {width: 900, height: 0.8},
    overlay: false,
}, {
    type: 'analysis',
    file: '/pages/analysis.html',
    prettyName: 'Analysis',
    prettyDesc: 'Analyze your session laps, segments and other stats',
    options: {width: 1080, height: 0.8},
    overlay: false,
}, {
    type: 'athletes',
    file: '/pages/athletes.html',
    prettyName: 'Athletes',
    prettyDesc: 'View, find and manage athletes',
    options: {width: 960, height: 0.7},
    overlay: false,
}, {
    type: 'events',
    file: '/pages/events.html',
    prettyName: 'Events',
    prettyDesc: 'Event listings and entrant information',
    options: {width: 1000, height: 0.7},
    overlay: false,
}, {
    type: 'game-control',
    file: '/pages/game-control.html',
    prettyName: 'Game Control',
    prettyDesc: 'Control game actions like view, shouting, HUD toggle, etc',
    options: {width: 300, aspectRatio: 1.52},
}, {
    type: 'segments',
    file: '/pages/segments.html',
    prettyName: 'Segments [prototype]',
    prettyDesc: 'View recent segments results',
    options: {width: 300, aspectRatio: 1.8},
}, {
    type: 'browser-source',
    file: '/pages/browser-source.html',
    prettyName: 'Browser Source',
    prettyDesc: 'Open a browser window to any custom site',
    webPreferences: {webviewTag: true},
    emulateNormalUserAgent: true,
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
    options: {width: 1000, height: 600},
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
const widgetWindowManifestsByType = new Map(widgetWindowManifests.map(x => [x.type, x]));


function getWidgetWindowManifests() {
    return widgetWindowManifests;
}
rpc.register(getWidgetWindowManifests);
rpc.register(getWidgetWindowManifests, {name: 'getWindowManifests', deprecatedBy: getWidgetWindowManifests});


const defaultWidgetWindows = [{
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
const appPath = path.join(path.dirname(urlMod.fileURLToPath(import.meta.url)), '..');
export const eventEmitter = new EventEmitter();


function isInternalScheme(url) {
    return ['file'].includes(new URL(url).protocol);
}


export function loadSession(name, options={}) {
    if (sessions.has(name)) {
        return sessions.get(name);
    }
    const persist = options.persist !== false;
    const partition = name !== magicLegacySessionId ? (persist ? 'persist:' : '') + name : '';
    const s = electron.session.fromPartition(partition);
    s.protocol.handle('file', onHandleFileProtocol.bind(s));
    sessions.set(name, s);
    return s;
}


function emulateNormalUserAgent(win) {
    const ua = win.webContents.session.getUserAgent()
        .replace(/ SauceforZwift.*? /, ' ')
        .replace(/ Electron\/.*? /, ' ');
    win.webContents.setUserAgent(ua);
    const wr = win.webContents.session.webRequest;
    if (!wr._emNormUserAgentWebContents) {
        wr._emNormUserAgentWebContents = new WeakSet();
        wr.onBeforeSendHeaders((x, cb) => {
            if (wr._emNormUserAgentWebContents.has(x.webContents)) {
                x.requestHeaders['User-Agent'] = ua;
            }
            cb(x);
        });
    }
    wr._emNormUserAgentWebContents.add(win.webContents);
    win.webContents.on('did-create-window', subWin => {
        subWin.webContents.setUserAgent(ua);
        wr._emNormUserAgentWebContents.add(subWin.webContents);
    });
    win.webContents.on('did-attach-webview', (ev, webContents) => {
        webContents.setUserAgent(ua);
        wr._emNormUserAgentWebContents.add(webContents);
    });
}


function onHandleFileProtocol(request) {
    const url = urlMod.parse(request.url);
    let pathname = url.pathname;
    let rootPath = appPath;
    if (pathname === '/sauce:dummy') {
        return new Response('');
    }
    // This allows files to be loaded like watching.___id-here___.html which ensures
    // some settings like zoom factor are unique to each window (they don't conform to origin
    // based sandboxing).
    const pInfo = path.parse(pathname);
    const idMatch = pInfo.name.match(/\.___.+___$/);
    if (idMatch) {
        pInfo.name = pInfo.name.substr(0, idMatch.index);
        pInfo.base = undefined;
        pathname = path.format(pInfo);
    }
    const modMatch = pathname.match(/\/mods\/(.+?)\//);
    if (modMatch) {
        const modId = modMatch[1]; // e.g. "foo-mod-123"
        const mod = mods.getMod(modId);
        if (!mod) {
            console.error("Invalid Mod ID:", modId);
            return new Response(null, {status: 404});
        }
        const root = modMatch[0]; // e.g. "/mods/foo-mod-123/"
        pathname = pathname.substr(root.length);
        if (!mod.packed) {
            rootPath = mod.modPath;
        } else {
            return mod.zip.entryData(path.join(mod.zipRootDir, pathname)).then(data => {
                const headers = {};
                const mimeType = mime.mimeTypesByExt.get(pInfo.ext.substr(1));
                if (mimeType) {
                    headers['content-type'] = mimeType;
                } else {
                    console.warn("Could not determine mime type for:", pathname);
                }
                return new Response(data, {status: data.byteLength ? 200 : 204, headers});
            }).catch(e => {
                if (e.message.match(/(not found|not file)/)) {
                    return new Response(null, {status: 404});
                } else {
                    throw e;
                }
            });
        }
    }
    const elFetch = this ? this.fetch.bind(this) : electron.net.fetch;
    return elFetch(`file://${path.join(rootPath, pathname)}`, {bypassCustomProtocolHandlers: true});
}
electron.protocol.handle('file', onHandleFileProtocol);


electron.ipcMain.on('getWindowMetaSync', ev => {
    const meta = {
        context: {
            id: null,
            type: null,
        },
        modContentScripts: mods.contentScripts,
        modContentStylesheets: mods.contentCSS,
    };
    try {
        const win = ev.sender.getOwnerBrowserWindow();
        meta.context.frame = win.frame;
        if (win.spec) {
            Object.assign(meta.context, {
                id: win.spec.id,
                type: win.spec.type,
                spec: win.spec,
                manifest: widgetWindowManifestsByType.get(win.spec.type),
            });
        }
    } finally {
        // CAUTION: ev.returnValue is highly magical.  It MUST be set to avoid hanging
        // the page load and it can only be set once the value is frozen because it will
        // copy/serialize the contents when assigned.
        ev.returnValue = meta;
    }
});


function canToggleVisibility(win) {
    const manifest = widgetWindowManifestsByType.get(win.spec && win.spec.type);
    if (!manifest) {
        return false;
    }
    return manifest.alwaysVisible == null ? win.spec.overlay !== false : !manifest.alwaysVisible;
}


rpc.register(() => {
    for (const win of SauceBrowserWindow.getAllWindows()) {
        if (canToggleVisibility(win)) {
            if (!win.isMinimized()) {  // Workaround for electron/electron#41063
                win.hide();
            }
        }
    }
}, {name: 'hideAllWindows'});

rpc.register(() => {
    for (const win of SauceBrowserWindow.getAllWindows()) {
        if (canToggleVisibility(win)) {
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


export function getWidgetWindow(id) {
    return SauceBrowserWindow.getAllWindows().find(x =>
        !x.subWindow && (x.spec && x.spec.id === id));
}


function initProfiles() {
    if (profiles) {
        throw new Error("Already activated");
    }
    profiles = storageMod.get(profilesKey);
    if (!profiles || !profiles.length) {
        const legacy = storageMod.get('windows');
        if (legacy) {
            console.warn("Upgrading legacy window mgmt system to profiles system...");
            profiles = [{
                id: magicLegacySessionId,
                name: 'Default',
                active: true,
                windows: legacy,
            }];
            storageMod.remove('windows');
        } else {
            const profile = _createProfile('Default', 'default');
            profile.active = true;
            profiles = [profile];
        }
        storageMod.set(profilesKey, profiles);
    }
    activeProfile = profiles.find(x => x.active);
    if (!activeProfile) {
        console.warn('No default profile found: Using first entry...');
        activeProfile = profiles[0];
        activeProfile.active = true;
    }
    if (!activeProfile.windowStack) {
        activeProfile.windowStack = [];
    }
    if (!activeProfile.subWindowSettings) {
        activeProfile.subWindowSettings = {};
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
    storageMod.set(profilesKey, profiles);
    return profile;
}
rpc.register(createProfile);


function _createProfile(name, ident) {
    const windows = {};
    for (const x of defaultWidgetWindows) {
        const spec = initWidgetWindowSpec(x);
        windows[spec.id] = spec;
    }
    return {
        id: `${ident}-${Date.now()}-${Math.random() * 10000000 | 0}`,
        name,
        active: false,
        windows,
        subWindowSettings: {},
        windowStack: [],
    };
}


export function activateProfile(id) {
    if (!profiles.find(x => x.id === id)) {
        console.error("Invalid profile ID:", id);
        return null;
    }
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
        if (!activeProfile.windowStack) {
            activeProfile.windowStack = [];
        }
        activeProfileSession = loadSession(activeProfile.id);
        storageMod.set(profilesKey, profiles);
    } finally {
        swappingProfiles = false;
    }
    openWidgetWindows();
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
    storageMod.set(profilesKey, profiles);
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
    storageMod.set(profilesKey, profiles);
    if (profile.active) {
        activateProfile(profiles[0].id);
    }
}
rpc.register(removeProfile);


export function getWidgetWindowSpecs() {
    if (!activeProfile) {
        initProfiles();
    }
    const windows = Object.entries(activeProfile.windows);
    const stack = activeProfile.windowStack || [];
    windows.sort(([a], [b]) => stack.indexOf(b) - stack.indexOf(a));
    return windows.map(x => x[1]);
}
rpc.register(getWidgetWindowSpecs);
rpc.register(() => {
    if (!activeProfile) {
        initProfiles();
    }
    return activeProfile.windows;
}, {name: 'getWindows', deprecatedBy: getWidgetWindowSpecs});


let _windowsUpdatedTimeout;
export function saveProfiles() {
    if (main.quiting || swappingProfiles) {
        return;
    }
    if (!activeProfile) {
        initProfiles();
    }
    storageMod.set(profilesKey, profiles);
    clearTimeout(_windowsUpdatedTimeout);
    _windowsUpdatedTimeout = setTimeout(() => {
        eventEmitter.emit('save-widget-window-specs', activeProfile.windows);
        eventEmitter.emit('set-windows', activeProfile.windows); // DEPRECATED
    }, 200);
}


export function getWidgetWindowSpec(id) {
    if (!activeProfile) {
        initProfiles();
    }
    return activeProfile.windows[id];
}
rpc.register(getWidgetWindowSpec);
rpc.register(getWidgetWindowSpec, {name: 'getWindow', deprecatedBy: getWidgetWindowSpec});


export function getSubWindowSettings(id) {
    if (!activeProfile) {
        initProfiles();
    }
    return activeProfile.subWindowSettings[id];
}


export function setWidgetWindowSpec(id, data) {
    if (!activeProfile) {
        initProfiles();
    }
    activeProfile.windows[id] = data;
    saveProfiles();
}
rpc.register(setWidgetWindowSpec);
rpc.register(setWidgetWindowSpec, {name: 'setWindow', deprecatedBy: setWidgetWindowSpec});


export function updateWidgetWindowSpec(id, updates) {
    let spec = getWidgetWindowSpec(id);
    if (!spec) {
        spec = activeProfile.windows[id] = {};
    }
    if (main.quiting || swappingProfiles) {
        return spec;
    }
    Object.assign(spec, updates);
    saveProfiles();
    if ('closed' in updates) {
        setTimeout(menu.updateTrayMenu, 100);
    }
    return spec;
}
rpc.register(updateWidgetWindowSpec);
rpc.register(updateWidgetWindowSpec, {name: 'updateWindow', deprecatedBy: updateWidgetWindowSpec});


export function updateSubWindowSettings(id, updates) {
    let settings = getSubWindowSettings(id);
    if (!settings) {
        settings = activeProfile.subWindowSettings[id] = {};
    }
    if (main.quiting || swappingProfiles) {
        return settings;
    }
    Object.assign(settings, updates);
    saveProfiles();
    if ('closed' in updates) {
        setTimeout(menu.updateTrayMenu, 100);
    }
    return settings;
}


export function removeWidgetWindow(id) {
    const win = getWidgetWindow(id);
    if (win) {
        win.close();
    }
    if (!activeProfile) {
        initProfiles();
    }
    delete activeProfile.windows[id];
    saveProfiles();
    setTimeout(menu.updateTrayMenu, 100);
}
rpc.register(removeWidgetWindow);
rpc.register(removeWidgetWindow, {name: 'removeWindow', deprecatedBy: removeWidgetWindow});


function initWidgetWindowSpec({id, type, options, ...rem}) {
    id = id || `user-${type}-${Date.now()}-${Math.random() * 1000000 | 0}`;
    const manifest = widgetWindowManifestsByType.get(type);
    const spec = {
        ...manifest,
        id,
        type,
        ...rem,
    };
    spec.options = Object.assign({}, spec.options, options);
    return spec;
}


export function createWidgetWindow(options) {
    const spec = initWidgetWindowSpec(options);
    setWidgetWindowSpec(spec.id, spec);
    setTimeout(menu.updateTrayMenu, 100);
    return spec;
}
rpc.register(createWidgetWindow);
rpc.register(options => createWidgetWindow(options).id,
             {name: 'createWindow', deprecatedBy: createWidgetWindow});


export function highlightWidgetWindow(id) {
    const win = getWidgetWindow(id);
    if (win) {
        _highlightWindow(win);
    }
}
rpc.register(highlightWidgetWindow);
rpc.register(highlightWidgetWindow, {name: 'highlightWindow', deprecatedBy: highlightWidgetWindow});


rpc.register(function() {
    const wc = this;
    if (!wc) {
        throw new TypeError('electron-only rpc function');
    }
    const win = wc.getOwnerBrowserWindow();
    if (isMac) {
        electron.app.focus({steal: true});
    }
    win.focus();
}, {name: 'focusOwnWindow'});



function _highlightWindow(win) {
    if (!win.isVisible() || win.isMinimized()) {
        win.show();
    } else {
        win.focus();
    }
    win.webContents.send('sauce-highlight-window');
}


export function reopenWidgetWindow(id) {
    const win = getWidgetWindow(id);
    if (win) {
        win.close();
    }
    openWidgetWindow(id);
}
rpc.register(reopenWidgetWindow);
rpc.register(reopenWidgetWindow, {name: 'reopenWindow', deprecatedBy: reopenWidgetWindow});


export function openWidgetWindow(id) {
    const spec = getWidgetWindowSpec(id);
    if (spec.closed) {
        updateWidgetWindowSpec(id, {closed: false});
    }
    _openSpecWindow(spec);
}
rpc.register(openWidgetWindow);
rpc.register(openWidgetWindow, {name: 'openWindow', deprecatedBy: openWidgetWindow});


function _saveWindowAsTop(id) {
    if (!activeProfile) {
        throw new Error("no active profile");
    }
    if (!activeProfile.windowStack) {
        throw new Error("no window stack");
    }
    if (!activeProfile.windows[id]) {
        throw new Error("Invalid window id");
    }
    const stack = activeProfile.windowStack;
    const idx = stack.indexOf(id);
    if (idx !== -1) {
        stack.splice(idx, 1);
    }
    stack.push(id);
    saveProfiles();
}


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
        x = db.x + (db.width - width) / 2;
    } else if (x < 0) {
        x = db.x + db.width + x - width;
    } else if (x <= 1) {
        x = db.x + db.width * x;
    } else {
        x = db.x + x;
    }
    if (y == null) {
        y = db.y + (db.height - height) / 2;
    } else if (y < 0) {
        y = db.y + db.height + y - height;
    } else if (y <= 1) {
        y = db.y + db.height * y;
    } else {
        y = db.y + y;
    }
    // Must use integer values for electron.BrowserWindow
    x = Math.round(x);
    y = Math.round(y);
    return {x, y};
}


function getBoundsForDisplay(display, {x, y, width, height, aspectRatio}) {
    const defaultWidth = 800;
    const defaultHeight = 600;
    const dSize = display.size;
    width = width != null && width <= 1 ? dSize.width * width : width;
    height = height != null && height <= 1 ? dSize.height * height : height;
    if (aspectRatio) {
        if (width == null && height == null) {
            width = defaultWidth;
        }
        if (height == null) {
            height = width * aspectRatio;
        } else {
            width = width / aspectRatio;
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
    // Must use integer values for electron.BrowserWindow
    width = Math.round(width);
    height = Math.round(height);
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
        const newWinOptions = {};
        const q = new URLSearchParams((new URL(url)).search);
        const windowType = q.get('windowType');
        if (windowType) {
            const m = widgetWindowManifestsByType.get(windowType);
            Object.assign(newWinOptions, m && m.options);
        }
        const windowId = q.get('windowId');
        if (windowId) {
            Object.assign(newWinOptions, getSubWindowSettings(windowId));
        }
        const w = Number(q.get('width'));
        const h = Number(q.get('height'));
        if (w) {
            newWinOptions.width = w;
        }
        if (h) {
            newWinOptions.height = h;
        }
        const isChildWindow = q.has('child-window');
        const display = getDisplayForWindow(parent);
        const bounds = getBoundsForDisplay(display, newWinOptions);
        const newWinSpec = (windowId || windowType) ?
            initWidgetWindowSpec({type: windowType, id: windowId || spec?.id}) : spec;
        const frame = q.has('frame') || isInternalScheme(url) || !!newWinSpec?.options?.frame;
        const newWin = new SauceBrowserWindow({
            subWindow: true,
            spec: newWinSpec,
            frame,
            show: false,
            transparent: frame === false,
            hasShadow: frame !== false,
            roundedCorners: frame !== false,
            parent: isChildWindow ? parent : undefined,
            ...bounds,
            webPreferences: {
                preload: path.join(appPath, 'src/preload/common.js'),  // CAUTION: can be overridden
                ...webPrefs,
                sandbox: true,
            }
        });
        newWin.webContents.on('will-attach-webview', ev => {
            ev.preventDefault();
            console.error("<webview> in sub window is not allowed");
        });
        if (windowId) {
            let _to;
            newWin.on('resize', () => {
                clearTimeout(_to);
                _to = setTimeout(() => {
                    const [_width, _height] = newWin.getSize();
                    updateSubWindowSettings(windowId, {width: _width, height: _height});
                }, 200);
            });
        }
        newWin.setMenuBarVisibility(false);
        if ((newWinSpec && newWinSpec.overlay !== false) || parent.isAlwaysOnTop()) {
            newWin.setAlwaysOnTop(true, 'pop-up-menu');
        }
        if (target && target !== '_blank') {
            newWin._url = url;
            targetRefs.set(target, new WeakRef(newWin));
        }
        handleNewSubWindow(newWin, newWinSpec, webPrefs);
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
            session,
            preload: path.join(appPath, 'src/preload/storage-proxy.js'),
            sandbox: true,
        }
    });
    let _resolve;
    win.webContents.on('ipc-message', (ev, ch, storage) => _resolve(storage));
    win.webContents.on('did-finish-load', () => win.webContents.send('export'));
    const p = new Promise(resolve => _resolve = resolve);
    let storage;
    try {
        win.loadURL('file:///sauce:dummy');
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
            session,
            preload: path.join(appPath, 'src/preload/storage-proxy.js'),
            sandbox: true,
        }
    });
    let _resolve, _reject;
    win.webContents.on('ipc-message', (ev, ch, success) => success ? _resolve() : _reject());
    win.webContents.on('did-finish-load', () => win.webContents.send('import', storage));
    const p = new Promise((resolve, reject) => (_resolve = resolve, _reject = reject));
    try {
        win.loadURL('file:///sauce:dummy');
        await p;
    } finally {
        if (!win.isDestroyed()) {
            win.destroy();
        }
    }
}


function _openSpecWindow(spec) {
    const id = spec.id;
    console.info(`Opening window [${spec.ephemeral ? 'EPHEMERAL' : 'WIDGET'}] (${spec.type}):`, id);
    const overlayOptions = {
        alwaysOnTop: true,
        maximizable: false,
        fullscreenable: false,
    };
    const manifest = widgetWindowManifestsByType.get(spec.type);
    let bounds = spec.bounds;
    const inBounds = !bounds || isWithinDisplayBounds(bounds);
    if (!inBounds) {
        console.warn("Reseting window that is out of bounds:", bounds);
    }
    if (!inBounds || !bounds) {
        bounds = getBoundsForDisplay(getCurrentDisplay(), {...manifest.options, ...spec.options});
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
        ...options,
        webPreferences: {
            ...manifest.webPreferences,
            preload: path.join(appPath, 'src/preload/common.js'),
            session: activeProfileSession,
            sandbox: true,
        },
    });
    const webContents = win.webContents;  // Save to prevent electron from killing us.
    webContents.on('will-attach-webview', (ev, webPreferences) => {
        webPreferences.preload = path.join(appPath, 'src/preload/webview.js');
        webPreferences.session = activeProfileSession;
    });
    if (spec.emulateNormalUserAgent) {
        emulateNormalUserAgent(win);
    }
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
    handleNewSubWindow(win, spec, {session: activeProfileSession});
    let boundsSaveTimeout;
    const onBoundsUpdate = () => {
        clearTimeout(boundsSaveTimeout);
        boundsSaveTimeout = setTimeout(() => updateWidgetWindowSpec(id, {bounds: win.getBounds()}), 200);
    };
    if (!spec.ephemeral) {
        win.on('move', onBoundsUpdate);
        win.on('resize', onBoundsUpdate);
        win.on('focus', () => _saveWindowAsTop(id));
        if (!manifest.alwaysVisible) {
            win.on('close', () => updateWidgetWindowSpec(id, {closed: true}));
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
export function openWidgetWindows() {
    if (!_loadedMods) {
        _loadedMods = true;
        try {
            const manifests = mods.getWindowManifests();
            widgetWindowManifests.push(...manifests);
            widgetWindowManifestsByType.clear();
            for (const x of widgetWindowManifests) {
                widgetWindowManifestsByType.set(x.type, x);
            }
        } catch(e) {
            console.error("Failed to load mod window data", e);
        }
    }
    for (const spec of getWidgetWindowSpecs().reverse()) {
        const manifest = widgetWindowManifestsByType.get(spec.type);
        if (manifest && (manifest.alwaysVisible || !spec.closed)) {
            try {
                _openSpecWindow(spec);
            } catch(e) {
                console.error("Failed to open window", spec.id, e);
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
        ...options,
        ...bounds,
        webPreferences: {
            preload: path.join(appPath, 'src/preload/common.js'),  // CAUTION: can be overridden
            ...webPrefs,
            session,
            sandbox: true,
        },
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


export function makeOrFocusEphemeralWindow(options) {
    const spec = initWidgetWindowSpec({...options, ephemeral: true});
    return _openSpecWindow(spec);
}


export async function eulaConsent() {
    if (storageMod.get('eula-consent')) {
        return true;
    }
    const win = makeCaptiveWindow({file: '/pages/eula.html'});
    let closed;
    const consenting = new Promise(resolve => {
        rpc.register(agree => {
            if (agree === true) {
                storageMod.set('eula-consent', true);
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
            preload: path.join(appPath, 'src/preload/common.js'),
            sandbox: true,
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


export async function patronLink({sauceApp, forceCheck}) {
    let membership = storageMod.get('patron-membership');
    if (membership && membership.patronLevel >= 10 && !forceCheck) {
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
    // Prevent Patreon's datedome.co bot service from blocking us and fix federated logins.. (legacy only now)
    emulateNormalUserAgent(win);
    let resolve;
    win.webContents.ipc.on('patreon-reset-session', () => {
        win.webContents.session.clearStorageData();
        win.webContents.session.clearCache();
        electron.app.relaunch();
        win.close();
    });
    win.webContents.ipc.on('patreon-auth-code', (ev, code) => resolve({code, legacy: true}));
    win.webContents.ipc.on('patreon-special-token', (ev, token) => resolve({token}));
    sauceApp.on('external-open', x => {
        if (x.name === 'patron' && x.path === '/link') {
            resolve({code: x.data.code});
        }
    });
    win.on('closed', () => resolve({closed: true}));
    let isMember = false;
    while (true) {
        const {code, token, closed, legacy} = await new Promise(_resolve => resolve = _resolve);
        let isAuthed;
        if (closed) {
            return isMember;
        } else if (token) {
            membership = await patreon.getLegacyMembership(token);
        } else {
            win.loadFile('/pages/patron-checking.html');
            isAuthed = code && await patreon.link(code, {legacy});
            membership = isAuthed && await patreon.getMembership({legacy});
        }
        if (membership && membership.patronLevel >= 10) {
            isMember = true;
            storageMod.set('patron-membership', membership);
            win.loadFile('/pages/patron-success.html');
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


export function systemMessage(msg) {
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
            preload: path.join(appPath, 'src/preload/common.js'),
            sandbox: true,
        },
    });
    sysWin.removeMenu();
    sysWin.excludedFromShownWindowsMenu = true;
    sysWin.setAlwaysOnTop(true, 'screen-saver');
    sysWin.setIgnoreMouseEvents(true);
    sysWin.loadFile('/pages/system-message.html');
    sysWin.show();
}
