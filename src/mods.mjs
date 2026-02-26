import Process from 'node:process';
import Path from 'node:path';
import FS from './fs-safe.js';
import Crypto from 'node:crypto';
import StreamZip from 'node-stream-zip';
import * as RPC from './rpc.mjs';
import * as Storage from './storage.mjs';
import * as Core from './mods-core.mjs';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';

const require = createRequire(import.meta.url);
const Package = require('../package.json');

const settingsKey = 'mod-settings';
const installedKey = 'mod-installed';
let modsSettings;
let modsInstalled;
let upstreamDirectory;
let unpackedModRoot;
let packedModRoot;
const availableMods = [];
const modsById = new Map();

export const eventEmitter = new EventEmitter();
export const contentScripts = [];
export const contentCSS = [];

Core.extraSafePathValidators.push((x, _, modPath) => {
    return !modPath || FS.realpathSync(Path.join(modPath, x)).startsWith(modPath);
});


// Stable output for safe integration with mods.sauce.llc
function getAvailableModsV1() {
    return availableMods.map(x => ({
        id: x.id,
        manifest: x.manifest,
        packed: !!x.packed,
        restartRequired: x.restartRequired,
        status: x.status,
        isNew: !!x.isNew,
        enabled: !!(modsSettings.get(x.id)?.enabled),
        path: !x.packed ? x.path : undefined,
    }));
}
RPC.register(getAvailableModsV1); // For stable use outside sauce, i.e. mods.sauce.llc
RPC.register(getAvailableModsV1, {name: 'getAvailableMods'});

export const getAvailableMods = getAvailableModsV1;
export const getEnabledMods = () => getAvailableMods().filter(x => x.enabled);
export const getMod = modsById.get.bind(modsById);


function getOrInitModSettings(id) {
    let settings = modsSettings.get(id);
    if (!settings) {
        settings = {};
        modsSettings.set(id, settings);
    }
    return settings;
}


function saveModsSettings() {
    Storage.set(settingsKey, Object.fromEntries(modsSettings.entries()));
}


function saveModsInstalled() {
    Storage.set(installedKey, Object.fromEntries(modsInstalled.entries()));
}


export function setEnabled(id, enabled) {
    const mod = modsById.get(id);
    if (!mod) {
        throw new Error('ID not found');
    }
    getOrInitModSettings(id).enabled = enabled;
    saveModsSettings();
    if (mod.initialized && enabled) {
        mod.restartRequired = false;
        mod.status = 'active';
    } else if (!mod.initialized && !enabled) {
        mod.restartRequired = false;
        mod.status = undefined;
    } else {
        mod.restartRequired = true;
        mod.status = enabled ? 'enabling' : 'disabling';
    }
    eventEmitter.emit('enabled-mod', enabled, mod);
    eventEmitter.emit('available-mods-changed', mod, availableMods);
}
RPC.register(setEnabled, {name: 'setModEnabled'});


