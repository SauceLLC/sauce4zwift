import sauce from '../shared/sauce/index.mjs';
import common from './common.mjs';

window.sauce = sauce;

const L = sauce.locale;
const H = L.human;

function shortDuration(x) {
    return H.duration(x, {short: true});
}


function makePeakPowerField(period) {
    return {
        value: x => {
            const o = x.stats.power.peaks[period];
            return H.number(o && o.avg);
        },
        label: x => {
            const label = `peak ${shortDuration(period)}`;
            const o = x.stats.power.peaks[period];
            if (!o.ts) {
                return label;
            }
            const ago = (Date.now() - o.ts) / 1000;
            return `${label}<br/><small>${shortDuration(ago)} ago</small>`;
        },
        key: () => `Peak ${shortDuration(period)}`,
        unit: () => 'w',
    };
}


function makeSmoothPowerField(period) {
    const duration = shortDuration(period);
    return {
        value: x => H.number(x.stats.power.smooth[period]),
        label: () => duration + ' watts',
        key: () => duration,
        unit: () => 'w',
    };
}


async function main() {
    common.initInteractionListeners();
    const content = document.querySelector('#content');
    const renderer = new common.Renderer(content, {fps: 1});
    renderer.addRotatingFields({
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
            value: x => H.number(x.power),
            label: () => 'watts',
            key: () => 'Watts',
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power.max),
            label: () => 'max',
            key: () => 'Max',
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power.avg),
            label: () => 'avg',
            key: () => 'Avg',
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power.np),
            label: () => 'np',
            key: () => 'NP',
        },
            makeSmoothPowerField(5),
            makeSmoothPowerField(60),
            makeSmoothPowerField(300),
            makeSmoothPowerField(1200),
            makePeakPowerField(5),
            makePeakPowerField(60),
            makePeakPowerField(300),
            makePeakPowerField(1200),
        ],
    });

    // legacy
    const hrCurEl = content.querySelector('.hr .current .value');
    const cadCurEl = content.querySelector('.cadence .current .value');
    const draftCurEl = content.querySelector('.draft .current .value');
    const hrAvgEl = content.querySelector('.hr .avg .value');
    const cadAvgEl = content.querySelector('.cadence .avg .value');
    const draftAvgEl = content.querySelector('.draft .avg .value');
    const hrMaxEl = content.querySelector('.hr .max .value');

    renderer.addCallback(watching => {
        // legacy stuff...
        const stats = watching.stats;
        hrCurEl.textContent = H.number(watching.heartrate || null);
        hrCurEl.textContent = H.number(watching.heartrate || null);
        cadCurEl.textContent = H.number(watching.cadence);
        draftCurEl.textContent = H.number(watching.draft);

        hrAvgEl.textContent = H.number(stats.hr.avg);
        cadAvgEl.textContent = H.number(stats.cadence.avg);
        draftAvgEl.textContent = H.number(stats.draft.avg);

        hrMaxEl.textContent = H.number(stats.hr.max || null);
    });

    let athleteId;
    common.subscribe('watching', watching => {
        const force = watching.athleteId !== athleteId;
        athleteId = watching.athleteId;
        renderer.setData(watching);
        renderer.render({force});
    });
}

addEventListener('DOMContentLoaded', main);
