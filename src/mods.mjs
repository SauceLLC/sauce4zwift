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
let settings;
let installed;
let upstreamDirectory;
let unpackedModRoot;
let packedModRoot;

export const eventEmitter = new EventEmitter();
export const available = [];

rpc.register(() => available, {name: 'getAvailableMods'});
rpc.register(() => available.filter(x => x.enabled), {name: 'getEnabledMods'});


export class ValidationError extends TypeError {
    constructor(path, key, message) {
        super(message);
        this.path = path;
        this.key = key;
    }
}


export function setEnabled(id, enabled) {
    const mod = available.find(x => x.id === id);
    if (!mod) {
        throw new Error('ID not found');
    }
    if (!settings[id]) {
        settings[id] = {};
    }
    mod.enabled = settings[id].enabled = enabled;
    mod.restartRequired = true;
    mod.status = enabled ? 'enabling' : 'disabling';
    storage.set(settingsKey, settings);
    eventEmitter.emit('enabled-mod', enabled, mod);
    eventEmitter.emit('available-mods-changed', mod, available);
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
    settings = storage.get(settingsKey) || {};
    installed = storage.get(installedKey) || {};
    available.length = 0;
    try {
        available.push(..._initUnpacked(unpackedDir));
        available.push(...(await _initPacked(packedDir)));
    } catch(e) {
        console.error("MODS init error:", e);
    }
    for (const x of available) {
        x.status = 'active';
    }
    return available;
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
                const isNew = !settings[id];
                const enabled = !isNew && !!settings[id].enabled;
                const label = `${manifest.name} (${id})`;
                console.info(`Detected unpacked MOD: ${label} [${enabled ? 'ENABLED' : 'DISABLED'}]`);
                if (isNew || enabled) {
                    validateManifest(manifest, modPath, label);
                }
                validMods.push({manifest, isNew, enabled, id, modPath, unpacked: true});
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
        upstreamDirectory = await (await fetch('https://mods.sauce.llc/directory.json')).json();
    }
    return upstreamDirectory;
}