export async function initialize(unpackedDir, packedDir) {
    modsSettings = new Map(Object.entries(Storage.get(settingsKey) || {}));
    modsInstalled = new Map(Object.entries(Storage.get(installedKey) || {}));
    availableMods.length = 0;
    modsById.clear();
    let candidateMods;
    try {
        candidateMods = _initUnpacked(unpackedDir);
        eventEmitter.emit('initializing', candidateMods
            .map(x => ({unpacked: true, id: x.id}))
            .concat(Array.from(modsInstalled.keys())
                .map(id => ({id}))));
        candidateMods = candidateMods.concat(await _initPacked(packedDir));
    } catch(e) {
        console.error("Mods init error:", e);
        return [];
    }
    for (const mod of candidateMods) {
        const settings = getOrInitModSettings(mod.id);
        const label = `${mod.manifest.name} (${mod.id})`;
        const tags = [];
        if (!settings.enabled) {
            tags.push('DISABLED');
        }
        if (!mod.packed) {
            tags.push('UNPACKED');
        }
        console.info(`Detected Mod: ${label} ${tags.length ? `[${tags.join(', ')}]` : ''}`);
        if (mod.isNew || settings.enabled) {
            let warnings;
            try {
                ({warnings} = Core.validateMod(mod));
            } catch(e) {
                if (e instanceof Core.ValidationError) {
                    const path = e.key ? e.path.concat(e.key) : e.path;
                    console.error(`Mod validation error [${label}]: path: "${path.join('.')}", ` +
                        `error: ${e.message}`);
                } else {
                    console.error(`Mod error [${label}]:`, e);
                }
                continue;
            }
            for (const x of warnings) {
                console.warn(`Mod issue [${label}]:`, x);
            }
        }
        availableMods.push(mod);
        modsById.set(mod.id, mod);
        if (!settings.enabled) {
            continue;
        }
        if (mod.manifest.content_js) {
            for (const file of mod.manifest.content_js) {
                try {
                    contentScripts.push(await getModFile(mod, file, 'utf8'));
                } catch(e) {
                    console.error("Failed to load content script:", mod, e);
                }
            }
        }
        if (mod.manifest.content_css) {
            for (const file of mod.manifest.content_css) {
                try {
                    contentCSS.push(await getModFile(mod, file, 'utf8'));
                } catch(e) {
                    console.error("Failed to load content style:", mod, e);
                }
            }
        }
        mod.status = 'active';
        mod.initialized = true;
    }
    return availableMods;
}


async function getModFile(mod, file, encoding) {
    if (mod.zip) {
        const data = await mod.zip.entryData(Path.posix.join(mod.zipRootDir, file));
        return encoding ? data.toString(encoding) : data;
    } else {
        return FS.readFileSync(Path.join(mod.modPath, file), encoding);
    }
}


function _initUnpacked(root) {
    try {
        FS.mkdirSync(root, {recursive: true});
        unpackedModRoot = FS.realpathSync(root);
    } catch(e) {
        console.warn('Unpacked Mods folder uncreatable:', root, e);
        unpackedModRoot = null;
    }
    if (!unpackedModRoot || !FS.existsSync(unpackedModRoot) || !FS.statSync(unpackedModRoot).isDirectory()) {
        return [];
    }
    const publicRootParts = unpackedModRoot.split(Path.sep).slice(-2);
    const mods = [];
    for (const x of FS.readdirSync(unpackedModRoot)) {
        const modPath = FS.realpathSync(Path.join(unpackedModRoot, x));
        const f = FS.statSync(modPath);
        if (f.isDirectory()) {
            const manifestPath = Path.join(modPath, 'manifest.json');
            if (!FS.existsSync(manifestPath)) {
                console.warn("Ignoring mod directory without manifest.json:", x);
                continue;
            }
            try {
                const manifest = JSON.parse(FS.readFileSync(manifestPath));
                const id = manifest.id || Core.sanitizeID(x);
                const isNew = !modsSettings.has(id);
                const legacyId = (isNew && !manifest.id && modsSettings.has(x)) ? x : undefined;
                if (legacyId) {
                    console.warn(`Mod may have lost settings from legacy ID: ${legacyId} vs ${id}`);
                }
                mods.push({
                    manifest,
                    isNew,
                    id,
                    legacyId,
                    modPath,
                    packed: false,
                    path: Path.join(...publicRootParts, x)
                });
            } catch(e) {
                console.error('Invalid manifest.json for:', x, e);
            }
        } else if (!['.DS_Store'].includes(x)) {
            console.warn("Ignoring non-directory in mod path:", x);
        }
    }
    return mods;
}


async function getUpstreamDirectory() {
    if (!upstreamDirectory) {
        const url = Process.env.MOD_DIRECTORY_URL || 'https://mods.sauce.llc/directory.json';
        upstreamDirectory = await (await fetch(url)).json();
    }
    return upstreamDirectory;
}


