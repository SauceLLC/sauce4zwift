import {sleep} from '../shared/sauce/base.mjs';

const html = document.documentElement;
const isElectron = location.pathname.startsWith('/');

L.thinSpace = '\u202f';

L.humanDuration = function(elapsed, options={}) {
    const min = 60;
    const hour = min * 60;
    const day = hour * 24;
    const week = day * 7;
    const year = day * 365;
    const units = [
        ['year', year],
        ['week', week],
        ['day', day],
        ['hour', hour],
        ['min', min],
        ['sec', 1]
    ].filter(([, period]) =>
        (options.maxPeriod ? period <= options.maxPeriod : true) &&
        (options.minPeriod ? period >= options.minPeriod : true));
    const stack = [];
    const precision = options.precision || 1;
    elapsed = Math.round(elapsed / precision) * precision;
    let i = 0;
    const short = options.short;
    for (let [key, period] of units) {
        i++;
        if (precision > period) {
            break;
        }
        if (elapsed >= period || (!stack.length && i === units.length)) {
            if (!short && (elapsed >= 2 * period || elapsed < period)) {
                key += 's';
            }
            if (short) {
                key = key[0];
            }
            const suffix = options.html ? `<abbr class="unit">${key}</abbr>` : key;
            let val;
            if (options.digits && units[units.length - 1][1] === period) {
                val = L.humanNumber(elapsed / period, options.digits);
            } else {
                val = L.humanNumber(Math.floor(elapsed / period));
            }
            stack.push(`${val}${L.thinSpace}${suffix}`);
            elapsed %= period;
        }
    }
    return stack.slice(0, 2).join(options.seperator || ', ');
};

L.humanNumber = function(value, precision=0) {
    if (value == null || value === '') {
        return '-';
    }
    const n = Number(value);
    if (isNaN(n)) {
        console.warn("Value is not a number:", value);
        return '-';
    }
    if (precision === null) {
        return n.toLocaleString();
    } else if (precision === 0) {
        return Math.round(n).toLocaleString();
    } else {
        return Number(n.toFixed(precision)).toLocaleString();
    }
};


L.humanDistance = function(value, precision) {
    if (value > 1000) {
        if (precision == null) {
            precision = value > 50000 ? 0 : 1;
        }
        return `${L.humanNumber(value / 1000, precision)}${L.thinSpace}km`;
    } else {
        return `${L.humanNumber(value, precision)}${L.thinSpace}m`;
    }
};

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

addEventListener('DOMContentLoaded', () => {
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
});


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
    Renderer,
};
