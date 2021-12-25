/* global sauce */

const L = sauce.locale;

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


function makePeakField(period) {
    return {
        value: x => {
            const o = x.stats[`peakPower${period}s`];
            return L.humanNumber(o && o.avg);
        },
        label: x => {
            const label = `peak ${sauce.locale.humanDuration(period, {short: true})}`;
            const o = x.stats[`peakPower${period}s`];
            if (!o) {
                return label;
            }
            const ago = (Date.now() - o.ts) / 1000;
            return `${label}<br/><small>${sauce.locale.humanDuration(ago)} ago</small>`;
        },
        key: () => `Peak ${sauce.locale.humanDuration(period, {short: true})}`
    };
}


async function main() {
    const content = document.querySelector('#content');
    const hrCurEl = content.querySelector('.hr .current .value');
    const cadCurEl = content.querySelector('.cadence .current .value');
    const draftCurEl = content.querySelector('.draft .current .value');
    const hrAvgEl = content.querySelector('.hr .avg .value');
    const cadAvgEl = content.querySelector('.cadence .avg .value');
    const draftAvgEl = content.querySelector('.draft .avg .value');
    const hrMaxEl = content.querySelector('.hr .max .value');
    const powerSpec = {
        mapping: [{
            id: 'power-main',
            default: 0
        }, {
            id: 'power-lower',
            default: 1
        }, {
            id: 'power-upper',
            default: 2
        }],
        fields: [{
            value: x => L.humanNumber(x.power),
            label: () => 'watts',
            key: () => 'Watts',
        }, {
            value: x => L.humanNumber(x.stats.powerMax),
            label: () => 'max',
            key: () => 'Max',
        }, {
            value: x => L.humanNumber(x.stats.powerAvg),
            label: () => 'avg',
            key: () => 'Avg',
        }, {
            value: x => L.humanNumber(x.stats.powerNP),
            label: () => 'np',
            key: () => 'NP',
        }, {
            value: x => L.humanNumber(x.stats.power5s),
            label: () => '5s watts',
            key: () => '5s',
        }, {
            value: x => L.humanNumber(x.stats.power30s),
            label: () => '30s watts',
            key: () => '30s',
        },
            makePeakField(5),
            makePeakField(60),
            makePeakField(300),
        ],
    };
    const renderers = [];
    for (const x of powerSpec.mapping) {
        const el = content.querySelector(`[data-field="${x.id}"]`);
        const valueEl = el.querySelector('.value');
        const labelEl = el.querySelector('.label');
        const keyEl = el.querySelector('.key');
        let f = rotateField(x.id, powerSpec.fields, null, x.default);
        el.addEventListener('click', ev => void (f = rotateField(x.id, powerSpec.fields, f)));
        renderers.push(x => {
            if (valueEl) {
                valueEl.innerHTML = f.value(x);
            }
            if (labelEl) {
                labelEl.innerHTML = f.label(x);
            }
            if (keyEl) {
                keyEl.innerHTML = f.key(x);
            }
        });
    }
    sauce.subscribe('watching', watching => {
        const stats = watching.stats;
        for (const cb of renderers) {
            cb(watching);
        }

        hrCurEl.textContent = L.humanNumber(watching.heartrate || null);
        cadCurEl.textContent = L.humanNumber(watching.cadence);
        draftCurEl.textContent = L.humanNumber(watching.draft);

        hrAvgEl.textContent = L.humanNumber(stats.hrSum / stats.hrDur);
        cadAvgEl.textContent = L.humanNumber(stats.cadenceSum / stats.cadenceDur);
        draftAvgEl.textContent = L.humanNumber(stats.draftSum / stats.draftDur);

        hrMaxEl.textContent = L.humanNumber(stats.hrMax || null);
    });
}

addEventListener('DOMContentLoaded', () => main());
