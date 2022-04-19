/*global Sentry*/

import {sleep, beforeSentrySend} from '../../shared/sauce/base.mjs';
import './sentry.js';

const isElectron = location.protocol === 'file:';

let closeWindow;
let electronTrigger;
let subscribe;
let rpc;


function makeRPCError(errResp) {
    const e = new Error(`${errResp.error.name}: ${errResp.error.message}`);
    e.stack = errResp.error.stack; // XXX merge with local stack too.
    return e;
}


// Sentry is supposed to throttle, but I'm seeing thousands of events in some cases so I doubt it.
const _capturedErrors = new Set();
export function captureErrorOnce(e) {
    const sig = [e.name, e.message, e.stack].join();
    if (_capturedErrors.has(sig)) {
        console.warn('Sentry error capture (throttled):', e);
        return;
    }
    _capturedErrors.add(sig);
    console.error('Sentry error capture:', e);
    Sentry.captureException(e);
}


if (isElectron) {
    document.documentElement.classList.add('electron-mode');
    electronTrigger = function(name, data) {
        document.dispatchEvent(new CustomEvent('electron-message', {detail: {name, data}}));
    };

    closeWindow = function() {
        electronTrigger('close');
    };

    let evId = 1;
    subscribe = function(event, callback) {
        const domEvent = `sauce-${event}-${evId++}`;
        document.addEventListener(domEvent, ev => void callback(ev.detail));
        electronTrigger('subscribe', {event, domEvent});
    };

    rpc = async function(name, ...args) {
        const domEvent = `sauce-${name}-${evId++}`;
        const resp = new Promise((resolve, reject) => {
            document.addEventListener(domEvent, ev => {
                const resp = ev.detail;
                if (resp.success) {
                    resolve(resp.value);
                } else {
                    reject(makeRPCError(resp));
                }
            }, {once: true});
        });
        document.dispatchEvent(new CustomEvent('electron-rpc', {detail: {domEvent, name, args}}));
        return await resp;
    };
    document.documentElement.addEventListener('click', async ev => {
        const link = ev.target.closest('a[external][href]');
        if (link) {
            ev.preventDefault();
            await rpc('openExternalLink', link.href);
        }
    });
} else {
    document.documentElement.classList.add('browser-mode');
    const respHandlers = new Map();
    const subs = [];
    let uidInc = 1;

    closeWindow = function() {
        console.warn("XXX unlikely");
        window.close(); // XXX probably won't work
    };

    let errBackoff = 500;
    let wsp;
    const connectWebSocket = async function() {
        const ws = new WebSocket(`ws://${location.host}/api/ws`);
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
                for (const {event, callback} of subs) {
                    _subscribe(ws, event, callback);
                }
                resolve(ws);
            });
        });
    };
    wsp = connectWebSocket();

    subscribe = async function(event, callback) {
        const ws = await wsp;
        await _subscribe(ws, event, callback);
        subs.push({event, callback});
    };

    rpc = async function(name, ...args) {
        const r = await fetch('/api/rpc', {
            method: 'POST',
            headers: {"content-type": 'application/json'},
            body: JSON.stringify({
                name,
                args
            })
        });
        const resp = await r.json();
        if (resp.success) {
            return resp.value;
        } else {
            throw makeRPCError(resp);
        }
    };

    const _subscribe = function(ws, event, callback) {
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
                }
            }
        }));
        return p;
    };
}

function initInteractionListeners(options={}) {
    const html = document.documentElement;
    if (!html.classList.contains('settings-mode')) {
        window.addEventListener('contextmenu', ev => {
            ev.preventDefault();
            void html.classList.toggle('settings-mode');
        });
        window.addEventListener('blur', () =>
            void html.classList.remove('settings-mode'));
        window.addEventListener('click', ev => {
            if (!ev.target.closest('#titlebar')) {
                html.classList.remove('settings-mode');
            }
        });
    }
    const close = document.querySelector('#titlebar .button.close');
    if (close) {
        close.addEventListener('click', ev => (void closeWindow()));
    }
    for (const el of document.querySelectorAll('.button[data-url]')) {
        el.addEventListener('click', ev => location.assign(el.dataset.url));
    }
    for (const el of document.querySelectorAll('.button[data-ext-url]')) {
        el.addEventListener('click', ev => window.open(el.dataset.extUrl, '_blank', 'popup,width=999,height=333'));
    }
    if (options.settingsKey) {
        window.addEventListener('storage', ev => {
            if (ev.key === options.settingsKey) {
                const event = new Event('settings-updated');
                event.data = JSON.parse(ev.newValue);
                document.dispatchEvent(event);
            } else if (ev.key.startsWith('/')) {
                const event = new Event('global-settings-updated');
                event.data = {
                    key: ev.key,
                    data: JSON.parse(ev.newValue)
                };
                document.dispatchEvent(event);
            }
        });
    }
}


