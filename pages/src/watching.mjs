import sauce from '../../shared/sauce/index.mjs';
import common from './common.mjs';

const L = sauce.locale;
const H = L.human;
const settingsKey = 'watching-settings-v2';
let settings;
let imperial = !!common.storage.get('/imperialUnits');
L.setImperial(imperial);


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
    settings = common.storage.get(settingsKey, {
        numScreens: 2,
        lockedFields: false,
    });
    const content = document.querySelector('#content');
    const renderers = [];
    const screenTpl = document.querySelector('template#screen');
    let curScreen;
    for (let i = 1; i <= settings.numScreens; i++) {
        const screen = screenTpl.content.cloneNode(true).querySelector('.screen');
        screen.dataset.id = i;
        if (i !== 1) {
            screen.classList.add('hidden');
        } else {
            curScreen = screen;
        }
        content.appendChild(screen);
        const renderer = new common.Renderer(screen, {
            id: `watching-screen-${i}`,
            fps: 2,
            locked: settings.lockedFields,
        });
        renderers.push(renderer);
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
        const draftCurEl = screen.querySelector('.draft .current .value');
        const draftAvgEl = screen.querySelector('.draft .avg .value');
        renderer.addCallback(watching => {
            // legacy stuff...
            const stats = watching.stats;
            draftCurEl.textContent = H.number(watching.draft);
            draftAvgEl.textContent = H.number(stats.draft.avg);
        });
    }
    const prevBtn = document.querySelector('.button-bar .button.prev-screen');
    const nextBtn = document.querySelector('.button-bar .button.next-screen');
    prevBtn.classList.add('disabled');
    if (settings.numScreens === 1) {
        nextBtn.classList.add('disabled');
    }
    prevBtn.addEventListener('click', ev => {
        curScreen.classList.add('hidden');
        curScreen = curScreen.previousElementSibling;
        curScreen.classList.remove('hidden');
        nextBtn.classList.remove('disabled');
        if (Number(curScreen.dataset.id) === 1) {
            prevBtn.classList.add('disabled');
        }
    });
    nextBtn.addEventListener('click', ev => {
        curScreen.classList.add('hidden');
        curScreen = curScreen.nextElementSibling;
        curScreen.classList.remove('hidden');
        prevBtn.classList.remove('disabled');
        if (settings.numScreens === Number(curScreen.dataset.id)) {
            nextBtn.classList.add('disabled');
        }
    });
    document.querySelector('.button-bar .button.reset').addEventListener('click', ev => {
        common.rpc('resetStats');
    });
    document.querySelector('.button-bar .button.lap').addEventListener('click', ev => {
        common.rpc('startLap');
    });
    document.addEventListener('global-settings-updated', ev => {
        if (ev.data.key === '/imperialUnits') {
            imperial = ev.data.data;
            L.setImperial(imperial);
        }
    });
    document.addEventListener('settings-updated', ev => {
        location.reload();
    });
    let athleteId;
    common.subscribe('watching', watching => {
        const force = watching.athleteId !== athleteId;
        athleteId = watching.athleteId;
        for (const x of renderers) {
            x.setData(watching);
            x.render({force});
        }
    });
}


export function settingsMain() {
    common.initInteractionListeners();
    common.initSettingsForm('form', {settingsKey});
}
