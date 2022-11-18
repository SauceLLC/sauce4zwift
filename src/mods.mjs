import path from 'node:path';
import fs from 'node:fs';
import * as rpc from './rpc.mjs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');

export const available = [];

rpc.register(() => available, {name: 'listAvailableMods'});


function isSafePath(p, _, modPath) {
    return !!p.match(/^[a-z0-9]+[a-z0-9_\-./]*$/i) && !p.match(/\.\./) &&
        fs.realpathSync(path.join(modPath, p)).startsWith(modPath);
}


const manifestSchema = {
    manifest_version: {type: 'number', required: true, desc: 'Manifest version', valid: x => x === 1},
    name: {type: 'string', required: true, desc: 'Pretty name of the mod'},
    description: {type: 'string', required: true, desc: 'Description of the mod'},
    version: {type: 'string', required: true, desc: 'Mod version, i.e. 1.2.3'},
    homepage_url: {type: 'string', desc: 'Homepage/support URL for mod'},
    web_root: {type: 'string', desc: 'Sub directory containing web assets.', valid: isSafePath},
    content_js: {type: 'string', isArray: true, desc: 'Scripts to execute in all windows', valid: isSafePath},
    content_css: {type: 'string', isArray: true, desc: 'CSS to load in all windows', valid: isSafePath},
    windows: {
        type: 'object',
        isArray: true,
        schema: {
            file: {type: 'string', required: true, desc: 'Path to web page html file',
                valid: isSafePath},
            query: {
                type: 'object',
                desc: 'Query argument key/value pairs, i.e. {"foo": "bar"} => ?foo=bar',
                schema: {
                    "*": {type: 'string', desc: "Value of query argument"},
                }
            },
            id: {type: 'string', required: true, desc: 'Unique identifier for this window'},
            name: {type: 'string', required: true, desc: 'Name to show in listings'},
            description: {type: 'string', desc: 'Extra optional info about the mod'},
            always_visible: {type: 'boolean', desc: 'Override the hide/show button'},
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


export function init() {
    available.length = 0;
    try {
        _init();
    } catch(e) {
        console.error("Mods init error:", e);
    }
}


function _init() {
    let modRoot = path.join(electron.app.getPath('documents'), 'SauceMods');
    try {
        modRoot = fs.realpathSync(modRoot);
    } catch(e) {
        console.warn('No mods found in:', modRoot);
        return;
    }
    if (fs.existsSync(modRoot) && fs.statSync(modRoot).isDirectory()) {
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
                    validateManifest(manifest, modPath);
                    available.push({manifest, dir: x, modPath});
                    console.info('Added mod:', manifest.name, '/mods/' + x, '->', modPath);
                } catch(e) {
                    console.error('Invalid manifest.json for:', x, e);
                }
            } else {
                console.warn("Ignoring non-directory in mod path:", x);
            }
        }
    }
    if (!available.length) {
        console.info("No (valid) mods found at:", modRoot);
    }
}


function validateManifest(manifest, modPath) {
    validateSchema(manifest, modPath, manifestSchema);
}


function validateSchema(obj, modPath, schema) {
    if (typeof obj !== 'object') {
        throw new TypeError("Invalid manifest root type: expected object");
    } 
    const required = new Set(Object.entries(schema).filter(([_, x]) => x.required).map(([k]) => k));
    for (const [k, v] of Object.entries(obj)) {
        if (!schema['*'] && !Object.prototype.hasOwnProperty.call(schema, k)) {
            throw TypeError("Unexpected key: " + k);
        }
        const info = schema[k] || schema['*'];
        if (info.isArray && !Array.isArray(v)) {
            throw TypeError(`Invalid type: "${k}" should be an array`);
        }
        const vArr = info.isArray ? v : [v];
        for (const xv of vArr) {
            if (typeof xv !== info.type) {
                throw TypeError(`Invalid type: "${k}" should be a "${info.type}"`);
            }
            if (info.valid && !info.valid(xv, schema, modPath)) {
                throw TypeError(`Invalid value: "${xv}" is not valid for the key "${k}"`);
            }
            if (info.schema) {
                validateSchema(xv, modPath, info.schema);
            }
        }
        required.delete(k);
    }
    if (required.size) {
        throw TypeError(`Missing required keys: ${[...required]}`);
    }
}


export function getWindowManifests() {
    const winManifests = [];
    for (const {manifest, dir} of available) {
        if (manifest.windows) {
            for (const x of manifest.windows) {
                const bounds = x.default_bounds || {};
                try {
                    winManifests.push({
                        type: `${dir}-${x.id}`,
                        file: `/mods/${dir}/${x.file}`,
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
                        alwaysVisible: x.alwaysVisible,
                        overlay: x.overlay,
                    });
                } catch(e) {
                    console.error("Failed to create window manifest for mod:", dir, x.id, e);
                }
            }
        }
    }
    return winManifests;
}


export function getWindowContentScripts() {
    const scripts = [];
    for (const {manifest, modPath} of available) {
        if (manifest.content_js) {
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
    for (const {manifest, modPath} of available) {
        if (manifest.content_css) {
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
