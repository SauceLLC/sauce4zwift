/* global Buffer */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import StreamZip from 'node-stream-zip';
import * as rpc from './rpc.mjs';
import * as storage from './storage.mjs';
import fetch from 'node-fetch';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

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


export class ValidationError extends TypeError {
    constructor(path, key, message) {
        super(message);
        this.path = path;
        this.key = key;
    }
}


// Stable output for safe integration with mods.sauce.llc
function getAvailableModsV1() {
    return availableMods.map(x => ({
        id: x.id,
        manifest: x.manifest,
        packed: !!x.packed,
        restartRequired: x.restartRequired,
        status: x.status,
        isNew: !!x.isNew,
        enabled: !!modsSettings[x.id]?.enabled,
    }));
}
rpc.register(getAvailableModsV1); // For stable use outside sauce, i.e. mods.sauce.llc
rpc.register(getAvailableModsV1, {name: 'getAvailableMods'});

export const getAvailableMods = getAvailableModsV1;
export const getEnabledMods = () => getAvailableMods().filter(x => x.enabled);
export const getMod = modsById.get.bind(modsById);


function fsRemoveFile(path) {
    // retries requried for windows.
    return fs.rmSync(path, {maxRetries: 5});
}




export function setEnabled(id, enabled) {
    const mod = modsById.get(id);
    if (!mod) {
        throw new Error('ID not found');
    }
    if (!modsSettings[id]) {
        modsSettings[id] = {};
    }
    modsSettings[id].enabled = enabled;
    storage.set(settingsKey, modsSettings);
    mod.restartRequired = true;
    mod.status = enabled ? 'enabling' : 'disabling';
    eventEmitter.emit('enabled-mod', enabled, mod);
    eventEmitter.emit('available-mods-changed', mod, availableMods);
}
rpc.register(setEnabled, {name: 'setModEnabled'});


function isSafePath(x, _, modPath) {
    return !!x.match(/^[a-z0-9]+[a-z0-9_\-./]*$/i) && !x.match(/\.\./) &&
        (!modPath || fs.realpathSync(path.join(modPath, x)).startsWith(modPath));
}


function isSafeID(x) {
    return !!x.match(/^[a-z0-9-_]+$/i);
}


function sanitizeID(x) {
    return x.replace(/[^a-z0-9-]/ig, '-');
}


const manifestSchema = {
    manifest_version: {type: 'number', required: true, desc: 'Manifest version', valid: x => x === 1},
    id: {type: 'string', desc: 'Optional ID for this mod, defaults to the directory name', valid: isSafeID},
    name: {type: 'string', required: true, desc: 'Pretty name of the mod'},
    description: {type: 'string', required: true, desc: 'Description of the mod'},
    version: {type: 'string', required: true, desc: 'MOD version, i.e. 1.2.3'},
    author: {type: 'string', desc: 'Author name or company'},
    website_url: {type: 'string', desc: 'External URL related to the mod'},
    web_root: {type: 'string', desc: 'Sub directory containing web assets.', valid: isSafePath},
    content_js: {type: 'string', isArray: true, desc: 'Scripts to execute in all windows', valid: isSafePath},
    content_css: {type: 'string', isArray: true, desc: 'CSS to load in all windows', valid: isSafePath},
    windows: {
        type: 'object',
        isArray: true,
        schema: {
            file: {type: 'string', required: true, unique: true, desc: 'Path to web page html file',
                   valid: isSafePath},
            query: {
                type: 'object',
                desc: 'Query argument key/value pairs, i.e. {"foo": "bar"} => ?foo=bar',
                schema: {
                    "*": {type: 'string', desc: "Value of query argument"},
                }
            },
            id: {type: 'string', required: true, unique: true, desc: 'Unique identifier for this window'},
            name: {type: 'string', required: true, unique: true, desc: 'Name to show in listings'},
            description: {type: 'string', desc: 'Extra optional info about the window'},
            always_visible: {type: 'boolean', desc: 'DEPRECATED', deprecated: true},
            overlay: {type: 'boolean', desc: 'Set to make window stay on top of normal windows'},
            frame: {type: 'boolean', desc: 'Includes OS frame borders and title bar'},
            default_bounds: {
                type: 'object',
                desc: 'Default placement and size of the mod window',
                schema: {
                    width: {type: 'number', desc: '0.0 -> 1.0 represent relative size based on screen, ' +
                        'otherwise value is pixels', valid: x => x >= 0},
                    height: {type: 'number', desc: '0.0 -> 1.0 represent relative size based on screen, ' +
                        'otherwise value is pixels', valid: x => x >= 0},
                    x: {type: 'number', desc: '0.0 -> 1.0 represent relative offset based on screen, ' +
                        'negative values represent offset from the right edge of the screen'},
                    y: {type: 'number', desc: '0.0 -> 1.0 represent relative offset based on screen, ' +
                        'negative values represent offset from the bottom edge of the screen'},
                    aspect_ratio: {type: 'boolean', desc: 'Used when only width xor height are set',
                                   valid: x => x > 0}
                },
            },
        },
    },
};


