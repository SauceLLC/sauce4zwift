import path from 'node:path';
import process from 'node:process';
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
import * as hotkeys from './hotkeys.mjs';

const require = createRequire(import.meta.url);
const electron = require('electron');

const platform = os.platform();
const isWindows = platform === 'win32';
const isMac = !isWindows && platform === 'darwin';
const isLinux = !isWindows && !isMac && platform === 'linux';
const sessions = new Map();
const magicLegacySessionId = '___LEGACY-SESSION___';
const profilesKey = 'window-profiles';
const widgetWindowManifests = [];
const widgetWindowManifestsByType = new Map();
const modContentScripts = [];
const modContentStylesheets = [];
// NEVER use app.getAppPath() it uses asar for universal builds
const appPath = path.join(path.dirname(urlMod.fileURLToPath(import.meta.url)), '..');

let profiles;
let activeProfile;
let activeProfileSession;
let swappingProfiles;
let lastShowHideState = 'visible';

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


export const eventEmitter = new EventEmitter();


class SauceBrowserWindow extends electron.BrowserWindow {

    static getAllWindows() {
        return electron.BaseWindow.getAllWindows().filter(x => x instanceof this);
    }

    constructor({spec, subWindow, metaFlags, center, bounds, width, height, x, y, ...options}) {
        super({
            ...options,
            show: false,  // Always start hidden before using setBounds
        });
        this.frame = options.frame !== false;
        this.spec = spec;
        this.subWindow = subWindow;
        this.metaFlags = metaFlags;
        if (bounds == null && (width ?? height ?? x ?? y)) {
            console.error("SauceBrowserWindow misue: use `bounds` instead of x,y,width,height");
        }
        // Must manually call setBounds to avoid strange scale/rounding issues
        // See: https://github.com/electron/electron/issues/10862
        if (bounds) {
            this.safeSetBounds(bounds);
        } else {
            console.error("probably meant to include bounds?", this);
            debugger;
        }
        if (center) {
            this.center(); // buggy, causes window resize.
            if (bounds && (bounds.width ?? bounds.height)) {
                this.safeSetBounds({
                    width: bounds.width,
                    height: bounds.height,
                });
            }
        }
        this._initLogorrheaCheck();
        if (options.show !== false) {
            this.show();
        }
    }

    safeSetBounds(bounds) {
        try {
            this.setBounds(bounds);
        } catch(e) {
            // If the value is something like 9000, setBounds() throws.  Just carry on as the
            // user may have had some crazy wide multi monitor setup and now does not.
            console.error("Set bounds error:", e);
        }
    }