class Renderer {
    constructor(contentEl, options={}) {
        this._contentEl = contentEl;
        this._callbacks = [];
        this._data;
        this._nextRender;
        this._lastRenderTime = 0;
        this.locked = !!options.locked;
        contentEl.classList.toggle('unlocked', !this.locked);
        this.stopping = false;
        this.fps = options.fps || 1;
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

    rotateField(id, dir=1) {
        if (this.locked) {
            return;
        }
        const field = this.fields.get(id);
        let idx = (field.available.indexOf(field.active) + dir) % field.available.length;
        if (idx < 0) {
            idx = field.available.length - 1;
        }
        localStorage.setItem(field.storageKey, idx);
        field.active = field.available[idx];
        console.debug('Switching field', id, idx);
        this.render({force: true});
    }

    addRotatingFields(spec) {
        for (const x of spec.mapping) {
            const id = x.id;
            const el = this._contentEl.querySelector(`[data-field="${x.id}"]`);
            const storageKey = `${this.id}-${id}`;
            this.fields.set(id, {
                id,
                storageKey,
                available: spec.fields,
                active: spec.fields[localStorage.getItem(storageKey) || x.default] || spec.fields[0],
                valueEl: el.querySelector('.value'),
                labelEl: el.querySelector('.label'),
                subLabelEl: el.querySelector('.sub-label'),
                keyEl: el.querySelector('.key'),
                unitEl: el.querySelector('.unit'),
            });
            el.setAttribute('tabindex', 0);
            el.addEventListener('click', ev => this.rotateField(id));
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
                requestAnimationFrame(() => {
                    if (this.stopping) {
                        resolve();
                        return;
                    }
                    for (const field of this.fields.values()) {
                        let value = '';
                        try {
                            value = field.active.value(this._data);
                        } catch(e) {
                            captureErrorOnce(e);
                        }
                        field.valueEl.innerHTML = value != null && !Number.isNaN(value) ? value : '';
                        if (field.labelEl) {
                            let labels = '';
                            try {
                                labels = field.active.label ? field.active.label(this._data) : '';
                            } catch(e) {
                                captureErrorOnce(e);
                            }
                            if (Array.isArray(labels)) {
                                field.labelEl.innerHTML = labels[0];
                                if (field.subLabelEl) {
                                    field.subLabelEl.innerHTML = labels.length > 1 ? labels[1] : '';
                                }
                            } else {
                                field.labelEl.innerHTML = labels;
                                field.subLabelEl.innerHTML = '';
                            }
                        }
                        if (field.keyEl) {
                            let key = '';
                            try {
                                key = field.active.key ? field.active.key(this._data) : '';
                            } catch(e) {
                                captureErrorOnce(e);
                            }
                            field.keyEl.innerHTML = key;
                        }
                        if (field.unitEl) {
                            let unit = '';
                            try {
                                unit = (value != null && value !== '-' && field.active.unit) ?
                                    field.active.unit(this._data) : '';
                            } catch(e) {
                                captureErrorOnce(e);
                            }
                            field.unitEl.innerHTML = unit;
                        }
                    }
                    for (const cb of this._callbacks) {
                        try {
                            cb(this._data);
                        } catch(e) {
                            captureErrorOnce(e);
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


const storage = {
    get: (k, def) => {
        const v = localStorage.getItem(k);
        if (typeof v !== 'string') {
            if (def !== undefined) {
                storage.set(k, def);
            }
            return def;
        } else {
            return JSON.parse(v);
        }
    },
    set: (k, v) => {
        if (v === undefined) {
            localStorage.removeItem(k);
        } else {
            const json = JSON.stringify(v);
            if (typeof json !== 'string') {
                throw new TypeError('Non JSON serializable value');
            }
            localStorage.setItem(k, json);
        }
    },
    delete: k => {
        localStorage.removeItem(k);
    }
};


async function bindFormData(selector, storageIface, options={}) {
    const form = document.querySelector(selector);
    for (const el of form.querySelectorAll('.display-field[name]')) {
        const name = el.getAttribute('name');
        el.textContent = await storageIface.get(name);
    }
    for (const el of form.querySelectorAll('input')) {
        const name = el.name;
        const val = await storageIface.get(name);
        if (el.type === 'checkbox') {
            el.checked = val;
        } else {
            el.value = val == null ? '' : val;
        }
        const dependsOn = el.dataset.dependsOn;
        if (dependsOn) {
            const depEl = form.querySelector(`[name="${dependsOn.replace(/^!/, '')}"]`);
            el.disabled = dependsOn.startsWith('!') ? !depEl.checked : depEl.checked;
            el.closest('label').classList.toggle('disabled', el.disabled);
            if (!depEl.dependants) {
                depEl.dependants = [];
            }
            depEl.dependants.push(el);
        }
        el.addEventListener('input', async ev => {
            const val = (({
                number: () => el.value ? Number(el.value) : undefined,
                checkbox: () => el.checked,
            }[el.type]) || (() => el.value || undefined))();
            if (el.dependants) {
                for (const x of el.dependants) {
                    const d = x.dataset.dependsOn;
                    x.disabled = d.startsWith('!') ? !el.checked : el.checked;
                    x.closest('label').classList.toggle('disabled', x.disabled);
                }
            }
            await storageIface.set(name, val);
        });
    }
    for (const el of form.querySelectorAll('select')) {
        const name = el.name;
        const val = await storageIface.get(name);
        el.value = val == null ? '' : val;
        el.addEventListener('change', async ev => {
            const val = el.value || undefined;
            await storageIface.set(name, val);
        });
    }
}


async function initAppSettingsForm(selector, options={}) {
    const storageIface = {
        get: async name => {
            return await rpc('getAppSetting', name);
        },
        set: async (name, value) => {
            return await rpc('setAppSetting', name, value);
        },
    };
    await bindFormData(selector, storageIface);
}


async function initSettingsForm(selector, options={}) {
    const settingsKey = options.settingsKey;
    const extraData = options.extraData;
    if (!settingsKey) {
        throw new TypeError('settingsKey required');
    }
    const storageData = storage.get(settingsKey) || {};
    const allData = {...storageData, ...extraData};
    const storageIface = {
        get: name => {
            const isGlobal = name.startsWith('/');
            return isGlobal ? storage.get(name) : allData[name];
        },
        set: (name, value) => {
            const isGlobal = name.startsWith('/');
            if (isGlobal) {
                if (value === undefined) {
                    storage.delete(name);
                } else {
                    storage.set(name, value);
                }
            } else {
                if (value === undefined) {
                    delete storageData[name];
                } else {
                    storageData[name] = value;
                }
                storage.set(settingsKey, storageData);
            }
        },
    };
    await bindFormData(selector, storageIface);
}
 

export default {
    closeWindow,
    subscribe,
    rpc,
    initInteractionListeners,
    Renderer,
    storage,
    initAppSettingsForm,
    initSettingsForm,
    isElectron,
};


rpc('getVersion').then(v => Sentry.setTag('version', v));
rpc('getSentryAnonId').then(id => Sentry.setUser({id}));
rpc('appIsPackaged').then(packaged => {
    if (packaged) {
        Sentry.init({
            dsn: "https://df855be3c7174dc89f374ef0efaa6a92@o1166536.ingest.sentry.io/6257001",
            beforeSend: beforeSentrySend,
            integrations: arr => arr.filter(x => !['Breadcrumbs', 'TryCatch'].includes(x.name)),
        });
    } else {
        console.debug("Sentry disabled for unpackaged app");
    }
});

window.rpc = rpc; // XXX DEBUG
