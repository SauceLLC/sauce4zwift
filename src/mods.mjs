import path from 'node:path';
import fs from 'node:fs';
import StreamZip from 'node-stream-zip';
import * as rpc from './rpc.mjs';
import * as storage from './storage.mjs';
import fetch from 'node-fetch';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const settingsKey = 'mod-settings';
const directoryKey = 'mod-directory';
let settings;
let directory;
let unpackedModRoot;
let packedModRoot;

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
    storage.set(settingsKey, settings);
}
rpc.register(setEnabled, {name: 'setModEnabled'});


function isSafePath(x, _, modPath) {
    return !!x.match(/^[a-z0-9]+[a-z0-9_\-./]*$/i) && !x.match(/\.\./) &&
        (!modPath || fs.realpathSync(path.join(modPath, x)).startsWith(modPath));
}


function isSafeID(x) {
    return !!x.match(/^[a-z0-9-]+$/i);
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
    directory = storage.get(directoryKey) || {};
    available.length = 0;
    try {
        available.push(..._initUnpacked(unpackedDir));
        available.push(...(await _initPacked(packedDir)));
    } catch(e) {
        console.error("MODS init error:", e);
    }
    return available;
}


function _initUnpacked(root) {
    try {
        fs.mkdirSync(root, {recursive: true});
        unpackedModRoot = root = fs.realpathSync(root);
    } catch(e) {
        console.warn('MODS folder uncreatable:', root, e);
    }
    if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        return [];
    }
    const validMods = [];
    for (const x of fs.readdirSync(root)) {
        const modPath = fs.realpathSync(path.join(root, x));
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


async function _initPacked(root) {
    try {
        fs.mkdirSync(root, {recursive: true});
        packedModRoot = root = fs.realpathSync(root);
    } catch(e) {
        console.warn('MODS folder uncreatable:', root, e);
        root = null;
    }
    if (!root || !directory) {
        return [];
    }
    const dlURL = await getGithubSourceURL({
        "type": "github",
        "org": "mayfield",
        "id": "b7a17692-cbcb-493a-827f-c84a64f14af1",
        "repo": "s4z-wolf3d-mod",
        "logoURL": "https://raw.githubusercontent.com/mayfield/s4z-wolf3d-mod/main/pages/images/favicon.png",
        "releases": [{
            "id": 145384817,
            "assetId": 155706162
        }, {
            "id": 145384817,
            "assetId": 155706162,
            "minVersion": "1.1"
        }, {
            "id": 145384817,
            "assetId": 155706162,
            "minVersion": "1.x"
        }, {
            "id": 145384817,
            "assetId": 155706162,
            "minVersion": "1.1.5"
        }, {
            "id": 145384817,
            "assetId": 155706162,
            "minVersion": "1.2"
        }, {
            "id": 145384817,
            "assetId": 155706162,
            "minVersion": "1.3.x"
        }, {
            "id": 145384817,
            "assetId": 155706162,
            "minVersion": "1.3.3"
        }, {
            "id": 145384817,
            "assetId": 155706162,
            "minVersion": "1.3"
        }, {
            "id": 145384817,
            "assetId": 155706162,
            "minVersion": "2"
        }]
    });
    const validMods = [];
    for (const [id, entry] of Object.entries(directory)) {
        const modSettings = settings[id];
        if (!modSettings || !modSettings.enabled) {
            console.warn('Skipping disabled mod:', id);
            continue;
        }
        try {
            const file = fs.realpathSync(path.join(root, entry.installed.file));
            const zip = new StreamZip.async({file: fs.statSync(file)});
            const manifest = JSON.parse(zip.entryData('/manifest.json'));
            if (manifest.id && manifest.id !== id) {
                console.warn("Packed extention ID is diffrent from directory entry", id, manifest.id);
            }
            const label = `${manifest.name} (${id})`;
            console.info(`Detected packed MOD: ${label} [ENABLED]`);
            validateManifest(manifest, null, label);
            validMods.push({manifest, isNew: false, enabled: true, id, zip, unpacked: false});
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


export async function installPackedMod(entry) {
    const dlURL = await getGithubSourceURL(entry);
    const existing = directory[entry.id];
    storage.set(settingsKey, settings);
}


export function updatePackedMod(entry) {
    debugger;
}


export function removePackedMod(entry) {
    debugger;
}


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


async function getGithubSourceURL(entry) {
    const releases = entry.releases
        .sort((a, b) => semverOrder(b.minVersion, a.minVersion))
        .filter(x => semverOrder(pkg.version, x.minVersion) >= 0);
    console.log(releases);
    const release = releases[0];
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
    console.warn({upstreamRelInfo, asset});
    return asset.browser_download_url;
}