export async function init(unpackedDir, packedDir) {
    modsSettings = storage.get(settingsKey) || {};
    modsInstalled = storage.get(installedKey) || {};
    availableMods.length = 0;
    modsById.clear();
    try {
        availableMods.push(..._initUnpacked(unpackedDir));
        availableMods.push(...await _initPacked(packedDir));
    } catch(e) {
        console.error("MODS init error:", e);
    }
    for (const mod of availableMods) {
        modsById.set(mod.id, mod);
        if (!modsSettings[mod.id]?.enabled) {
            continue;
        }
        mod.status = 'active';
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

    }
    return availableMods;
}


async function getModFile(mod, file, encoding) {
    if (mod.zip) {
        const data = await mod.zip.entryData(path.join(mod.zipRootDir, file));
        return encoding ? data.toString(encoding) : data;
    } else {
        return fs.readFileSync(path.join(mod.modPath, file), encoding);
    }
}


function _initUnpacked(root) {
    try {
        unpackedModRoot = fs.realpathSync(root);
        fs.mkdirSync(unpackedModRoot, {recursive: true});
    } catch(e) {
        console.warn('MODS folder uncreatable:', root, e);
        unpackedModRoot = null;
    }
    if (!unpackedModRoot || !fs.existsSync(unpackedModRoot) || !fs.statSync(unpackedModRoot).isDirectory()) {
        return [];
    }
    const validMods = [];
    for (const x of fs.readdirSync(unpackedModRoot)) {
        const modPath = fs.realpathSync(path.join(unpackedModRoot, x));
        const f = fs.statSync(modPath);
        if (f.isDirectory()) {
            const manifestPath = path.join(modPath, 'manifest.json');
            if (!fs.existsSync(manifestPath)) {
                console.warn("Ignoring mod directory without manifest.json:", x);
                continue;
            }
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath));
                const id = manifest?.id || sanitizeID(x);
                const isNew = !modsSettings[id];
                const settings = modsSettings[id] = (modsSettings[id] || {});
                const enabled = !isNew && !!settings.enabled;
                const label = `${manifest.name} (${id})`;
                console.info(`Detected unpacked MOD: ${label} [${enabled ? 'ENABLED' : 'DISABLED'}]`);
                if (isNew || enabled) {
                    validateManifest(manifest, modPath, label);
                }
                validMods.push({manifest, isNew, id, modPath, packed: false});
            } catch(e) {
                if (e instanceof ValidationError) {
                    const path = e.key ? e.path.concat(e.key) : e.path;
                    console.error(`Mod validation error [${x}] (${path.join('.')}): ${e.message}`);
                } else {
                    console.error('Invalid manifest.json for:', x, e);
                }
            }
        } else if (!['.DS_Store'].includes(x)) {
            console.warn("Ignoring non-directory in mod path:", x);
        }
    }
    return validMods;
}


async function getUpstreamDirectory() {
    if (!upstreamDirectory) {
        //upstreamDirectory = await (await fetch('https://mods.sauce.llc/directory.json')).json();
        upstreamDirectory = await (await fetch('http://localhost:8000/directory.json')).json();
    }
    return upstreamDirectory;
}


