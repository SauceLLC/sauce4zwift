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


function humanWkg(v, athlete) {
    return H.number(v / (athlete && athlete.weight), {precision: 1, fixed: 1});
}


function makePeakPowerField(period, lap) {
    const duration = shortDuration(period);
    const lapLabel = {
        '-1': 'Lap',
        '-2': 'Last Lap',
    }[lap];
    return {
        value: x => {
            const data = x && x.laps && x.stats && (lap ? x.laps.at(lap) : x.stats);
            const o = data && data.power.peaks[period];
            return H.number(o && o.avg);
        },
        label: x => {
            const label = [`peak ${duration}`, lapLabel].filter(x => x);
            if (!x || !x.laps || !x.stats) {
                return label;
            }
            const data = lap ? x.laps.at(lap) : x.stats;
            const o = data && data.power.peaks[period];
            if (!(o && o.ts)) {
                return label;
            }
            const ago = (Date.now() - o.ts) / 1000;
            const agoText = `${shortDuration(ago)} ago`;
            if (label.length === 1) {
                label.push(agoText);
            } else {
                label[1] += ' | ' + agoText;
            }
            return label;
        },
        key: () => lap ? `Peak ${duration}<tiny> (${lapLabel})</tiny>` : `Peak ${duration}`,
        unit: () => 'w',
    };
}


function makeSmoothPowerField(period) {
    const duration = shortDuration(period);
    return {
        value: x => H.number(x && x.stats && x.stats.power.smooth[period]),
        label: () => duration + ' watts',
        key: () => duration,
        unit: () => 'w',
    };
}


