/* global sauce */

const L = sauce.locale;
const renderers = [];
let renderAttrs;

let _nextRender;
async function render() {
    if (!_nextRender) {
        _nextRender = new Promise(resolve => {
            requestAnimationFrame(() => {
                for (const cb of renderers) {
                    cb(renderAttrs);
                }
                _nextRender = null;
                resolve();
            });
        });
    }
    return _nextRender;
}


function rotateField(id, fields, cur, defIndex) {
    let i;
    if (!cur) {
        i = localStorage.getItem(id) || defIndex;
    } else {
        i = fields.indexOf(cur) + 1;
        localStorage.setItem(id, i);
    }
    return fields[i % fields.length];
}


async function main() {
    const content = document.querySelector('#content');
    const fieldSpec = {
        mapping: [{
            id: 'social',
            default: 0
        }, {
            id: 'energy',
            default: 1
        }, {
            id: 'speed',
            default: 2
        }],
        fields: [{
            value: x => L.humanNumber(x.rideons),
            key: () => 'Ride Ons',
        }, {
            value: x => L.humanNumber(x.joules / 1000),
            key: () => 'Energy',
            unit: () => 'kJ',
        }, {
            value: x => L.humanNumber(x.speed), // XXX need backend support
            key: () => 'Speed <small>(avg)</small>',
            unit: () => 'kph',
        }, {
            value: x => L.humanNumber(x.stats.powerMax),
            key: () => 'Power <small>(max)</small>',
            unit: () => 'w',
        }, {
            value: x => L.humanNumber(x.stats.powerAvg),
            key: () => 'Power <small>(avg)</small>',
            unit: () => 'w',
        }, {
            value: x => L.humanNumber(x.stats.powerNP),
            key: () => 'NP',
        }, {
            value: x => L.humanNumber(x.stats.power5s),
            key: () => 'Power <small>(5s)</small>',
            unit: () => 'w',
        }, {
            value: x => L.humanNumber(x.stats.power30s),
            key: () => 'Power <small>(30s)</small>',
            unit: () => 'w',
        }],
    };
    for (const x of fieldSpec.mapping) {
        const el = content.querySelector(`[data-field="${x.id}"]`);
        const valueEl = el.querySelector('.value');
        const labelEl = el.querySelector('.label');
        const keyEl = el.querySelector('.key');
        const unitEl = el.querySelector('.unit');
        let f = rotateField(x.id, fieldSpec.fields, null, x.default);
        el.addEventListener('click', ev => {
            f = rotateField(x.id, fieldSpec.fields, f);
            render();
        });
        renderers.push(x => {
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

    content.querySelector('.button.show').addEventListener('click', () => {
        sauce.electronTrigger('showAllWindows');
        document.documentElement.classList.toggle('hidden');
    });
    content.querySelector('.button.hide').addEventListener('click', () => {
        sauce.electronTrigger('hideAllWindows');
        document.documentElement.classList.toggle('hidden');
    });
    content.querySelector('.button.quit').addEventListener('click', () => {
        sauce.electronTrigger('quit');
    });
 
    let lastUpdate = 0;
    sauce.subscribe('watching', watching => {
        renderAttrs = watching;
        const ts = Date.now();
        if (ts - lastUpdate > 500) {
            lastUpdate = ts;
            render();
        }
    });
}

addEventListener('DOMContentLoaded', () => main());