async function _initPacked(root) {
    try {
        packedModRoot = root;
        fs.mkdirSync(packedModRoot, {recursive: true});
    } catch(e) {
        console.warn('MODS folder uncreatable:', root, e);
        packedModRoot = null;
    }
    if (!packedModRoot) {
        return [];
    }
    const validMods = [];
    for (const [id, entry] of Object.entries(modsInstalled)) {
        const settings = modsSettings[id] = (modsSettings[id] || {});
        if (!settings.enabled) {
            console.warn('Skipping disabled mod:', id);
            continue;
        }
        try {
            const zipFile = path.join(packedModRoot, entry.file);
            let mod = await openPackedMod(zipFile, id);
            const latestRelease = await getLatestPackedModRelease(id);
            if (latestRelease && latestRelease.hash !== mod.hash) {
                console.warn('Updating packed Mod:', mod.manifest.name);
                debugger;
                const oldZip = mod.zip;
                mod = await installPackedModRelease(id, latestRelease);
                oldZip.close();
                fsRemoveFile(zipFile);
            }
            console.info(`Detected packed MOD: ${mod.manifest.name} - v${mod.manifest.version} [ENABLED]`);
            validMods.push(mod);
        } catch(e) {
            if (e instanceof ValidationError) {
                const path = e.key ? e.path.concat(e.key) : e.path;
                console.error(`Mod validation error [${id}] (${path.join('.')}): ${e.message}`);
            } else {
                console.error('Invalid Mod:', id, entry.file, e);
            }
        }
    }
    return validMods;
}


function packedModHash({file, data}) {
    const sha256 = crypto.createHash('sha256');
    if (file) {
        data = fs.readFileSync(file);
    }
    return sha256.update(data).digest('hex');
}


