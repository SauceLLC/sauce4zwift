/* global Sentry, electron */

import {sleep} from '../../shared/sauce/base.mjs';
import * as report from '../../shared/report.mjs';
import './sentry.js';

const doc = document.documentElement;

const worldCourseDescs = [
    {worldId: 1, courseId: 6, name: 'Watopia', ident: 'WATOPIA'},
    {worldId: 2, courseId: 2, name: 'Richmond', ident: 'RICHMOND'},
    {worldId: 3, courseId: 7, name: 'London', ident: 'LONDON'},
    {worldId: 4, courseId: 8, name: 'New York', ident: 'NEWYORK'},
    {worldId: 5, courseId: 9, name: 'Innsbruck', ident: 'INNSBRUCK'},
    {worldId: 6, courseId: 10, name: 'Bologna', ident: 'BOLOGNATT'},
    {worldId: 7, courseId: 11, name: 'Yorkshire', ident: 'YORKSHIRE'},
    {worldId: 8, courseId: 12, name: 'Crit City', ident: 'CRITCITY'}, // XXX guess
    {worldId: 9, courseId: 13, name: 'Makuri Islands', ident: 'MAKURIISLANDS'},
    {worldId: 10, courseId: 14, name: 'France', ident: 'FRANCE'},
    {worldId: 11, courseId: 15, name: 'Paris', ident: 'PARIS'},
    {worldId: 12, courseId: 16, name: 'Gravel Mountain', ident: 'GRAVEL MOUNTAIN'}, // XXX guess
];
export const courseToWorldIds = Object.fromEntries(worldCourseDescs.map(x => [x.courseId, x.worldId]));
export const worldToCourseIds = Object.fromEntries(worldCourseDescs.map(x => [x.worldId, x.courseId]));
export const courseToNames = Object.fromEntries(worldCourseDescs.map(x => [x.courseId, x.name]));
export const worldToNames = Object.fromEntries(worldCourseDescs.map(x => [x.worldId, x.name]));
export const identToWorldId = Object.fromEntries(worldCourseDescs.map(x => [x.ident, x.worldId]));



function makeRPCError(errResp) {
    const e = new Error(`${errResp.error.name}: ${errResp.error.message}`);
    e.stack = errResp.error.stack; // XXX merge with local stack too.
    return e;
}