    _initLogorrheaCheck() {
        // If the page logs in a tight loop it breaks everything.
        // See: https://github.com/electron/electron/issues/49269
        this._logTimestamp = performance.now();
        this._logRateExpC = Math.exp(-1 / 10000);
        this._logRateWeighted = 1000;
        this._logLoopBucket = 0;
        this.webContents.on('-console-message', this._onLogorrheaCheck.bind(this));
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

    _onLogorrheaCheck(ev) {
        const now = performance.now();
        this._logTimestamp = now;
        this._logRateWeighted *= this._logRateExpC;
        this._logRateWeighted += (now - this._logTimestamp) * (1 - this._logRateExpC);
        if (this._logLoopTesting) {
            this._logLoopTestBucket++;
            if (this._logLoopTestBucket >= 100) {
                if (this.isDestroyed()) {
                    return;
                }
                console.error("Terminating window guilty of logorrhea:", this.ident());
                this._logLoopTermination = true;
                this.webContents.removeAllListeners('-console-message');
                this.webContents.destroy();
                this.destroy();
                confirmDialog({
                    message: `Terminated misbehaving window`,
                    detail: this.ident(),
                    cancel: false,
                    confirmButton: 'Dismiss',
                });
            }
        } else if (this._logRateWeighted < 3) {
            console.warn("Possible logorrhea renderer process:", this.ident());
            this._logLoopTesting = true;
            // If the system can't clear a rate bucket with a setImmediate loop then kill it..
            this._logLoopTestBucket = 50;
            const drain = () => {
                if (this._logLoopTermination) {
                    return;
                }
                if (--this._logLoopTestBucket > 0) {
                    setImmediate(drain);
                } else {
                    console.warn("Renderer process recovered from logorrhea:", this.ident());
                    // Defer any potential retest to reduce harm from the test itself.
                    this._logLoopTestBucket = -Infinity;
                    setTimeout(() => {
                        this._logLoopTesting = false;
                    }, 30000);
                }
            };
            setImmediate(drain);
        }
    }
}


export function registerWidgetWindow(manifest) {
    if (widgetWindowManifestsByType.has(manifest.type)) {
        console.error("Window type already registered:", manifest.type);
        throw new TypeError("Window type already registered");
    }
    widgetWindowManifests.push(manifest);
    widgetWindowManifestsByType.set(manifest.type, manifest);
}


export function registerModContentScript(script) {
    modContentScripts.push(script);
}


export function registerModContentStylesheet(stylesheet) {
    modContentStylesheets.push(stylesheet);
}


function getWidgetWindowManifests() {
    return widgetWindowManifests;
}
rpc.register(getWidgetWindowManifests);
rpc.register(getWidgetWindowManifests, {name: 'getWindowManifests', deprecatedBy: getWidgetWindowManifests});


function isInternalScheme(url) {
    try {
        return ['file:'].includes(new URL(url).protocol);
    } catch(e) {
        console.error('Invalid URL:', url);
        return false;
    }
}


export function loadSession(name, options={}) {
    if (sessions.has(name)) {
        return sessions.get(name);
    }
    const persist = options.persist !== false;
    const partition = name !== magicLegacySessionId ? (persist ? 'persist:' : '') + name : '';
    const s = electron.session.fromPartition(partition);
    if (s.protocol.isProtocolHandled('file')) {
        console.warn("Replacing builtin file:// handler for:", name, s);
        s.protocol.unhandle('file');
    }
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
    // NOTE: Always use path.posix here...
    const url = urlMod.parse(request.url);
    let pathname = url.pathname;
    let rootPath = appPath;
    if (pathname === '/sauce:dummy') {
        return new Response('');
    }
    // This allows files to be loaded like watching.___id-here___.html which ensures
    // some settings like zoom factor are unique to each window (they don't conform to origin
    // based sandboxing).
    const pInfo = path.posix.parse(pathname);
    const idMatch = pInfo.name.match(/\.___.+___$/);
    if (idMatch) {
        pInfo.name = pInfo.name.substr(0, idMatch.index);
        pInfo.base = undefined;
        pathname = path.posix.format(pInfo);
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
            return mod.zip.entryData(path.posix.join(mod.zipRootDir, pathname)).then(data => {
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
    return elFetch(`file://${path.posix.join(rootPath, pathname)}`, {bypassCustomProtocolHandlers: true});
}
electron.protocol.handle('file', onHandleFileProtocol);


function canToggleVisibility(win) {
    const manifest = widgetWindowManifestsByType.get(win.spec && win.spec.type);
    if (!manifest) {
        return false;
    }
    return manifest.alwaysVisible == null ? win.spec.overlay !== false : !manifest.alwaysVisible;
}


function hideAllWindows() {
    lastShowHideState = 'hidden';
    for (const win of SauceBrowserWindow.getAllWindows()) {
        if (canToggleVisibility(win)) {
            if (!win.isMinimized()) {  // Workaround for electron/electron#41063
                win.hide();
            }
        }
    }
    if (isMac && main.sauceApp.getSetting('emulateFullscreenZwift')) {
        deactivateFullscreenZwiftEmulation();
    }
}
rpc.register(hideAllWindows);


function showAllWindows() {
    lastShowHideState = 'visible';
    for (const win of SauceBrowserWindow.getAllWindows()) {
        if (canToggleVisibility(win)) {
            win.showInactive();
        }
    }
    if (isMac && main.sauceApp.getSetting('emulateFullscreenZwift')) {
        activateFullscreenZwiftEmulation();
    }
}
rpc.register(showAllWindows);


function lerp(v0, v1, t) {
    return (1 - t) * v0 + t * v1;
}


async function macSetZoomAnimated(mwc, {scale, center, displayId, duration=300, fps=60}) {
    const start = performance.now();
    const origin = mwc.getZoom({point: center, displayId});
    let t = 1 / fps * 1000 / duration;
    center = center || origin.center;
    do {
        const s = lerp(origin.scale, scale, t);
        const x = lerp(origin.center[0], center[0], t);
        const y = lerp(origin.center[1], center[1], t);
        mwc.setZoom({scale: s, center: [x, y], displayId});
        await sleep(1000 / fps - 2);
        t = (performance.now() - start) / duration;
    } while (t < 1);
    mwc.setZoom({scale, center, displayId});
}


function displayOverlap(a, b) {
    const hOverlap = Math.max(0, Math.min(a.position[0] + a.size[0], b.position[0] + b.size[0]) -
                                 Math.max(a.position[0], b.position[0]));
    const vOverlap = Math.max(0, Math.min(a.position[1] + a.size[1], b.position[1] + b.size[1]) -
                                 Math.max(a.position[1], b.position[1]));
    return hOverlap * vOverlap;
}


let _fszEmulationAbort;
let _fszEmulationTask;
let _fszUsedOnce;
export async function activateFullscreenZwiftEmulation() {
    if (_fszEmulationAbort) {
        _fszEmulationAbort.abort();
        await _fszEmulationTask;
    }
    console.info("Fullscreen zwift emulation activated.");
    const abortCtrl = _fszEmulationAbort = new AbortController();
    const aborted = new Promise((_, reject) => {
        abortCtrl.signal.addEventListener('abort', () => {
            if (abortCtrl === _fszEmulationAbort) {
                _fszEmulationAbort = null;
            }
            reject(abortCtrl.signal.reason);
        }, {once: true});
    });
    aborted.catch(e => void 0);  // silence unhandled warn
    const mwc = await import('macos-window-control');
    const {fork} = await import('node:child_process');
    if (!_fszUsedOnce) {
        _fszUsedOnce = true;
        fork('./src/unzoom.mjs', [process.pid], {detached: true}).unref();
    }
    _fszEmulationTask = (async () => {
        let curPid, curDisplaySig;
        for (let i = 0; !abortCtrl.signal.aborted; i++) {
            if (i) {
                await Promise.race([sleep(Math.min(5000, 500 * (1.05 ** i))), aborted]);
            }
            if (!mwc.hasAccessibilityPermission({prompt: true})) {
                console.warn("Accessibility permissions required for fullscreen emulation: waiting...");
                while (!mwc.hasAccessibilityPermission()) {
                    await Promise.race([sleep(200), aborted]);
                }
                console.info("Accessibility permissions granted");
            }
            const zwiftApp = (await mwc.getApps()).find(x => x.name.match(/^ZwiftApp(Silicon)?$/));
            //const zwiftApp = (await mwc.getApps()).find(x => x.name.match(/^Maps?$/));  // TESTING
            if (!zwiftApp) {
                if (curPid === undefined) {
                    console.debug("Zwift not running...");
                    curPid = null;
                } else if (curPid != null) {
                    i = 1;
                    curPid = null;
                    await Promise.all(mwc.getDisplays().map(x =>
                        macSetZoomAnimated(mwc, {scale: 1, displayId: x.id})));
                }
                continue;
            }
            const displays = mwc.getDisplays();
            const dSig = JSON.stringify(displays);
            if (curPid !== zwiftApp.pid || curDisplaySig !== dSig) {
                let win;
                try {
                    const wins = await mwc.getWindows({app: {pid: zwiftApp.pid}});
                    if (!wins.length) {
                        continue;  // common on startup
                    }
                    win = wins[0];
                    if (!win.titlebarHeightEstimate) {
                        // window loading still, retry...
                        continue;
                    }
                } catch(e) {
                    if (e instanceof mwc.NotFoundError) {
                        continue;  // unlikely race, but possible
                    } else {
                        throw e;
                    }
                }
                curPid = zwiftApp.pid;
                curDisplaySig = dSig;
                i = 1;
                displays.sort((a, b) => displayOverlap(b, win) - displayOverlap(a, win));
                const sSize = displays[0].size;
                const menuHeight = sSize[1] - displays[0].visibleSize[1];
                const scale = sSize[1] / (sSize[1] - menuHeight - win.titlebarHeightEstimate);
                const size = [sSize[0] / scale, sSize[1] - menuHeight];
                const position = displays[0].visiblePosition;
                mwc.setWindowSize({app: {pid: zwiftApp.pid}, size, position});
                const center = [position[0], position[1] + displays[0].visibleSize[1] - 1];
                await macSetZoomAnimated(mwc, {scale, center, displayId: displays[0].id});
            }
        }
    })().catch(e => {
        if (e.name !== 'AbortError') {
            console.error("Unexpected error in emulate fullscreen zwift loop: Disabling feature...");
            main.sauceApp.setSetting('emulateFullscreenZwift', false);
            for (const x of mwc.getDisplays()) {
                mwc.setZoom({scale: 1, displayId: x.id});
            }
            throw e;
        }
    });
}


export async function deactivateFullscreenZwiftEmulation() {
    if (_fszEmulationAbort) {
        _fszEmulationAbort.abort();
        await _fszEmulationTask;
    }
    const mwc = await import('macos-window-control');
    await Promise.all(mwc.getDisplays().map(x =>
        macSetZoomAnimated(mwc, {scale: 1, displayId: x.id})));
}


if (isMac) {
    rpc.register(activateFullscreenZwiftEmulation);
    rpc.register(deactivateFullscreenZwiftEmulation);
}


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
    updateProfileSwitchingHotkeys();
}


let _profileHotkeyCount = 0;
function updateProfileSwitchingHotkeys() {
    for (let i = 0; i < _profileHotkeyCount; i++) {
        hotkeys.unregisterAction(`profile-switch-${i}`);
    }
    _profileHotkeyCount = profiles.length;
    for (const [i, x] of profiles.entries()) {
        const nameShort = x.name.length < 12 ? x.name : `${x.name.substr(0, 11)}...`;
        const id = x.id;
        hotkeys.registerAction({
            id: `profile-switch-${i}`,
            name: `Switch to Profile ${i+1} (${nameShort})`,
            callback: () => activateProfile(id)
        });
    }
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
    updateProfileSwitchingHotkeys();
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
    updateProfileSwitchingHotkeys();
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
    updateProfileSwitchingHotkeys();
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
    }, 400);
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
    updateProfileSwitchingHotkeys();
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


let _isSafeToGetCursorPosition;
export function getCurrentDisplay() {
    if (_isSafeToGetCursorPosition === undefined) {
        // See: https://github.com/electron/electron/issues/41559
        _isSafeToGetCursorPosition = os.platform() !== 'linux' ||
            electron.app.commandLine.getSwitchValue('ozone-platform') !== 'wayland';
    }
    let display;
    if (_isSafeToGetCursorPosition) {
        const point = electron.screen.getCursorScreenPoint();
        display = electron.screen.getDisplayNearestPoint(point);
    }
    return display || electron.screen.getPrimaryDisplay();
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
        // Window frame prio: url query -> is external page -> win-spec options -> copy parent
        const frame = q.has('frame') ?
            !['false', '0', 'no', 'off'].includes(q.get('frame').toLowerCase()) :
            !isInternalScheme(url) || (newWinSpec ? !!newWinSpec.options?.frame : parent.frame);
        const newWin = new SauceBrowserWindow({
            subWindow: true,
            spec: newWinSpec,
            frame,
            show: false,
            transparent: frame === false,
            hasShadow: frame !== false,
            roundedCorners: frame !== false,
            parent: isChildWindow ? parent : undefined,
            bounds,
            webPreferences: {
                preload: path.join(appPath, 'src/preload/common.js'),
                ...webPrefs,
                sandbox: true,  // Do not permit override.
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
        newWin.setMenuBarVisibility(false); // XXX can we just set `menuBarVisible: false`?
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
        console.warn("Resetting window that is out of bounds:", bounds);
    }
    if (!inBounds || !bounds) {
        bounds = getBoundsForDisplay(getCurrentDisplay(), {...manifest.options, ...spec.options});
    }
    // Order of options is crucial...
    const options = {
        ...(spec.overlay !== false ? overlayOptions : {}),
        ...manifest.options,
        ...spec.options,
    };
    const frame = !!options.frame;
    const win = new SauceBrowserWindow({
        ...options,
        bounds,
        spec,
        show: false,
        frame,
        transparent: frame === false,
        hasShadow: frame !== false,
        roundedCorners: frame !== false,
        webPreferences: {
            ...manifest.webPreferences,
            sandbox: true,  // Do not permit override
            preload: path.join(appPath, 'src/preload/common.js'),
            session: activeProfileSession,
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
    win.setMenuBarVisibility(false); // XXX can we just set `menuBarVisible: false`?
    if (spec.overlay !== false) {
        win.setAlwaysOnTop(true, 'pop-up-menu');
    }
    const createdTS = performance.now();
    handleNewSubWindow(win, spec, {session: activeProfileSession});
    let boundsSaveTimeout;
    const onBoundsUpdate = ev => {
        // Mitigation for windows drift issues when scaling != 100%
        if (isWindows && !boundsSaveTimeout && performance.now() - createdTS < 500) {
            const {width, height, x, y} = win.getBounds();
            if (Math.abs(width - bounds.width) < 3 &&
                Math.abs(height - bounds.height) < 3 &&
                Math.abs(x - bounds.x) < 3 &&
                Math.abs(y - bounds.y) < 3) {
                console.warn("Dropping spurious window movement:", id);
                return;
            }
        }
        clearTimeout(boundsSaveTimeout);
        boundsSaveTimeout = setTimeout(() => {
            if (win.isDestroyed()) {
                return;
            }
            const bounds = win.getBounds();
            console.debug(`Saving window placement [${id}]: ${bounds.width}x${bounds.height} at ` +
                          `${bounds.x},${bounds.y}`);
            updateWidgetWindowSpec(id, {bounds});
        }, 200);
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


export function openWidgetWindows() {
    const controller = new EventEmitter();
    const loading = [];
    for (const spec of getWidgetWindowSpecs().reverse()) {
        const manifest = widgetWindowManifestsByType.get(spec.type);
        if (manifest && (manifest.alwaysVisible || !spec.closed)) {
            try {
                loading.push(_openSpecWindow(spec));
            } catch(e) {
                console.error("Failed to open window", spec.id, e);
            }
        }
    }
    let loaded = 0;
    const size = loading.length;
    for (const x of loading) {
        x.webContents.once('did-finish-load', () => {
            loaded++;
            controller.emit('progress', loaded / size, loaded, size);
        });
    }
    loading.length = 0;
    return controller;
}


export function makeCaptiveWindow(options={}, webPrefs={}) {
    const display = getCurrentDisplay();
    const bounds = getBoundsForDisplay(display, options);
    const session = webPrefs.session || activeProfileSession;
    const win = new SauceBrowserWindow({
        show: false,
        maximizable: false,
        fullscreenable: false,
        ...options,
        bounds,
        webPreferences: {
            preload: path.join(appPath, 'src/preload/common.js'),  // CAUTION: can be overridden
            ...webPrefs,
            sandbox: true,  // Do not permit override
            session,
        },
    });
    win.setMenuBarVisibility(false); // XXX can we just set `menuBarVisible: false`?
    if (!options.disableNewWindowHandler) {
        handleNewSubWindow(win, null, {...webPrefs, session});
    }
    if (options.file) {
        const query = options.query;
        win.loadFile(options.file, {query});
    }
    if (options.show !== false) {
        win.show();
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


export function dialog(options) {
    const modal = options.modal ?? !!options.parent;
    const width = options.width || 400;
    const height = options.height || 340;
    const win = makeCaptiveWindow({
        file: '/pages/dialog.html',
        width,
        height,
        show: false,
        frame: false,
        transparent: true,
        minimizable: false,
        maximizable: false,
        modal,
        parent: options.parent,
        spec: {options: {...options, parent: undefined}},
    }, {
        devTools: !electron.app.isPackaged,
        preload: path.join(appPath, 'src/preload/dialog.js'),
    });
    let closed;
    const controller = new Promise(resolve => {
        win.on('closed', () => {
            closed = true;
            resolve(false);
        });
        win.webContents.ipc.handle('confirm-dialog-response', (ev, confirmed) => resolve(confirmed));
    });
    const setContent = (key, value) => {
        if (!closed && !win.isDestroyed()) {
            win.webContents.send('set-content', key, value);
        }
    };
    controller.browserWindow = win;
    controller.setTitle = x => setContent('title', x);
    controller.setMessage = x => setContent('message', x);
    controller.setDetail = x => setContent('detail', x);
    controller.setFooter = x => setContent('footer', x);
    controller.close = () => {
        if (!closed && !win.isDestroyed()) {
            win.close();
        }
    };
    controller.hide = () => {
        if (!closed && !win.isDestroyed()) {
            win.hide();
        }
    };
    controller.show = () => {
        if (!closed && !win.isDestroyed()) {
            win.show();
        }
    };
    controller.finally(() => {
        if (!closed && !win.isDestroyed()) {
            win.close();
        }
    });
    const affectedBySizeBug = modal && isMac;  // Mac sizes incorrect; 28px too small
    if (options.show !== false) {
        controller.visible = new Promise(resolve => {
            win.once('ready-to-show', () => {
                if (!closed && !win.isDestroyed()) {
                    win.show();
                    if (affectedBySizeBug) {
                        win.setSize(width, height);
                    }
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
        });
    } else if (affectedBySizeBug) {
        console.warn("Dialog is going to be too small because of mac modal bug");
    }
    return controller;
}


export function confirmDialog(options) {
    return dialog({confirm: true, ...options});
}


export async function welcomeSplash() {
    const welcomeWin = new SauceBrowserWindow({
        type: isLinux ? 'splash' : undefined,
        bounds: getCurrentDisplay().bounds,
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


export async function patronLink({sauceApp, forceCheck, requireLegacy}) {
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
        metaFlags: {requireLegacy},
    }, {
        devTools: false,
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
    const bounds = {
        x: oBounds.x,
        y: (oBounds.y - dBounds.y < dBounds.height / 2) ?
            oBounds.y + oBounds.height :
            oBounds.y - height,
        width: oBounds.width,
        height
    };
    const sysWin = new SauceBrowserWindow({
        type: isLinux ? 'splash' : undefined,
        bounds,
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
        },
    });
    sysWin.removeMenu();
    sysWin.excludedFromShownWindowsMenu = true;
    sysWin.setAlwaysOnTop(true, 'screen-saver');
    sysWin.setIgnoreMouseEvents(true);
    sysWin.loadFile('/pages/system-message.html');
    sysWin.show();
}


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
            win.center(); // buggy, causes window resize.
            win.setSize(Math.round(width), Math.round(height));
        }
    }
});

rpc.register(function getWindowInfoForPID(pid) {
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
});

rpc.register(function focusOwnWindow() {
    const wc = this;
    if (!wc) {
        throw new TypeError('electron-only rpc function');
    }
    const win = wc.getOwnerBrowserWindow();
    if (isMac) {
        electron.app.focus({steal: true});
    }
    win.focus();
});

hotkeys.registerAction({
    id: 'show-hide-overlay-windows',
    name: 'Show/Hide Overlay Windows',
    callback: () => {
        if (lastShowHideState === 'hidden') {
            showAllWindows();
        } else {
            hideAllWindows();
        }
    }
});

electron.ipcMain.on('getWindowMetaSync', ev => {
    const internalScheme = isInternalScheme(ev.sender.getURL());
    const meta = {
        context: {
            id: null,
            type: null,
            platform,
        },
    };
    try {
        const win = ev.sender.getOwnerBrowserWindow();
        meta.context.frame = win.frame;
        if (internalScheme && win.spec) {
            meta.internal = true;
            meta.modContentScripts = modContentScripts;
            meta.modContentStylesheets = modContentStylesheets;
            Object.assign(meta.context, {
                id: win.spec.id,
                type: win.spec.type,
                spec: win.spec,
                manifest: widgetWindowManifestsByType.get(win.spec.type),
            });
        } else {
            meta.internal = false;
        }
        if (win.metaFlags) {
            meta.flags = win.metaFlags;
        }
    } finally {
        // CAUTION: ev.returnValue is highly magical.  It MUST be set to avoid hanging
        // the page load and it can only be set once the value is frozen because it will
        // copy/serialize the contents when assigned.
        ev.returnValue = meta;
    }
});

electron.app.on('window-all-closed', () => {
    if (main.started && !main.quiting && !swappingProfiles) {
        electron.app.quit();
    }
});
