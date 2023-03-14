/*
 * Derived from _.template.
 * Adds:
 *  Async support
 *  Localization support via {{{localized_key}}}
 */

import * as locale from './locale.mjs';
import * as browser from './browser.mjs';


const _tplCache = new Map();
const _tplFetching = new Map();


export async function getTemplate(url, localeKey) {
    localeKey = localeKey || '';
    const cacheKey = '' + url + localeKey;
    if (!_tplCache.has(cacheKey)) {
        if (!_tplFetching.has(cacheKey)) {
            _tplFetching.set(cacheKey, browser.cachedFetch(url).then(async tplText => {
                const localePrefix = localeKey && `${localeKey}_`;
                if (!tplText) {
                    console.error("Template not found:", url);
                    _tplCache.set(cacheKey, undefined);
                    return;
                }
                _tplCache.set(cacheKey, await compile(tplText, {localePrefix}));
            }).finally(() => _tplFetching.delete(cacheKey)));
        }
        await _tplFetching.get(cacheKey);
    }
    return _tplCache.get(cacheKey);
}


const htmlEntityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '`': '&#x60;'
};
const special = `(?:${Object.keys(htmlEntityMap).join('|')})`;
const testRegexp = RegExp(special);
const replaceRegexp = RegExp(special, 'g');
export function escape(x) {
    const str = x == null ? '' : '' + x;
    return testRegexp.test(str) ? str.replace(replaceRegexp, x => htmlEntityMap[x]) : str;
}


// Certain characters need to be escaped so that they can be put into a string literal.
const escapes = {
    "'": "'",
    '\\': '\\',
    '\r': 'r',
    '\n': 'n',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
};
const escapeChar = match => '\\' + escapes[match];
const escapeRegExp = /\\|'|\r|\n|\u2028|\u2029/g;

const localeHelpers = {};
for (const fn of Object.values(locale.human)) {
    if (!fn.name || !fn.name.startsWith('human')) {
        console.warn("Unexpected naming convention for locale human function:", fn.name);
        continue;
    }
    localeHelpers[fn.name] = fn;
}

const helpers = {
    embed: async function(file, data) {
        const localeKey = this.settings.localePrefix && this.settings.localePrefix.slice(0, -1);
        return (await getTemplate(file, localeKey))(data);
    },
    ...localeHelpers,
};

const staticHelpers = {
    inlineURL: url => browser.cachedFetch(url),
};


async function compile(text, settingsOverrides) {
    const settings = Object.assign({}, {
        localeLookup: /\{\{\{\[(.+?)\]\}\}\}/g,
        locale: /\{\{\{(.+?)\}\}\}/g,
        staticHelper: /\{\{=([^\s]+?)\s+(.+?)=\}\}/g,
        escape: /\{\{(.+?)\}\}/g,
        interpolate: /\{-(.+?)-\}/g,
        evaluate: /<%([\s\S]+?)%>/g,
        localePrefix: '',
    }, settingsOverrides);
    settings.helpers = Object.fromEntries(Object.entries(helpers).map(([k, fn]) =>
        ([k, fn.bind({settings})])));
    const noMatch = /(.)^/;
    // Combine delimiters into one regular expression via alternation.
    const matcher = RegExp([
        (settings.localeLookup || noMatch).source,
        (settings.locale || noMatch).source,
        (settings.staticHelper || noMatch).source,
        (settings.escape || noMatch).source,
        (settings.interpolate || noMatch).source,
        (settings.evaluate || noMatch).source,
    ].join('|') + '|$', 'g');
    const code = [`
        return async function sauceTemplateRender({locale, escape, helpers, localeMessages, statics}, obj) {
            let __t; // tmp
            const __p = []; // output buffer
            with ({...helpers, ...obj}) {
    `];
    let index = 0;
    const localeKeys = [];
    const staticCalls = [];
    text.replace(matcher, (...args) => {
        const [match, localeLookup, locale, shName, shArg, escape, interpolate, evaluate, offset] = args;
        code.push(`__p.push('${text.slice(index, offset).replace(escapeRegExp, escapeChar)}');\n`);
        index = offset + match.length;
        if (localeLookup) {
            code.push(`
                __t = (${localeLookup}).startsWith('/') ?
                    (${localeLookup}).substr(1) :
                    '${settings.localePrefix}' + (${localeLookup});
                __t = locale.fastGetMessage(__t);
                __p.push(__t instanceof Promise ? (await __t) : __t);
            `);
        } else if (locale) {
            const key = locale.startsWith('/') ? locale.substr(1) : settings.localePrefix + locale;
            localeKeys.push(key);
            code.push(`__p.push(localeMessages['${key}']);\n`);
        } else if (escape) {
            code.push(`
                __t = (${escape});
                if (__t != null) {
                    __p.push(escape(__t));
                }
            `);
        } else if (interpolate) {
            code.push(`
                __t = (${interpolate});
                if (__t != null) {
                    __p.push(__t);
                }
            `);
        } else if (evaluate) {
            code.push(evaluate);
        } else if (shName) {
            const id = staticCalls.length;
            staticCalls.push([shName, shArg]);
            code.push(`__p.push(statics[${id}]);\n`);
        }
    });
    code.push(`
            } /*end-with*/
            const html = __p.join('');
            const el = document.createElement('div');
            el.innerHTML = html;
            const frag = document.createDocumentFragment();
            frag.append(...el.children);
            return frag;
        }; /*end-func*/
    `);
    const source = code.join('');
    let render;
    const Fn = (function(){}).constructor;
    try {
        render = (new Fn(source))();
    } catch (e) {
        e.source = source;
        throw e;
    }
    let localeMessages;
    if (localeKeys.length) {
        localeMessages = await locale.fastGetMessagesObject(localeKeys);
    }
    let statics;
    if (staticCalls.length) {
        statics = await Promise.all(staticCalls.map(([name, args]) => staticHelpers[name](args)));
    }
    return render.bind(this, {
        locale,
        escape,
        helpers: settings.helpers,
        localeMessages,
        statics
    });
}
