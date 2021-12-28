
const isElectron = location.pathname.startsWith('/');  // XXX use better test

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
    const pendingRequests = new Map();
    const subs = new Map();
    let uidInc = 1;

    closeWindow = function() {
        console.warn("XXX unlikely");
        window.close(); // XXX probably won't work
    };

    let errBackoff = 1000;
    let wsp;
    async function connectWebSocket() {
        const ws = new WebSocket('ws://localhost:1080/api/ws');
        ws.addEventListener('message', ev => {
            debugger;
        });
        ws.addEventListener('close', ev => {
            wsp = sleep(errBackoff *= 1.2).then(connectWebSocket).then(ws => {
                debugger; // XXX rebuild existing subs
                return ws;
            });
        });
        return await new Promise((resolve, reject) => {
            ws.addEventListener('error', ev => {
                debugger;
                reject(ev.error);
            });
            ws.addEventListener('open', () => resolve(ws));
            setTimeout(() => reject(new Error('Timeout')), 5000);
        });
    }
    wsp = connectWebSocket();

    subscribe = async function(event, callback) {
        const ws = await wsp;
        const uid = uidInc++;
        ws.send('asdf');
    };
}

function initInteractionListeners() {
    const html = document.documentElement;
    if (!html.classList.contains('options-mode')) {
        window.addEventListener('contextmenu', () =>
            void html.classList.toggle('options-mode'));
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
                if (valueEl) {
                    valueEl.innerHTML = f.value ? f.value(x) : '';
                }
                if (labelEl) {
                    labelEl.innerHTML = f.label ? f.label(x) : '';
                }
                if (keyEl) {
                    keyEl.innerHTML = f.key ? f.key(x) : '';
                }
                if (unitEl) {
                    unitEl.innerHTML = f.unit ? f.unit(x) : '';
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

export default {
    closeWindow,
    electronTrigger,
    subscribe,
    initInteractionListeners,
    Renderer,
};
