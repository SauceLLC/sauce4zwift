import path from 'node:path';
import fs from 'node:fs';
import * as rpc from './rpc.mjs';
import * as storage from './storage.mjs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);

const settingsKey = 'mod-settings';
let settings;
let modRoot;

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


function isSafePath(p, _, modPath) {
    return !!p.match(/^[a-z0-9]+[a-z0-9_\-./]*$/i) && !p.match(/\.\./) &&
        fs.realpathSync(path.join(modPath, p)).startsWith(modPath);
}


const manifestSchema = {
    manifest_version: {type: 'number', required: true, desc: 'Manifest version', valid: x => x === 1},
    id: {type: 'string', desc: 'Optional ID for this mod, defaults to the directory name'},
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


export function init(...args) {
    available.length = 0;
    try {
        _init(...args);
    } catch(e) {
        console.error("MODS init error:", e);
    }
    return available;
}


function showModsRootFolder() {
    let electron;
    try {
        electron = require('electron');
    } catch(e) {/*no-pragma*/}
    if (electron && electron.shell) {
        electron.shell.openPath(modRoot);
    } else {
        console.info(modRoot);
    }
    return modRoot;
}
rpc.register(showModsRootFolder);


function _init(root) {
    settings = storage.get(settingsKey) || {};
    try {
        fs.mkdirSync(root, {recursive: true});
        modRoot = fs.realpathSync(root);
    } catch(e) {
        console.warn('MODS folder uncreatable:', root, e);
    }
    if (modRoot && fs.existsSync(modRoot) && fs.statSync(modRoot).isDirectory()) {
        for (const x of fs.readdirSync(modRoot)) {
            const modPath = fs.realpathSync(path.join(modRoot, x));
            const f = fs.statSync(modPath);
            if (f.isDirectory()) {
                const manifestPath = path.join(modPath, 'manifest.json');
                if (!fs.existsSync(manifestPath)) {
                    console.warn("Ignoring mod directory without manifest.json:", x);
                    continue;
                }
                let manifest;
                try {
                    manifest = JSON.parse(fs.readFileSync(manifestPath));
                    const id = manifest?.id || x;
                    const isNew = !settings[id];
                    const enabled = !isNew && !!settings[id].enabled;
                    const label = `${manifest.name} (${id})`;
                    console.info(`Detected MOD: ${label} [${enabled ? 'ENABLED' : 'DISABLED'}]`);
                    if (isNew || enabled) {
                        validateManifest(manifest, modPath, label);
                    }
                    available.push({manifest, isNew, enabled, id, modPath});
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
    }
    if (!available.length) {
        console.info("No MODS found in:", modRoot);
    }
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
            throw new ValidationError(path, k, 'Invalid type: Expected array');
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
                throw new ValidationError(path, pathKey, 'Invalid type: Expected ${info.type}');
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