async function openPackedMod(file, id) {
    const zip = new StreamZip.async({file});
    let zipRootDir;
    for (const zEntry of Object.values(await zip.entries())) {
        if (!zEntry.isDirectory) {
            const p = path.parse(zEntry.name);
            if (p.base === 'manifest.json') {
                if (p.dir.split(path.sep).length > 1) {
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
        console.warn("Packed extention ID is diffrent from directory ID", id, manifest.id);
    }
    const label = `${manifest.name} (${id || 'missing-id'})`;
    validateManifest(manifest, null, label);
    const hash = packedModHash({file});
    return {id, manifest, zipRootDir, zip, hash, packed: true};
}


function validateManifest(manifest, modPath, label) {
    validateSchema(manifest, modPath, manifestSchema, label, []);
}


function validateSchema(obj, modPath, schema, label, path, unique) {
    if (typeof obj !== 'object') {
        throw new ValidationError(path, undefined, "Invalid manifest root type: expected object");
    }
    const required = new Set(Object.entries(schema)
        .filter(([_, x]) => x.required)
        .map(([k]) => k));
    for (const [k, v] of Object.entries(obj)) {
        if (!schema['*'] && !Object.prototype.hasOwnProperty.call(schema, k)) {
            throw new ValidationError(path, k, 'Unexpected key');
        }
        const info = schema[k] || schema['*'];
        if (info.isArray && !Array.isArray(v)) {
            throw new ValidationError(path, k, 'Invalid type, expected "array"');
        }
        const vUnique = info.schema && new Map(Object.entries(info.schema)
            .filter(([_, x]) => x.unique)
            .map(([k]) => [k, new Set()]));
        const vArr = info.isArray ? v : [v];
        for (const [i, xv] of vArr.entries()) {
            const pathKey = info.isArray ? `${k}[${i}]` : k;
            if (info.deprecated) {
                console.warn(`Deprecated MOD manifest field "${pathKey}": ${label}`);
            }
            if (typeof xv !== info.type) {
                throw new ValidationError(path, pathKey, `Invalid type, expected "${info.type}"`);
            }
            if (info.valid && !info.valid(xv, schema, modPath)) {
                throw new ValidationError(path, pathKey, `Invalid value: "${xv}"`);
            }
            if (info.schema) {
                validateSchema(xv, modPath, info.schema, label, [...path, pathKey], vUnique);
            }
            if (unique && unique.has(k)) {
                const used = unique.get(k);
                if (used.has(xv)) {
                    throw new ValidationError(path, pathKey, `Duplicate value for unique field: "${xv}"`);
                }
                used.add(xv);
            }
        }
        required.delete(k);
    }
    if (required.size) {
        throw new ValidationError(path, undefined, `Missing required key(s): ${[...required]}`);
    }
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
rpc.register(showModsRootFolder);


export function getWindowManifests() {
    const winManifests = [];
    for (const {manifest, id} of availableMods) {
        if (!modsSettings[id]?.enabled || !manifest.windows) {
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


export async function validatePackedMod(zipUrl) {
    const resp = await fetch(zipUrl);
    if (!resp.ok) {
        throw new Error("Mod fetch error: " + resp.status);
    }
    const data = Buffer.from(await resp.arrayBuffer());
    const tmpFile = path.join(packedModRoot, `tmp-${crypto.randomUUID()}.zip`);
    fs.writeFileSync(tmpFile, data);
    try {
        const {manifest, zip, hash} = await openPackedMod(tmpFile);
        zip.close();
        return {manifest, hash, size: data.byteLength};
    } finally {
        fsRemoveFile(tmpFile);
    }
}
rpc.register(validatePackedMod);


async function installPackedModRelease(id, release) {
    const data = await fetchPackedModRelease(release);
    const file = `${crypto.randomUUID()}.zip`;
    fs.writeFileSync(path.join(packedModRoot, file), data);
    const mod = await openPackedMod(path.join(packedModRoot, file), id);
    if (!modsInstalled[id]) {
        modsInstalled[id] = {};
    }
    Object.assign(modsInstalled[id], {
        hash: release.hash,
        file,
        size: data.byteLength
    });
    storage.set(installedKey, modsInstalled);
    fetch(`https://mod-rank.sauce.llc/edit/${id}/installs`, {method: 'POST'}); // bg okay
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
    modsSettings[id] = (modsSettings[id] || {});
    modsSettings[id].enabled = true;
    storage.set(settingsKey, modsSettings);
    const existing = availableMods.find(x => x.id === id);
    if (existing) {
        Object.assign(existing, mod);
    } else {
        availableMods.push(mod);
        modsById.set(id, mod);
    }
    eventEmitter.emit('installed-mod', mod);
    eventEmitter.emit('available-mods-changed', mod, availableMods);
    fetch(`https://mod-rank.sauce.llc/edit/${id}/installs`, {method: 'POST'}); // bg okay
}
rpc.register(installPackedMod);


export function removePackedMod(id) {
    console.warn("Removing Mod:", id);
    const installed = modsInstalled[id];
    if (!installed) {
        throw new Error("Mod not found: " + id);
    }
    delete modsInstalled[id];
    delete modsSettings[id];
    storage.set(installedKey, modsInstalled);
    storage.set(settingsKey, modsSettings);
    const mod = modsById.get(id);
    mod.restartRequired = true;
    mod.status = 'removing';
    fsRemoveFile(path.join(packedModRoot, installed.file));
    eventEmitter.emit('removed-mod', mod);
    eventEmitter.emit('available-mods-changed', mod, availableMods);
}
rpc.register(removePackedMod);



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


function semverOrder(a, b) {
    if (a === b || (!a && !b)) {
        return 0;
    }
    const A = a != null ? a.toString().split('.').map(x => x.split('-')[0]) : [];
    if (A.includes('x')) {
        A.splice(A.indexOf('x'), A.length);
    }
    const B = b != null ? b.toString().split('.').map(x => x.split('-')[0]) : [];
    if (B.includes('x')) {
        B.splice(B.indexOf('x'), B.length);
    }
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
        if (A[i] && B[i]) {
            if (+A[i] > +B[i]) {
                return 1;
            } else if (+A[i] < +B[i]) {
                return -1;
            }
        } else {
            return A[i] ? 1 : -1;
        }
    }
    return 0;
}


function packedModBestRelease(releases) {
    return releases
        .sort((a, b) => semverOrder(b.version, a.version))
        .filter(x => semverOrder(pkg.version, x.minVersion) >= 0)[0];
}
