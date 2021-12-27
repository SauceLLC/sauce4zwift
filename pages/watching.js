/* global sauce */

const L = sauce.locale;

function shortDuration(x) {
    return L.humanDuration(x, {short: true});
}


function makePeakField(period) {
    return {
        value: x => {
            const o = x.stats[`peakPower${period}s`];
            return L.humanNumber(o && o.avg);
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
    const content = document.querySelector('#content');
    const renderer = new sauce.Renderer(content, {fps: 1});
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
            value: x => L.humanNumber(x.power),
            label: () => 'watts',
            key: () => 'Watts',
            unit: () => 'w',
        }, {
            value: x => L.humanNumber(x.stats.powerMax),
            label: () => 'max',
            key: () => 'Max',
            unit: () => 'w',
        }, {
            value: x => L.humanNumber(x.stats.powerAvg),
            label: () => 'avg',
            key: () => 'Avg',
            unit: () => 'w',
        }, {
            value: x => L.humanNumber(x.stats.powerNP),
            label: () => 'np',
            key: () => 'NP',
        }, {
            value: x => L.humanNumber(x.stats.power5s),
            label: () => durations[5] + ' watts',
            key: () => durations[5],
            unit: () => 'w',
        }, {
            value: x => L.humanNumber(x.stats.power30s),
            label: () => durations[30] + ' watts',
            key: () => durations[30],
            unit: () => 'w',
        }, {
            value: x => L.humanNumber(x.stats.power60s),
            label: () => durations[60] + ' watts',
            key: () => durations[60],
            unit: () => 'w',
        }, {
            value: x => L.humanNumber(x.stats.power300s),
            label: () => durations[300] + ' watts',
            key: () => durations[300],
            unit: () => 'w',
        }, {
            value: x => L.humanNumber(x.stats.power1200s),
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
        hrCurEl.textContent = L.humanNumber(watching.heartrate || null);
        hrCurEl.textContent = L.humanNumber(watching.heartrate || null);
        cadCurEl.textContent = L.humanNumber(watching.cadence);
        draftCurEl.textContent = L.humanNumber(watching.draft);

        hrAvgEl.textContent = L.humanNumber(stats.hrSum / stats.hrDur);
        cadAvgEl.textContent = L.humanNumber(stats.cadenceSum / stats.cadenceDur);
        draftAvgEl.textContent = L.humanNumber(stats.draftSum / stats.draftDur);

        hrMaxEl.textContent = L.humanNumber(stats.hrMax || null);
    });

    let athleteId;
    sauce.subscribe('watching', watching => {
        const force = watching.athleteId !== athleteId;
        athleteId = watching.athleteId;
        renderer.setData(watching);
        renderer.render({force});
    });
}

addEventListener('DOMContentLoaded', main);