async function _initPacked(root) {
    try {
        FS.mkdirSync(root, {recursive: true});
        packedModRoot = root;
    } catch(e) {
        console.error('Mods folder uncreatable:', root, e);
        packedModRoot = null;
    }
    if (!packedModRoot) {
        return [];
    }
    const mods = [];
    for (const [id, entry] of modsInstalled.entries()) {
        let mod;
        let zipFile;
        try {
            zipFile = Path.join(packedModRoot, entry.file);
            mod = await _openPackedMod(zipFile, id);
        } catch(e) {
            console.error('Invalid Mod:', id, entry.file, e);
            continue;
        }
        if (getOrInitModSettings(id).enabled) {
            try {
                const latestRelease = await getLatestPackedModRelease(id);
                if (latestRelease && latestRelease.hash !== mod.hash) {
                    console.warn('Updating packed Mod:', mod.manifest.name, '->', latestRelease.version);
                    eventEmitter.emit('updating-mod', {mod, latestRelease});
                    const oldZip = mod.zip;
                    mod = await installPackedModRelease(id, latestRelease);
                    oldZip.close();
                    FS.rmSync(zipFile);
                }
            } catch(e) {
                console.error("Failed to check/update Mod:", e);
            }
        }
        mods.push(mod);
    }
    return mods;
}


function packedModHash({file, data}) {
    const sha256 = Crypto.createHash('sha256');
    if (file) {
        data = FS.readFileSync(file);
    }
    return sha256.update(data).digest('hex');
}


async function _openPackedMod(file, id) {
    const zip = new StreamZip.async({file});
    let zipRootDir;
    for (const zEntry of Object.values(await zip.entries())) {
        if (!zEntry.isDirectory) {
            const p = Path.parse(zEntry.name);
            if (p.base === 'manifest.json') {
                if (p.dir.split(Path.sep).length > 1) {
                    console.warn("Ignoring over nested manifest.json file:", zEntry.name);
                    continue;
                }
                zipRootDir = p.dir;
                break;
            }
        }
    }
    if (zipRootDir === undefined) {
        throw new Error("manifest.json not found");
    }
    const manifest = JSON.parse(await zip.entryData(`${zipRootDir}/manifest.json`));
    if (id && manifest.id && manifest.id !== id) {
        console.debug(`Ignoring manifest based ID for packed Mod ${id}:`, manifest.id);
    }
    delete manifest.id;
    const hash = packedModHash({file});
    return {id, manifest, zipRootDir, zip, hash, packed: true};
}


// Might deprecate this when unpacked becomes a dev-only feature.
function showModsRootFolder() {
    let electron;
    try {
        electron = require('electron');
    } catch(e) {/*no-pragma*/}
    if (electron && electron.shell) {
        electron.shell.openPath(unpackedModRoot);
    } else {
        console.info(unpackedModRoot);
    }
    return unpackedModRoot;
}
RPC.register(showModsRootFolder);


export function getWindowManifests() {
    const winManifests = [];
    for (const {manifest, id} of availableMods) {
        if (!modsSettings.get(id)?.enabled || !manifest.windows) {
            continue;
        }
        for (const x of manifest.windows) {
            const bounds = x.default_bounds || {};
            try {
                winManifests.push({
                    type: `${id}-${x.id}`,
                    file: `/mods/${id}/${x.file}`,
                    mod: true,
                    modId: id,
                    query: x.query,
                    groupTitle: `[MOD]: ${manifest.name}`,
                    prettyName: x.name,
                    prettyDesc: x.description,
                    options: {
                        width: bounds.width,
                        height: bounds.height,
                        x: bounds.x,
                        y: bounds.y,
                        aspectRatio: bounds.aspect_ratio,
                        frame: x.frame,
                    },
                    overlay: x.overlay,
                });
            } catch(e) {
                console.error("Failed to create window manifest for mod:", id, x.id, e);
            }
        }
    }
    return winManifests;
}


