/*global Sentry*/

import {sleep, beforeSentrySend} from '../../shared/sauce/base.mjs';
import './sentry.js';
Sentry.init({
    dsn: "https://df855be3c7174dc89f374ef0efaa6a92@o1166536.ingest.sentry.io/6257001",
    beforeSend: beforeSentrySend,
});

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
    }

    setLocked(locked) {
        this.locked = locked;
        this._contentEl.classList.toggle('unlocked', !this.locked);
    }

    stop() {
        this.stopping = true;
        clearTimeout(this._scheduledRender);
    }

    addCallback(cb) {
        this._callbacks.push(cb);
    }

    setData(data) {
        this._data = data;
    }

    addRotatingFields(spec) {
        for (const x of spec.mapping) {
            const el = this._contentEl.querySelector(`[data-field="${x.id}"]`);
            const valueEl = el.querySelector('.value');
            const labelEl = el.querySelector('.label');
            const keyEl = el.querySelector('.key');
            const unitEl = el.querySelector('.unit');
            const storageKey = `${this.id}-${x.id}`;
            let idx = localStorage.getItem(storageKey) || x.default;
            let f = spec.fields[idx] || spec.fields[0];
            el.addEventListener('click', ev => {
                if (this.locked) {
                    return;
                }
                idx = (spec.fields.indexOf(f) + 1) % spec.fields.length;
                localStorage.setItem(storageKey, idx);
                f = spec.fields[idx];
                this.render({force: true});
            });
            this.addCallback(x => {
                const value = x !== undefined ? f.value(x) : undefined;
                valueEl.innerHTML = value != null ? value : '';
                if (labelEl) {
                    labelEl.innerHTML = f.label ? f.label(x) : '';
                }
                if (keyEl) {
                    keyEl.innerHTML = f.key ? f.key(x) : '';
                }
                if (unitEl) {
                    unitEl.innerHTML = (value != null && value !== '-' && f.unit) ? f.unit(x) : '';
                }
            });
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
            this._nextRender = new Promise(resolve => {
                const start = performance.now();
                requestAnimationFrame(() => {
                    if (this.stopping) {
                        resolve();
                        return;
                    }
                    for (const cb of this._callbacks) {
                        try {
                            cb(this._data);
                        } catch(e) {
                            console.error(e);
                            Sentry.captureException(e);
                        }
                    }
                    this._lastRender = performance.now();
                    this._lastRenderTime = this._lastRender - start;
                    this._nextRender = null;
                    resolve();
                });
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


function initSettingsForm(selector, options={}) {
    const settingsKey = options.settingsKey;
    const extraData = options.extraData;
    if (!settingsKey) {
        throw new TypeError('settingsKey required');
    }
    const data = {...extraData, ...(storage.get(settingsKey) || {})};
    const form = document.querySelector(selector);
    for (const el of form.querySelectorAll('.display-field[name]')) {
        const name = el.getAttribute('name');
        const val = name.startsWith('/') ? storage.get(name) : data[name];
        el.textContent = val;
    }
    for (const el of form.querySelectorAll('input')) {
        const name = el.name;
        const isGlobal = name.startsWith('/');
        const val = isGlobal ? storage.get(name) : data[name];
        if (el.type === 'checkbox') {
            el.checked = val;
        } else {
            el.value = val == null ? '' : val;
        }
        el.addEventListener('input', ev => {
            const val = (({
                number: () => el.value ? Number(el.value) : undefined,
                checkbox: () => el.checked,
            }[el.type]) || (() => el.value || undefined))();
            if (isGlobal) {
                if (val === undefined) {
                    storage.delete(name);
                } else {
                    storage.set(name, val);
                }
            } else {
                if (val === undefined) {
                    delete data[name];
                } else {
                    data[name] = val;
                }
                storage.set(settingsKey, data);
            }
        });
    }
    for (const el of form.querySelectorAll('select')) {
        const isGlobal = el.name.startsWith('/');
        const name = el.name;
        const val = isGlobal ? storage.get(name) : data[name];
        el.value = val == null ? '' : val;
        el.addEventListener('change', ev => {
            const val = el.value || undefined;
            if (isGlobal) {
                if (val === undefined) {
                    storage.delete(name);
                } else {
                    storage.set(name, val);
                }
            } else {
                if (val === undefined) {
                    delete data[name];
                } else {
                    data[name] = val;
                }
                storage.set(settingsKey, data);
            }
        });
    }
}


export default {
    closeWindow,
    electronTrigger,
    subscribe,
    rpc,
    initInteractionListeners,
    Renderer,
    storage,
    initSettingsForm,
    isElectron,
};


rpc('getVersion').then(v => Sentry.setTag('version', v));
rpc('getSentryAnonId').then(id => Sentry.setUser({id}));

window.rpc = rpc; // XXX DEBUG