let rpcCall;
let windowID;
export let subscribe;
if (window.isElectron) {
    windowID = electron.context.id;
    const sendToElectron = function(name, data) {
        document.dispatchEvent(new CustomEvent('electron-message', {detail: {name, data}}));
    };

    let evId = 1;
    subscribe = function(event, callback, options={}) {
        const domEvent = `sauce-${event}-${evId++}`;
        document.addEventListener(domEvent, ev => void callback(JSON.parse(ev.detail)));
        sendToElectron('subscribe', {event, domEvent, ...options});
    };

    rpcCall = async function(name, ...args) {
        const domEvent = `sauce-${name}-${evId++}`;
        const resp = new Promise((resolve, reject) => {
            document.addEventListener(domEvent, ev => {
                const r = JSON.parse(ev.detail);
                if (r.success) {
                    resolve(r.value);
                } else {
                    reject(makeRPCError(r));
                }
            }, {once: true});
        });
        document.dispatchEvent(new CustomEvent('electron-rpc', {detail: {domEvent, name, args}}));
        return await resp;
    };
    doc.addEventListener('click', async ev => {
        const link = ev.target.closest('a[external][href]');
        if (link) {
            ev.preventDefault();
            await rpcCall('openExternalLink', link.href);
        }
    });
} else {
    windowID = new URLSearchParams(location.search).get('id') || 'browser-def-id';
    doc.classList.add('browser-mode');
    const respHandlers = new Map();
    const subs = [];
    let uidInc = 1;

    let errBackoff = 500;
    let wsp;
    const connectWebSocket = async function() {
        const ws = new WebSocket(`ws://${location.host}/api/ws/events`);
        ws.addEventListener('message', ev => {
            const envelope = JSON.parse(ev.data);
            const {resolve, reject} = respHandlers.get(envelope.uid);
            if (!resolve) {
                console.error("Websocket Protocol Error:", envelope.error || envelope.data);
                return;
            }
            if (envelope.type === 'response') {
                respHandlers.delete(envelope.uid);
            }
            if (envelope.success) {
                resolve(envelope.data);
            } else {
                reject(new Error(envelope.error));
            }
        });
        ws.addEventListener('close', ev => {
            errBackoff = Math.min(errBackoff * 1.1, 60000);
            console.warn('WebSocket connection issue: retry in', (errBackoff / 1000).toFixed(1), 's');
            wsp = sleep(errBackoff).then(connectWebSocket);
            document.dispatchEvent(new CustomEvent('sauce-ws-status', {detail: 'disconnected'}));
        });
        const tO = setTimeout(() => ws.close(), 5000);
        ws.addEventListener('error', ev => {
            clearTimeout(tO);
        });
        return await new Promise(resolve => {
            ws.addEventListener('open', () => {
                console.debug("WebSocket connected");
                errBackoff = 500;
                clearTimeout(tO);
                for (const {event, callback, options} of subs) {
                    _subscribe(ws, event, callback, options);
                }
                resolve(ws);
                document.dispatchEvent(new CustomEvent('sauce-ws-status', {detail: 'connected'}));
            });
        });
    };

    subscribe = async function(event, callback, options={}) {
        if (!wsp) {
            wsp = connectWebSocket();
        }
        const ws = await wsp;
        await _subscribe(ws, event, callback, options);
        subs.push({event, callback, options});
    };

    rpcCall = async function(name, ...args) {
        const f = await fetch(`/api/rpc/${name}`, {
            method: 'POST',
            headers: {"content-type": 'application/json'},
            body: JSON.stringify(args),
        });
        const r = await f.json();
        if (r.success) {
            return r.value;
        } else {
            throw makeRPCError(r);
        }
    };

    const _subscribe = function(ws, event, callback, options={}) {
        const uid = uidInc++;
        const subId = uidInc++;
        let resolve, reject;
        const p = new Promise((_resolve, _reject) => (resolve = _resolve, reject = _reject));
        respHandlers.set(uid, {resolve, reject});
        respHandlers.set(subId, {resolve: callback, reject: e => console.error(e)});
        ws.send(JSON.stringify({
            type: 'request',
            uid,
            data: {
                method: 'subscribe',
                arg: {
                    event,
                    subId,
                    ...options,
                }
            }
        }));
        return p;
    };
}


export function addOpenSettingsParam(key, value) {
    for (const el of document.querySelectorAll('a.open-settings')) {
        const url = new URL(el.href);
        const q = new URLSearchParams(url.search);
        q.set(key, value);
        url.search = q;
        el.href = url;
    }
}