// Used by release tool on mods.sauce.llc (probably deprecate if we move this code there)
export async function validatePackedMod(zipUrl) {
    const resp = await fetch(zipUrl);
    if (!resp.ok) {
        throw new Error("Mod fetch error: " + resp.status);
    }
    const data = Buffer.from(await resp.arrayBuffer());
    const tmpFile = Path.join(packedModRoot, `tmp-${Crypto.randomUUID()}.zip`);
    FS.writeFileSync(tmpFile, data);
    try {
        const mod = await _openPackedMod(tmpFile, null);
        mod.zip.close();
        const {warnings} = Core.validateMod(mod);
        return {manifest: mod.manifest, hash: mod.has, warnings, size: data.byteLength};
    } finally {
        FS.rmSync(tmpFile);
    }
}
RPC.register(validatePackedMod);


async function installPackedModRelease(id, release) {
    const data = await fetchPackedModRelease(release);
    const file = `${Crypto.randomUUID()}.zip`;
    FS.writeFileSync(Path.join(packedModRoot, file), data);
    const mod = await _openPackedMod(Path.join(packedModRoot, file), id);
    Core.validateMod(mod);
    if (!modsInstalled.has(id)) {
        modsInstalled.set(id, {});
    }
    Object.assign(modsInstalled.get(id), {
        hash: release.hash,
        file,
        size: data.byteLength
    });
    saveModsInstalled();
    queueMicrotask(() => fetch(`https://mod-rank.sauce.llc/edit/${id}/installs`, {method: 'POST'}));
    return mod;
}


export async function installPackedMod(id) {
    console.warn("Installing Mod:", id);
    const dir = await getUpstreamDirectory();
    const dirEntry = dir.find(x => x.id === id);
    if (!dirEntry) {
        throw new Error("ID not found: " + id);
    }
    const release = packedModBestRelease(dirEntry.releases);
    if (!release) {
        throw new TypeError("No compatible mod release found");
    }
    const mod = await installPackedModRelease(id, release);
    mod.restartRequired = true;
    mod.status = 'installing';
    getOrInitModSettings(id).enabled = true;
    saveModsSettings();
    const existing = availableMods.find(x => x.id === id);
    if (existing) {
        Object.assign(existing, mod);
    } else {
        availableMods.push(mod);
        modsById.set(id, mod);
    }
    eventEmitter.emit('installed-mod', mod);
    eventEmitter.emit('available-mods-changed', mod, availableMods);
}
RPC.register(installPackedMod);


export function removePackedMod(id) {
    console.warn("Removing Mod:", id);
    const installed = modsInstalled.get(id);
    if (!installed) {
        throw new Error("Mod not found: " + id);
    }
    modsInstalled.delete(id);
    saveModsInstalled();
    modsSettings.delete(id);
    saveModsSettings();
    const mod = modsById.get(id);
    mod.restartRequired = true;
    mod.status = 'removing';
    FS.rmSync(Path.join(packedModRoot, installed.file));
    eventEmitter.emit('removed-mod', mod);
    eventEmitter.emit('available-mods-changed', mod, availableMods);
}
RPC.register(removePackedMod);



async function fetchPackedModRelease(release) {
    const resp = await fetch(release.url);
    if (!resp.ok) {
        throw new Error("Mod install fetch error: " + resp.status);
    }
    const data = Buffer.from(await resp.arrayBuffer());
    const hash = packedModHash({data});
    if (hash !== release.hash) {
        throw new Error("Mod file hash does not match upstream directory hash");
    }
    return data;
}


async function getLatestPackedModRelease(id) {
    const dir = await getUpstreamDirectory();
    const dirEntry = dir.find(x => x.id === id);
    if (!dirEntry) {
        throw new Error("Upstream Mod ID not found: " + id);
    }
    const release = packedModBestRelease(dirEntry.releases);
    if (!release) {
        console.error('No compatible upstream release found for:', id);
        return;
    }
    return release;
}


function packedModBestRelease(releases) {
    return releases
        .sort((a, b) => Core.semverOrder(b.version, a.version))
        .filter(x => Core.semverOrder(Package.version, x.minVersion) >= 0)[0];
}
