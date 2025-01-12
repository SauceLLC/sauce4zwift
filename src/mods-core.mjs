/*
 * Run anywhere sauce 4 zwift Mod functions and verification
 */


export const extraSafePathValidators = [];

export class ValidationError extends TypeError {
    constructor(path, key, message) {
        super(message);
        this.path = path;
        this.key = key;
    }
}


export function isSafePath(x) {
    return !!x.match(/^[a-z0-9]+[a-z0-9_\-./]*$/i) && !x.match(/\.\./) &&
        extraSafePathValidators.every(fn => fn(...arguments));
}


export function isSafeID(x) {
    return !!x.match(/^[a-z0-9-_]+$/i);
}


export function sanitizeID(x) {
    return x.replace(/[^a-z0-9\-_]/ig, '-');
}


export const manifestSchema = {
    manifest_version: {type: 'number', required: true, desc: 'Manifest version', valid: x => x === 1},
    id: {type: 'string', desc: 'Optional ID for this mod, defaults to the directory name', valid: isSafeID},
    name: {type: 'string', required: true, desc: 'Pretty name of the mod'},
    description: {type: 'string', required: true, desc: 'Description of the mod'},
    version: {type: 'string', required: true, desc: 'Mod version, i.e. 1.2.3'},
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


export function validateMod(mod) {
    const warnings = validateSchema(mod.manifest, mod.modPath, manifestSchema);
    return {warnings};
}


function validateSchema(obj, modPath, schema, _path=[], _unique, _warnings=[]) {
    if (typeof obj !== 'object') {
        throw new ValidationError(_path, undefined, "Invalid manifest root type: expected object");
    }
    const required = new Set(Object.entries(schema)
        .filter(([_, x]) => x.required)
        .map(([k]) => k));
    for (const [k, v] of Object.entries(obj)) {
        if (!schema['*'] && !Object.prototype.hasOwnProperty.call(schema, k)) {
            throw new ValidationError(_path, k, 'Unexpected key');
        }
        const info = schema[k] || schema['*'];
        if (info.isArray && !Array.isArray(v)) {
            throw new ValidationError(_path, k, 'Invalid type, expected "array"');
        }
        const vUnique = info.schema && new Map(Object.entries(info.schema)
            .filter(([_, x]) => x.unique)
            .map(([k]) => [k, new Set()]));
        const vArr = info.isArray ? v : [v];
        for (const [i, xv] of vArr.entries()) {
            const pathKey = info.isArray ? `${k}[${i}]` : k;
            if (info.deprecated) {
                _warnings.push(`Deprecated field "${[..._path, pathKey].join('.')}"`);
            }
            if (typeof xv !== info.type) {
                throw new ValidationError(_path, pathKey, `Invalid type, expected "${info.type}"`);
            }
            if (info.valid && !info.valid(xv, schema, modPath)) {
                throw new ValidationError(_path, pathKey, `Invalid value: "${xv}"`);
            }
            if (info.schema) {
                validateSchema(xv, modPath, info.schema, [..._path, pathKey], vUnique, _warnings);
            }
            if (_unique && _unique.has(k)) {
                const used = _unique.get(k);
                if (used.has(xv)) {
                    throw new ValidationError(_path, pathKey, `Duplicate value for unique field: "${xv}"`);
                }
                used.add(xv);
            }
        }
        required.delete(k);
    }
    if (required.size) {
        throw new ValidationError(_path, undefined, `Missing required key(s): ${[...required]}`);
    }
    return _warnings;
}


export function semverOrder(a, b) {
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
