import sauce from '../../shared/sauce/index.mjs';
import common from './common.mjs';

const L = sauce.locale;
const H = L.human;
const settingsKey = 'watching-settings-v1';


function shortDuration(x) {
    return H.duration(x, {short: true});
}


function makePeakPowerField(period) {
    const duration = shortDuration(period);
    return {
        value: x => {
            const o = x.stats.power.peaks[period];
            return H.number(o && o.avg);
        },
        label: x => {
            const label = `peak ${duration}`;
            const o = x.stats.power.peaks[period];
            if (!o.ts) {
                return label;
            }
            const ago = (Date.now() - o.ts) / 1000;
            return `${label}<br/><small>${shortDuration(ago)} ago</small>`;
        },
        key: () => `Peak ${duration}`,
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


function makeSmoothHRField(period) {
    const duration = shortDuration(period);
    return {
        value: x => H.number(x.stats.hr.smooth[period]),
        label: () => duration + ' bpm',
        key: () => duration,
        unit: () => 'bpm',
    };
}


export async function main() {
    common.initInteractionListeners({settingsKey});
    const content = document.querySelector('#content');
    const renderer = new common.Renderer(content, {fps: 1});
    renderer.addRotatingFields({
        mapping: [{
            id: 'power-main',
            default: 0
        }, {
            id: 'power-upper',
            default: 1
        }, {
            id: 'power-lower',
            default: 2
        }],
        fields: [{
            value: x => H.number(x.power),
            label: () => 'watts',
            key: () => 'Watts',
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power.avg),
            label: () => 'avg',
            key: () => 'Avg',
            unit: () => 'w',
        }, {
            value: x => H.number(x.stats.power.max),
            label: () => 'max',
            key: () => 'Max',
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

    renderer.addRotatingFields({
        mapping: [{
            id: 'hr-main',
            default: 0
        }, {
            id: 'hr-upper',
            default: 1
        }, {
            id: 'hr-lower',
            default: 2
        }],
        fields: [{
            value: x => H.number(x.heartrate || null),
            label: () => 'bpm',
            key: () => 'Current',
            unit: () => 'bpm',
        }, {
            value: x => H.number(x.stats.hr.avg),
            label: () => 'avg',
            key: () => 'Avg',
            unit: () => 'bpm',
        }, {
            value: x => H.number(x.stats.hr.max || null),
            label: () => 'max',
            key: () => 'Max',
            unit: () => 'bpm',
        },
            makeSmoothHRField(5),
            makeSmoothHRField(60),
            makeSmoothHRField(300),
        ],
    });

    renderer.addRotatingFields({
        mapping: [{
            id: 'cadence-upper',
            default: 0
        }, {
            id: 'cadence-lower',
            default: 1
        }],
        fields: [{
            value: x => H.number(x.cadence),
            label: () => 'Cadence',
            key: () => 'Current',
            unit: () => 'rpm',
        }, {
            value: x => H.number(x.stats.cadence.avg),
            label: () => 'avg',
            key: () => 'Avg',
            unit: () => 'rpm',
        }, {
            value: x => H.number(x.stats.cadence.max || null),
            label: () => 'max',
            key: () => 'Max',
            unit: () => 'rpm',
        }],
    });

    // legacy
    const draftCurEl = content.querySelector('.draft .current .value');
    const draftAvgEl = content.querySelector('.draft .avg .value');

    renderer.addCallback(watching => {
        // legacy stuff...
        const stats = watching.stats;
        draftCurEl.textContent = H.number(watching.draft);
        draftAvgEl.textContent = H.number(stats.draft.avg);
    });

    let athleteId;
    common.subscribe('watching', watching => {
        const force = watching.athleteId !== athleteId;
        athleteId = watching.athleteId;
        renderer.setData(watching);
        renderer.render({force});
    });
}


export function settingsMain() {
    common.initInteractionListeners();
    common.initSettingsForm('form', {settingsKey});
}