async function _initPacked(root) {
    try {
        packedModRoot = fs.realpathSync(root);
        fs.mkdirSync(packedModRoot, {recursive: true});
    } catch(e) {
        console.warn('MODS folder uncreatable:', root, e);
        packedModRoot = null;
    }
    if (!packedModRoot) {
        return [];
    }
    const validMods = [];
    for (const [id, entry] of Object.entries(installed)) {
        const modSettings = settings[id];
        if (!modSettings || !modSettings.enabled) {
            console.warn('Skipping disabled mod:', id);
            continue;
        }
        try {
            const fullpath = path.join(packedModRoot, entry.file);
            const {manifest, zip, zipRootDir} = await parsePackedMod(fullpath, id);
            console.info(`Detected packed MOD: ${manifest.name} [ENABLED]`);
            validMods.push({manifest, enabled: true, id, zip, zipRootDir});
        } catch(e) {
            if (e instanceof ValidationError) {
                const path = e.key ? e.path.concat(e.key) : e.path;
                console.error(`Mod validation error [${id}] (${path.join('.')}): ${e.message}`);
            } else {
                console.error('Invalid manifest.json for:', id, e);
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


async function parsePackedMod(file, id) {
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
    return {manifest, zipRootDir, zip, hash};
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
    for (const {enabled, manifest, id} of available) {
        if (enabled && manifest.windows) {
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
    }
    return winManifests;
}


export function getWindowContentScripts() {
    const scripts = [];
    for (const {enabled, manifest, modPath} of available) {
        if (enabled && manifest.content_js) {
            for (const x of manifest.content_js) {
                try {
                    scripts.push(fs.readFileSync(path.join(modPath, x), 'utf8'));
                } catch(e) {
                    console.error("Failed to load content script:", x, e);
                }
            }
        }
    }
    return scripts;
}


export function getWindowContentStyle() {
    const css = [];
    for (const {enabled, manifest, modPath} of available) {
        if (enabled && manifest.content_css) {
            for (const x of manifest.content_css) {
                try {
                    css.push(fs.readFileSync(path.join(modPath, x), 'utf8'));
                } catch(e) {
                    console.error("Failed to load content style:", x, e);
                }
            }
        }
    }
    return css;
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
        const {manifest, zip, hash} = await parsePackedMod(tmpFile);
        zip.close();
        return {manifest, hash};
    } finally {
        fs.rmSync(tmpFile, {maxRetries: 5});
    }
}
rpc.register(validatePackedMod);


export async function installPackedMod(id) {
    console.warn("Installing Mod:", id);
    const dir = await getUpstreamDirectory();
    const dirEntry = dir.find(x => x.id === id);
    if (!dirEntry) {
        throw new Error("ID not found: " + id);
    }
    let file;
    if (dirEntry.type === 'github') {
        const relDetails = await getGithubReleaseDetails(dirEntry);
        const resp = await fetch(relDetails.url);
        if (!resp.ok) {
            throw new Error("Mod install fetch error: " + resp.status);
        }
        const data = Buffer.from(await resp.arrayBuffer());
        const hash = packedModHash({data});
        if (hash !== relDetails.hash) {
            throw new Error("Mod file hash does not match upstream directory hash");
        }
        file = `${crypto.randomUUID()}.zip`;
        fs.writeFileSync(path.join(packedModRoot, file), data);
        installed[id] = {hash, file};
        settings[id] = settings[id] || {};
        settings[id].enabled = true;
    } else {
        throw new TypeError("Unsupported mod release type: " + dirEntry.type);
    }
    storage.set(installedKey, installed);
    storage.set(settingsKey, settings);
    const availEntry = await parsePackedMod(path.join(packedModRoot, file), id);
    availEntry.id = id;
    availEntry.enabled = true;
    availEntry.restartRequired = true;
    availEntry.status = 'installing';
    const existing = available.find(x => x.id === id);
    if (existing) {
        Object.assign(existing, availEntry);
    } else {
        available.push(availEntry);
    }
    eventEmitter.emit('installed-mod', availEntry);
    eventEmitter.emit('available-mods-changed', availEntry, available);
    debugger;
    const resp = await fetch(`https://mod-rank.sauce.llc/edit/${id}/installs`, {method: 'POST'}); // bg okay
    console.log(resp, resp.ok, resp.status);
    console.log(await resp.text());
}
rpc.register(installPackedMod);


export function removePackedMod(id) {
    console.warn("Removing Mod:", id);
    const entry = installed[id];
    if (!entry) {
        throw new Error("Mod not found: " + id);
    }
    delete installed[id];
    delete settings[id];
    storage.set(installedKey, installed);
    storage.set(settingsKey, settings);
    const availEntry = available.find(x => x.id === id);
    availEntry.restartRequired = true;
    availEntry.status = 'removing';
    // maxRetries is for Windows which is broken by design.
    fs.rmSync(path.join(packedModRoot, entry.file), {maxRetries: 5});
    eventEmitter.emit('removed-mod', availEntry);
    eventEmitter.emit('available-mods-changed', availEntry, available);
}
rpc.register(removePackedMod);


export async function checkUpdatePackedMod(id) {
    const installEntry = installed[id];
    if (!installEntry) {
        throw new Error("Mod ID not installed");
    }
    const dir = await getUpstreamDirectory();
    const dirEntry = dir.find(x => x.id === id);
    if (!dirEntry) {
        throw new Error("Upstream Mod ID not found: " + id);
    }
    let release;
    if (dirEntry.type === 'github') {
        release = packedModBestRelease(dirEntry.releases);
    } else {
        throw new TypeError("Unsupported mod release type: " + dirEntry.type);
    }
    if (!release) {
        console.error('No compatible upstream release found for:', id);
        return;
    }
    if (release.hash !== installEntry.hash) {
        return release;
    }
}
rpc.register(checkUpdatePackedMod);


function semverOrder(a, b) {
    if (a === b || (!a && !b)) {
        return 0;
    }
    const A = a ? a.split('.').map(x => x.split('-')[0]) : [];
    if (A.includes('x')) {
        A.splice(A.indexOf('x'), A.length);
    }
    const B = b ? b.split('.').map(x => x.split('-')[0]) : [];
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
        .sort((a, b) => semverOrder(b.minVersion, a.minVersion))
        .filter(x => semverOrder(pkg.version, x.minVersion) >= 0)[0];
}


async function getGithubReleaseDetails(entry) {
    const release = packedModBestRelease(entry.releases);
    if (!release) {
        console.warn("No compatible release found");
        return;
    }
    const resp = await fetch(
        `https://api.github.com/repos/${entry.org}/${entry.repo}/releases/${release.id}`);
    if (!resp.ok) {
        throw new Error('Github Mod fetch error:', resp.status, await resp.text());
    }
    const upstreamRelInfo = await resp.json();
    const asset = upstreamRelInfo.assets.find(xx => xx.id === release.assetId);
    return {
        hash: release.hash,
        url: asset.browser_download_url,
        date: new Date(asset.updated_at),
        version: upstreamRelInfo.tag_name,
    };
}