export function initInteractionListeners() {
    const body = document.body;
    if (window.isElectron) {
        const spec = electron.context.spec;
        let customName = spec && spec.customName;
        if (customName) {
            if (doc.classList.contains('settings-page')) {
                customName += ' - Settings';
            }
            document.title = `${customName} - Sauce for Zwift™`;
            const headerTitle = document.querySelector('#titlebar header .title');
            if (headerTitle) {
                headerTitle.textContent = customName;
            }
        }
    }
    document.addEventListener('sauce-highlight-window', () => {
        if (body.classList.contains('transparent-bg')) {
            body.classList.remove('transparent-bg');
            setTimeout(() => body.classList.add('transparent-bg'), 3000);
        }
        doc.classList.remove('highlight-window');
        doc.offsetWidth; // force layout
        doc.classList.add('highlight-window');
    });
    if (!doc.classList.contains('settings-mode') &&
        !doc.classList.contains('disable-settings-mode')) {
        window.addEventListener('contextmenu', ev => {
            ev.preventDefault();
            void doc.classList.toggle('settings-mode');
        });
        window.addEventListener('blur', () =>
            void doc.classList.remove('settings-mode'));
        window.addEventListener('click', ev => {
            if (!ev.target.closest('#titlebar')) {
                doc.classList.remove('settings-mode');
            }
        });
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (isSafari) {
            let touching;
            window.addEventListener("touchstart", ev => {
                clearTimeout(touching);
                touching = setTimeout(() => window.dispatchEvent(new Event('contextmenu')), 500);
            });
            window.addEventListener("touchmove", () => clearTimeout(touching));
            window.addEventListener("touchend", () => clearTimeout(touching));
        }
    }
    if (!window.isElectron) {
        addOpenSettingsParam('id', windowID);
        if (navigator.userAgent.match(/ OBS\//)) {
            console.info("Enabling OBS hack to avoid broken tabs handling");
            for (const x of document.querySelectorAll('a[target]')) {
                x.removeAttribute('target');
            }
        }
    }
    const close = document.querySelector('#titlebar .button.close');
    if (close) {
        close.addEventListener('click', ev => rpcCall('closeWindow'));
    }
    const minimize = document.querySelector('#titlebar .button.minimize');
    if (minimize) {
        minimize.addEventListener('click', ev => rpcCall('minimizeWindow'));
    }
    const maximize = document.querySelector('#titlebar .button.maximize');
    if (maximize) {
        maximize.addEventListener('click', ev => rpcCall('toggleMaximizeWindow'));
    }
    for (const el of document.querySelectorAll('.button[data-url]')) {
        el.addEventListener('click', ev => location.assign(el.dataset.url));
    }
    for (const el of document.querySelectorAll('.button[data-ext-url]')) {
        el.addEventListener('click', ev => window.open(el.dataset.extUrl, '_blank', 'popup,width=999,height=333'));
    }
}


export class Renderer {
    constructor(contentEl, options={}) {
        this._contentEl = contentEl;
        this._callbacks = [];
        this._data;
        this._nextRender;
        this._lastRenderTime = 0;
        this.locked = !!options.locked;
        this.backgroundRender = options.backgroundRender;
        contentEl.classList.toggle('unlocked', !this.locked);
        this.stopping = false;
        this.fps = options.fps === undefined ? 1 : options.fps;
        this.id = options.id || location.pathname.split('/').at(-1);
        this.fields = new Map();
        this.onKeyDownBound = this.onKeyDown.bind(this);
        if (!this.locked) {
            document.addEventListener('keydown', this.onKeyDownBound);
        }
    }

    setLocked(locked) {
        this.locked = locked;
        if (locked) {
            document.removeEventListener('keydown', this.onKeyDownBound);
        }
        this._contentEl.classList.toggle('unlocked', !this.locked);
    }

    stop() {
        this.stopping = true;
        if (!this.locked) {
            document.removeEventListener('keydown', this.onKeyDownBound);
        }
        clearTimeout(this._scheduledRender);
    }

    onKeyDown(ev) {
        if (this.locked || !document.activeElement || !this._contentEl.contains(document.activeElement)) {
            return;
        }
        const dir = {ArrowRight: 1, ArrowLeft: -1}[ev.key];
        const id = document.activeElement.dataset.field;
        if (dir && id) {
            this.rotateField(id, dir);
        }
    }

    addCallback(cb) {
        this._callbacks.push(cb);
    }

    setData(data) {
        this._data = data;
    }

    getAdjacentFieldIndex(field, offt=1) {
        const cur = field.available.indexOf(field.active);
        if (cur === -1) {
            return 0;
        }
        const adjIdx = (cur + offt) % field.available.length;
        return adjIdx < 0 ? field.available.length + adjIdx : adjIdx;
    }

    rotateField(id, dir=1) {
        if (this.locked) {
            return;
        }
        const field = this.fields.get(id);
        const idx = this.getAdjacentFieldIndex(field, dir);
        storage.set(field.storageKey, idx);
        field.active = field.available[idx];
        console.debug('Switching field', id, idx);
        this.setFieldTooltip(id);
        this.render({force: true});
    }

    addRotatingFields(spec) {
        for (const x of spec.mapping) {
            const id = x.id;
            const el = (spec.el || this._contentEl).querySelector(`[data-field="${x.id}"]`);
            const storageKey = `${this.id}-${id}`;
            this.fields.set(id, {
                id,
                el,
                storageKey,
                available: spec.fields,
                active: spec.fields[storage.get(storageKey) || x.default] || spec.fields[0],
                valueEl: el.querySelector('.value'),
                labelEl: el.querySelector('.label'),
                subLabelEl: el.querySelector('.sub-label'),
                keyEl: el.querySelector('.key'),
                unitEl: el.querySelector('.unit'),
            });
            el.setAttribute('tabindex', 0);
            el.addEventListener('click', ev => this.rotateField(id));
            this.setFieldTooltip(id);
        }
    }

    setFieldTooltip(id) {
        if (this.locked) {
            return;
        }
        const field = this.fields.get(id);
        const nextField = field.available[this.getAdjacentFieldIndex(field, 1)];
        try {
            const name = stripHTML(nextField.key() || nextField.label());
            field.el.title = `Click to change field to: ${name}.  Or use Left/Right keys when focused.`;
        } catch(e) {
            console.error("Failed to get tooltip name for next field:", id, nextField, e);
        }
    }

    schedAnimationFrame(cb) {
        if (!this.backgroundRender) {
            return requestAnimationFrame(cb);
        } else {
            return queueMicrotask(cb);
        }
    }

    render(options={}) {
        if (!options.force && this.fps) {
            const age = performance.now() - (this._lastRender || -Infinity);
            const minAge = 1000 / this.fps;
            if (age < minAge - this._lastRenderTime) {
                if (!this._scheduledRender) {
                    this._scheduledRender = setTimeout(() => {
                        this._scheduledRender = null;
                        this.render();
                    }, Math.ceil(minAge - age));
                }
                return;
            }
        }
        if (!this._nextRender) {
            if (this._scheduledRender) {
                clearTimeout(this._scheduledRender);
                this._scheduledRender = null;
            }
            const start = performance.now();
            this._nextRender = new Promise(resolve => {
                this.schedAnimationFrame(() => {
                    if (this.stopping) {
                        resolve();
                        return;
                    }
                    for (const field of this.fields.values()) {
                        let value = '';
                        try {
                            value = field.active.value(this._data);
                        } catch(e) {
                            report.errorThrottled(e);
                        }
                        const candidate = value != null && !Number.isNaN(value) ? value : '';
                        if (field.valueEl.innerHTML !== candidate) {
                            field.valueEl.innerHTML = candidate;
                        }
                        if (field.labelEl) {
                            let labels = '';
                            try {
                                labels = field.active.label ? field.active.label(this._data) : '';
                            } catch(e) {
                                report.errorThrottled(e);
                            }
                            if (Array.isArray(labels)) {
                                if (field.labelEl.innerHTML !== labels[0]) {
                                    field.labelEl.innerHTML = labels[0];
                                }
                                if (field.subLabelEl) {
                                    const candidate = labels.length > 1 ? labels[1] : '';
                                    if (field.subLabelEl.innerHTML !== candidate) {
                                        field.subLabelEl.innerHTML = candidate;
                                    }
                                }
                            } else {
                                if (field.labelEl.innerHTML !== labels) {
                                    field.labelEl.innerHTML = labels;
                                }
                                if (field.subLabelEl.innerHTML) {
                                    field.subLabelEl.innerHTML = '';
                                }
                            }
                        }
                        if (field.keyEl) {
                            let key = '';
                            try {
                                key = field.active.key ? field.active.key(this._data) : '';
                            } catch(e) {
                                report.errorThrottled(e);
                            }
                            if (field.keyEl.innerHTML !== key) {
                                field.keyEl.innerHTML = key;
                            }
                        }
                        if (field.unitEl) {
                            let unit = '';
                            try {
                                unit = (value != null && value !== '-' && field.active.unit) ?
                                    field.active.unit(this._data) : '';
                            } catch(e) {
                                report.errorThrottled(e);
                            }
                            if (field.unitEl.innerHTML !== unit) {
                                field.unitEl.innerHTML = unit;
                            }
                        }
                    }
                    for (const cb of this._callbacks) {
                        try {
                            cb(this._data);
                        } catch(e) {
                            report.errorThrottled(e);
                        }
                    }
                    resolve();
                });
            }).finally(() => {
                this._lastRender = performance.now();
                this._lastRenderTime = this._lastRender - start;
                this._nextRender = null;
            });
        }
        return this._nextRender;
    }
}


class LocalStorage extends EventTarget {
    constructor() {
        super();
        this.prefix = `${windowID}-`;
        window.addEventListener('storage', this._onStorage.bind(this));
    }

    _onStorage(ev) {
        let evName;
        let key;
        if (ev.key === null) {
            return;  // clear event
        }
        if (ev.key.startsWith(this.prefix)) {
            evName = 'update';
            key = ev.key.substr(this.prefix.length);
        } else if (ev.key[0] === '/') {
            evName = 'globalupdate';
            key = ev.key;
        }
        if (evName) {
            const event = new Event(evName);
            event.data = {key, value: JSON.parse(ev.newValue)};
            this.dispatchEvent(event);
        }
    }

    get(key, def) {
        key = key[0] === '/' ? key : this.prefix + key;
        const value = localStorage.getItem(key);
        if (typeof value !== 'string') {
            if (def !== undefined) {
                this._set(key, def);
            }
            return def;
        } else {
            return JSON.parse(value);
        }
    }

    set(key, value) {
        key = key[0] === '/' ? key : this.prefix + key;
        if (value === undefined) {
            localStorage.removeItem(key);
        } else {
            this._set(key, value);
        }
    }

    _set(fqKey, value) {
        const json = JSON.stringify(value);
        if (typeof json !== 'string') {
            throw new TypeError('Non JSON serializable value');
        }
        localStorage.setItem(fqKey, json);
    }

    delete(key) {
        key = key[0] === '/' ? key : this.prefix + key;
        localStorage.removeItem(key);
    }
}
export const storage = new LocalStorage();


export class SettingsStore extends EventTarget {
    constructor(settingsKey) {
        super();
        this.settingsKey = settingsKey;
        this._storage = new LocalStorage();
        this._settings = this._storage.get(this.settingsKey);
        this._ephemeral = !this._settings;
        if (this._ephemeral) {
            this._settings = {};
        }
        this._storage.addEventListener('globalupdate', ev => {
            const changeEv = new Event('changed');
            changeEv.data = {changed: new Map([[ev.data.key, ev.data.value]])};
            this.dispatchEvent(changeEv);
        });
        this._storage.addEventListener('update', ev => {
            // These are only remote changes from other tabs.
            if (ev.data.key !== this.settingsKey) {
                return;
            }
            const origKeys = new Set(Object.keys(this._settings));
            const changed = new Map();
            for (const [k, v] of Object.entries(ev.data.value)) {
                if (!origKeys.has(k)) {
                    changed.set(k, v);
                } else if (JSON.stringify(this._settings[k]) !== JSON.stringify(v)) {
                    changed.set(k, v);
                }
                this._settings[k] = v;
                origKeys.delete(k);
            }
            for (const k of origKeys) {
                // set -> unset
                changed.set(k, undefined);
                delete this._settings[k];
            }
            const changeEv = new Event('changed');
            changeEv.data = {changed};
            this.dispatchEvent(changeEv);
        });
    }

    setDefault(value) {
        this.get(null, value);
    }

    get(key, def) {
        if (key == null) {
            if (this._ephemeral && def !== undefined) {
                this.set(null, def);
            }
            return this._settings;
        } else if (key[0] !== '/') {
            if (def !== undefined && !Object.prototype.hasOwnProperty.call(this._settings, key)) {
                this.set(key, def);
            }
            return this._settings[key];
        } else {
            const value = this._storage.get(key);
            if (value === undefined && def !== undefined) {
                this._storage.set(key, def);
                return def;
            } else {
                return value;
            }
        }
    }

    set(key, value) {
        if (key == null) {
            Object.assign(this._settings, value);
            this._ephemeral = false;
            this._storage.set(this.settingsKey, this._settings);
        } else if (key[0] !== '/') {
            this._settings[key] = value;
            this._ephemeral = false;
            this._storage.set(this.settingsKey, this._settings);
        } else {
            // global
            this._storage.set(key, value);
        }
    }

    delete(key) {
        debugger;
        if (key[0] !== '/') {
            this.set(key, undefined);
        } else {
            this._storage.delete(key);
        }
    }
}
export const settingsStore = doc.dataset.settingsKey && new SettingsStore(doc.dataset.settingsKey);



function bindFormData(selector, storageIface, options={}) {
    const form = document.querySelector(selector);
    const fieldConnections = new Map();
    for (const el of form.querySelectorAll('input')) {
        el.addEventListener('input', async ev => {
            const baseType = {
                range: 'number',
            }[el.type] || el.type;
            const val = (({
                number: () => el.value ? Number(el.value) : undefined,
                checkbox: () => el.checked,
            }[baseType]) || (() => el.value || undefined))();
            el.closest('label').classList.add('edited');
            for (const x of fieldConnections.get(el.name)) {
                if (!Object.is(x, el)) {
                    x.value = el.value;
                    x.checked = el.checked;
                }
            }
            if (el.dependants) {
                for (const x of el.dependants) {
                    const d = x.dataset.dependsOn;
                    x.disabled = d.startsWith('!') ? el.checked : !el.checked;
                    x.closest('label').classList.toggle('disabled', x.disabled);
                }
            }
            await storageIface.set(el.name, val);
        });
    }
    return async function update() {
        for (const el of form.querySelectorAll('input')) {
            const name = el.name;
            if (!fieldConnections.has(name)) {
                fieldConnections.set(name, new Set());
            }
            fieldConnections.get(name).add(el);
            const val = await storageIface.get(name);
            if (el.type === 'checkbox') {
                el.checked = val;
            } else {
                el.value = val == null ? '' : val;
            }
        }
        for (const el of form.querySelectorAll('.display-field[name]')) {
            const name = el.getAttribute('name');
            const val = await storageIface.get(name);
            el.textContent = val;
            if (el.hasAttribute('href')) {
                el.href = val;
            }
        }
        for (const el of form.querySelectorAll('select')) {
            const name = el.name;
            const val = await storageIface.get(name);
            el.value = val == null ? '' : val;
            el.addEventListener('change', async ev => {
                let val;
                if (el.dataset.type === 'number') {
                    val = el.value ? Number(el.value) : undefined;
                } else {
                    val = el.value || undefined;
                }
                await storageIface.set(name, val);
            });
        }
        for (const el of form.querySelectorAll('[data-depends-on]')) {
            const dependsOn = el.dataset.dependsOn;
            const depEl = form.querySelector(`[name="${dependsOn.replace(/^!/, '')}"]`);
            el.disabled = dependsOn.startsWith('!') ? depEl.checked : !depEl.checked;
            el.closest('label').classList.toggle('disabled', el.disabled);
            if (!depEl.dependants) {
                depEl.dependants = new Set();
            }
            depEl.dependants.add(el);
        }
    };
}


export function initAppSettingsForm(selector) {
    let extraData;
    const storageIface = {
        get: async key => (extraData && Object.prototype.hasOwnProperty.call(extraData, key)) ?
            extraData[key] : await rpcCall('getSetting', key),
        set: async (key, value) => await rpcCall('setSetting', key, value),
    };
    const update = bindFormData(selector, storageIface);
    return async data => {
        extraData = data;
        await update();
    };
}


export function initSettingsForm(selector, options={}) {
    let extraData;
    const store = options.store || settingsStore;
    const storageIface = {
        get: key => (extraData && Object.prototype.hasOwnProperty.call(extraData, key)) ?
            extraData[key] : store.get(key),
        set: (key, value) => store.set(key, value),
    };
    const update = bindFormData(selector, storageIface);
    return async x => {
        extraData = x;
        await update();
    };
}


const _saniEl = document.createElement('span');
export function sanitizeForAttr(raw) {
    _saniEl.setAttribute('clean', raw);
    try {
        return _saniEl.outerHTML.substr(13, _saniEl.outerHTML.length - 22);
    } finally {
        _saniEl.setAttribute('clean', '');
    }
}


export function stripHTML(raw) {
    _saniEl.innerHTML = raw;
    try {
        return _saniEl.textContent;
    } finally {
        _saniEl.textContent = '';
    }
}


export function sanitize(raw) {
    _saniEl.textContent = raw;
    try {
        return _saniEl.innerHTML;
    } finally {
        _saniEl.textContent = '';
    }
}


export function teamBadge(t) {
    if (!t) {
        return '';
    }
    const hue = badgeHue(t);
    return `<span class="badge" style="--hue: ${hue};">${sanitize(t)}</span>`;
}


let _nations, _flags;
export function fmtFlag(code) {
    if (code && _flags && _flags[code]) {
        const nation = sanitizeForAttr(_nations[code]);
        return `<img src="${_flags[code]}" title="${nation}"/>`;
    } else {
        return '-';
    }
}


const _batSyms = [
    'battery_0_bar',
    'battery_1_bar',
    'battery_2_bar',
    'battery_3_bar',
    'battery_4_bar',
    'battery_5_bar',
    'battery_6_bar',
    'battery_full',
];
export function fmtBattery(pct, options={}) {
    let sym;
    let cls;
    if (pct >= 0 && pct <= 1) {
        sym = _batSyms[(pct * _batSyms.length - 0.000001) | 0];
        cls = pct > 0.75 ? 'good' : pct > 0.50 ? 'caution' : pct > 0.25 ? 'warn' : 'alert';
    } else if (pct < 0) {
        sym = 'battery_alert';
        cls = 'alert';
    } else {
        sym = 'battery_unknown';
        cls = 'warn';
    }
    return `<ms class="battery ${cls}" data-pct="${Math.round(pct * 100)}">${sym}</ms>`;
}


export async function initNationFlags() {
    const r = await fetch('deps/src/countries.json');
    if (!r.ok) {
        throw new Error('Failed to get country data: ' + r.status);
    }
    const data = await r.json();
    _nations = Object.fromEntries(data.map(({id, en}) => [id, en]));
    _flags = Object.fromEntries(data.map(({id, alpha2}) => [id, `deps/flags/${alpha2}.png`]));
    // Hack in the custom codes I've seen for UK
    _flags[900] = _flags[826]; // Scotland
    _flags[901] = _flags[826]; // Wales
    _flags[902] = _flags[826]; // England
    _flags[903] = _flags[826]; // Northern Ireland
    return {nations: _nations, flags: _flags};
}


export function eventBadge(label) {
    if (!label) {
        return '';
    }
    const badgeHue = {
        A: 0,
        B: 90,
        C: 180,
        D: 60,
        E: 260,
    }[label];
    return `<span class="badge category" style="--hue: ${badgeHue}deg;">${label}</span>`;
}


export function badgeHue(name) {
    name = name || '';
    let s = 0;
    for (let i = 0; i < name.length; i++) {
        s += name.charCodeAt(i);
    }
    return s % 360;
}


export const rpc = new Proxy({}, {
    get: (_, prop) => (...args) => rpcCall(prop, ...args)
});


rpcCall('getVersion').then(v => Sentry.setTag('version', v));
rpcCall('getSentryAnonId').then(id => Sentry.setUser({id}));
rpcCall('isDEV').then(isDEV => {
    if (!isDEV) {
        report.setSentry(Sentry);
        Sentry.init({
            dsn: "https://df855be3c7174dc89f374ef0efaa6a92@o1166536.ingest.sentry.io/6257001",
            beforeSend: report.beforeSentrySend,
            integrations: arr => arr.filter(x => !['Breadcrumbs', 'TryCatch'].includes(x.name)),
        });
    } else {
        console.debug("Sentry disabled for dev mode");
    }
});

if (window.CSS) {
    CSS.registerProperty({name: '--bg-opacity', syntax: '<number>', inherits: true, initialValue: 1});
}

if (settingsStore) {
    const themeOverride = settingsStore.get('themeOverride');
    if (themeOverride) {
        doc.dataset.theme = themeOverride;
    }
    settingsStore.addEventListener('changed', ev => {
        const changed = ev.data.changed;
        if (changed.has('themeOverride') || changed.has('/theme')) {
            doc.dataset.theme = settingsStore.get('themeOverride') || settingsStore.get('/theme') || '';
        }
    });
}

window.rpc = rpc; // DEBUG