function makeSmoothHRField(period) {
    const duration = shortDuration(period);
    return {
        value: x => H.number(x && x.stats && x.stats.hr.smooth[period]),
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
        screen.querySelector('.page-title').textContent = `${i}`;
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
                value: x => H.number(x && x.power),
                label: () => 'watts',
                key: () => 'Watts',
                unit: () => 'w',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.avg),
                label: () => 'avg',
                key: () => 'Avg',
                unit: () => 'w',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.max),
                label: () => 'max',
                key: () => 'Max',
                unit: () => 'w',
            }, {
                value: x => humanWkg(x && x.power, x && x.athlete),
                label: () => 'w/kg',
                key: () => 'W/kg',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.np),
                label: () => 'np',
                key: () => 'NP',
            }, {
                value: x => H.number(x && x.stats && x.stats.power.tss),
                label: () => 'tss',
                key: () => 'TSS',
            },
                makeSmoothPowerField(5),
                makeSmoothPowerField(15),
                makeSmoothPowerField(60),
                makeSmoothPowerField(300),
                makeSmoothPowerField(1200),
                makePeakPowerField(5),
                makePeakPowerField(15),
                makePeakPowerField(60),
                makePeakPowerField(300),
                makePeakPowerField(1200),
            {
                value: x => H.number(x && x.laps && x.laps.at(-1).power.avg),
                label: () => 'lap avg',
                key: () => 'Lap Avg',
                unit: () => 'w',
            }, {
                value: x => humanWkg(x && x.laps && x.laps.at(-1).power.avg, x && x.athlete),
                label: () => ['lap avg', 'w/kg'],
                key: () => 'Lap Avg',
                unit: () => 'w/kg',
            }, {
                value: x => H.number(x && x.laps && x.laps.at(-1).power.max),
                label: () => 'lap max',
                key: () => 'Lap Max',
                unit: () => 'w',
            }, {
                value: x => humanWkg(x && x.laps && x.laps.at(-1).power.max, x && x.athlete),
                label: () => ['lap max', 'w/kg'],
                key: () => 'Lap Max',
                unit: () => 'w/kg',
            }, {
                value: x => H.number(x && x.laps && x.laps.at(-1).power.np),
                label: () => 'lap np',
                key: () => 'Lap NP',
            },
                makePeakPowerField(5, -1),
                makePeakPowerField(15, -1),
                makePeakPowerField(60, -1),
                makePeakPowerField(300, -1),
                makePeakPowerField(1200, -1),
            {
                value: x => H.number(x && x.laps && x.laps.length > 1 && x.laps.at(-2).power.avg),
                label: () => ['last lap', 'avg'],
                key: () => 'Last Lap',
                unit: () => 'w',
            }, {
                value: x => humanWkg(x && x.laps && x.laps.length > 1 && x.laps.at(-2).power.avg, x && x.athlete),
                label: () => ['last lap', 'avg w/kg'],
                key: () => 'Last Lap',
                unit: () => 'w/kg',
            }, {
                value: x => H.number(x && x.laps && x.laps.length > 1 && x.laps.at(-2).power.max),
                label: () => ['last lap', 'max'],
                key: () => '<small>Last Lap Max</small>',
                unit: () => 'w',
            }, {
                value: x => humanWkg(x && x.laps && x.laps.length > 1 && x.laps.at(-2).power.max, x && x.athlete),
                label: () => ['last lap', 'max w/kg'],
                key: () => '<small>Last Lap Max</small>',
                unit: () => 'w/kg',
            }, {
                value: x => H.number(x && x.laps && x.laps.length > 1 && x.laps.at(-2).power.np),
                label: () => ['last lap', 'np'],
                key: () => '<small>Last Lap NP</small>',
            },
                makePeakPowerField(5, -2),
                makePeakPowerField(15, -2),
                makePeakPowerField(60, -2),
                makePeakPowerField(300, -2),
                makePeakPowerField(1200, -2),
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
                value: x => H.number(x && x.heartrate || null),
                label: () => 'bpm',
                key: () => 'Current',
                unit: () => 'bpm',
            }, {
                value: x => H.number(x && x.stats && x.stats.hr.avg || null), // XXX check the null is required
                label: () => 'avg',
                key: () => 'Avg',
                unit: () => 'bpm',
            }, {
                value: x => H.number(x && x.stats && x.stats.hr.max || null),
                label: () => 'max',
                key: () => 'Max',
                unit: () => 'bpm',
            },
                makeSmoothHRField(5),
                makeSmoothHRField(15),
                makeSmoothHRField(60),
                makeSmoothHRField(300),
                makeSmoothHRField(1200),
            {
                value: x => H.number(x && x.laps && x.laps.at(-1).hr.avg || null), // XXX check if null is req
                label: () => 'lap avg',
                key: () => 'Lap Avg',
                unit: () => 'bpm',
            }, {
                value: x => H.number(x && x.laps && x.laps.at(-1).hr.max || null), // XXX check if null is req
                label: () => 'lap max',
                key: () => 'Lap Max',
                unit: () => 'bpm',
            }, {
                value: x => H.number(x && x.laps && x.laps.length > 1 && x.laps.at(-2).hr.avg || null), // XXX check if null is req
                label: () => ['last lap', 'avg'],
                key: () => 'Last Lap',
                unit: () => 'bpm',
            }, {
                value: x => H.number(x && x.laps && x.laps.at(-1).hr.max || null), // XXX check if null is req
                label: () => ['last lap', 'max'],
                key: () => '<small>Last Lap Max</small>',
                unit: () => 'bpm',
            }],
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
                value: x => H.number(x && x.cadence),
                label: () => 'Cadence',
                key: () => 'Current',
                unit: () => 'rpm',
            }, {
                value: x => H.number(x && x.stats && x.stats.cadence.avg || null),
                label: () => 'avg',
                key: () => 'Avg',
                unit: () => 'rpm',
            }, {
                value: x => H.number(x && x.stats && x.stats.cadence.max || null),
                label: () => 'max',
                key: () => 'Max',
                unit: () => 'rpm',
            }, {
                value: x => H.number(x && x.laps && x.laps.at(-1).cadence.avg || null), // XXX check if null is req
                label: () => 'lap avg',
                key: () => 'Lap Avg',
                unit: () => 'rpm',
            }, {
                value: x => H.number(x && x.laps && x.laps.at(-1).cadence.max || null), // XXX check if null is req
                label: () => 'lap max',
                key: () => 'Lap Max',
                unit: () => 'rpm',
            }, {
                value: x => H.number(x && x.laps && x.laps.length > 1 && x.laps.at(-2).cadence.avg || null), // XXX check if null is req
                label: () => ['last lap', 'avg'],
                key: () => 'Last Lap',
                unit: () => 'rpm',
            }, {
                value: x => H.number(x && x.laps && x.laps.at(-1).cadence.max || null), // XXX check if null is req
                label: () => ['last lap', 'max'],
                key: () => '<small>Last Lap Max</small>',
                unit: () => 'rpm',
            }],
        });
        renderer.addRotatingFields({
            mapping: [{
                id: 'draft-upper',
                default: 0
            }, {
                id: 'draft-lower',
                default: 1
            }],
            fields: [{
                value: x => H.number(x && x.draft),
                label: () => 'Draft',
                key: () => 'Current',
                unit: () => '%',
            }, {
                value: x => H.number(x && x.stats && x.stats.draft.avg),
                label: () => 'avg',
                key: () => 'Avg',
                unit: () => '%',
            }, {
                value: x => H.number(x && x.stats && x.stats.draft.max),
                label: () => 'max',
                key: () => 'Max',
                unit: () => '%',
            }, {
                value: x => H.number(x && x.laps && x.laps.at(-1).draft.avg),
                label: () => 'lap avg',
                key: () => 'Lap Avg',
                unit: () => '%',
            }, {
                value: x => H.number(x && x.laps && x.laps.at(-1).draft.max),
                label: () => 'lap max',
                key: () => 'Lap Max',
                unit: () => '%',
            }, {
                value: x => H.number(x && x.laps && x.laps.length > 1 && x.laps.at(-2).draft.avg),
                label: () => ['last lap', 'avg'],
                key: () => 'Last Lap',
                unit: () => '%',
            }, {
                value: x => H.number(x && x.laps && x.laps.length > 1 && x.laps.at(-2).draft.max),
                label: () => ['last lap', 'max'],
                key: () => '<small>Last Lap Max</small>',
                unit: () => '%',
            }],
        });
        renderer.render();
    }
    const prevBtn = document.querySelector('.button-bar .button.prev-screen');
    const nextBtn = document.querySelector('.button-bar .button.next-screen');
    prevBtn.classList.add('disabled');
    if (settings.numScreens === 1) {
        nextBtn.classList.add('disabled');
    }
    prevBtn.addEventListener('click', ev => {
        if (!curScreen.previousElementSibling) {
            return;
        }
        curScreen.classList.add('hidden');
        curScreen = curScreen.previousElementSibling;
        curScreen.classList.remove('hidden');
        nextBtn.classList.remove('disabled');
        if (Number(curScreen.dataset.id) === 1) {
            prevBtn.classList.add('disabled');
        }
    });
    nextBtn.addEventListener('click', ev => {
        if (!curScreen.nextElementSibling) {
            return;
        }
        curScreen.classList.add('hidden');
        curScreen = curScreen.nextElementSibling;
        curScreen.classList.remove('hidden');
        prevBtn.classList.remove('disabled');
        if (settings.numScreens === Number(curScreen.dataset.id)) {
            nextBtn.classList.add('disabled');
        }
    });
    const resetBtn = document.querySelector('.button-bar .button.reset');
    resetBtn.addEventListener('click', ev => {
        common.rpc('resetStats');
    });
    const lapBtn = document.querySelector('.button-bar .button.lap');
    lapBtn.addEventListener('click', ev => {
        common.rpc('startLap');
    });
    document.addEventListener('keydown', ev => {
        if (ev.ctrlKey && ev.shiftKey) {
            if (ev.key === 'ArrowRight') {
                ev.preventDefault();
                nextBtn.click();
            } else if (ev.key === 'ArrowLeft') {
                ev.preventDefault();
                prevBtn.click();
            } else if (ev.key === 'L') {
                ev.preventDefault();
                lapBtn.click();
            } else if (ev.key === 'R') {
                ev.preventDefault();
                resetBtn.click();
            }
        }
    }, {capture: true});
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


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form', {settingsKey});
}
