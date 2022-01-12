import {sleep} from '../shared/sauce/base.mjs';

const isElectron = location.protocol === 'file:';

let closeWindow;
let electronTrigger;
let subscribe;
if (isElectron) {
    electronTrigger = function(name, data) {
        document.dispatchEvent(new CustomEvent('electron-message', {detail: {name, data}}));
    };

    closeWindow = function() {
        electronTrigger('close');
    };

    let subId = 1;
    subscribe = function(event, callback) {
        const domEvent = `sauce-${event}-${subId++}`;
        document.addEventListener(domEvent, ev => void callback(ev.detail));
        electronTrigger('subscribe', {event, domEvent});
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

function initInteractionListeners() {
    const html = document.documentElement;
    if (!html.classList.contains('options-mode')) {
        window.addEventListener('contextmenu', ev => {
            ev.preventDefault();
            void html.classList.toggle('options-mode');
        });
        window.addEventListener('blur', () =>
            void html.classList.remove('options-mode'));
        window.addEventListener('click', ev => {
            if (!ev.target.closest('#titlebar')) {
                html.classList.remove('options-mode');
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
}


class Renderer {
    constructor(contentEl, options={}) {
        this._contentEl = contentEl;
        this._callbacks = [];
        this._data;
        this._nextRender;
        this.options = options;
        this.page = location.pathname.split('/').at(-1);
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
            const storageKey = `${this.page}-${x.id}`;
            let idx = localStorage.getItem(storageKey) || x.default;
            let f = spec.fields[idx] || spec.fields[0];
            el.addEventListener('click', ev => {
                idx = (spec.fields.indexOf(f) + 1) % spec.fields.length;
                localStorage.setItem(storageKey, idx);
                f = spec.fields[idx];
                this.render({force: true});
            });
            this.addCallback(x => {
                const value = f.value(x);
                valueEl.innerHTML = value;
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
        if (!options.force && this.options.fps) {
            const age = performance.now() - (this._lastRender || -Infinity);
            const frameTime = 1000 / this.options.fps;
            if (age < frameTime) {
                if (!this._scheduledRender) {
                    this._scheduledRender = setTimeout(() => {
                        this._scheduledRender = null;
                        this.render();
                    }, Math.ceil(frameTime - age));
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
                requestAnimationFrame(() => {
                    this._lastRender = performance.now();
                    this._nextRender = null;
                    for (const cb of this._callbacks) {
                        cb(this._data);
                    }
                    resolve();
                });
            });
        }
        return this._nextRender;
    }
}


const storage = {
    get: k => {
        const v = localStorage.getItem(k);
        if (typeof v === 'string') {
            return JSON.parse(v);
        } else {
            return null;
        }
    },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};


export default {
    closeWindow,
    electronTrigger,
    subscribe,
    initInteractionListeners,
    Renderer,
    storage,
};
