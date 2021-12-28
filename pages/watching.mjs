import sauce from '../shared/sauce/index.mjs';
import common from './common.mjs';

const L = sauce.locale;
const H = L.human;

function shortDuration(x) {
    return H.duration(x, {short: true});
}


function makePeakField(period) {
    return {
        value: x => {
            const o = x.stats[`peakPower${period}s`];
            return H.number(o && o.avg);
        },
        label: x => {
            const label = `peak ${shortDuration(period)}`;
            const o = x.stats[`peakPower${period}s`];
            if (!o) {
                return label;
            }
            const ago = (Date.now() - o.ts) / 1000;
            return `${label}<br/><small>${shortDuration(ago)} ago</small>`;
        },
        key: () => `Peak ${shortDuration(period)}`,
        unit: () => 'w',
    };
}


async function main() {
    common.initInteractionListeners();
    const content = document.querySelector('#content');
    const renderer = new common.Renderer(content, {fps: 1});
    const durations = {
        5: shortDuration(5),
        30: shortDuration(30),
        60: shortDuration(60),
        300: shortDuration(300),
        1200: shortDuration(1200),
    };
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
            value: x => H.number(x.stats.powerMax),
            label: () => 'max',
            key: () => 'Max',
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.powerAvg),
            label: () => 'avg',
            key: () => 'Avg',
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.powerNP),
            label: () => 'np',
            key: () => 'NP',
        }, {
            value: x => H.number(x.stats.power5s),
            label: () => durations[5] + ' watts',
            key: () => durations[5],
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power30s),
            label: () => durations[30] + ' watts',
            key: () => durations[30],
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power60s),
            label: () => durations[60] + ' watts',
            key: () => durations[60],
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power300s),
            label: () => durations[300] + ' watts',
            key: () => durations[300],
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power1200s),
            label: () => durations[1200] + ' watts',
            key: () => durations[1200],
            unit: () => 'w',
        },
            makePeakField(5),
            makePeakField(60),
            makePeakField(300),
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

        hrAvgEl.textContent = H.number(stats.hrSum / stats.hrDur);
        cadAvgEl.textContent = H.number(stats.cadenceSum / stats.cadenceDur);
        draftAvgEl.textContent = H.number(stats.draftSum / stats.draftDur);

        hrMaxEl.textContent = H.number(stats.hrMax || null);
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
