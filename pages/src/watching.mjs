import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as charts from './charts.mjs';
import * as echarts from '../deps/src/echarts.mjs';
import {theme} from './echarts-sauce-theme.mjs';

echarts.registerTheme('sauce', theme);

const L = sauce.locale;
const H = L.human;
const settingsKey = 'watching-settings-v3';
const maxLineChartLen = 60;
const colors = {
    power: '#46f',
    hr: '#e22',
    pace: '#4e3',
};

let settings;
let imperial = !!common.storage.get('/imperialUnits');
L.setImperial(imperial);

const chartRefs = new Set();

function resizeCharts() {
    for (const r of chartRefs) {
        const c = r.deref();
        if (!c) {
            chartRefs.delete(r);
        } else {
            c.resize();
        }
    }
}

addEventListener('resize', resizeCharts);


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


function createStatHistoryChart(el, sIndex) {
    const lineChart = echarts.init(el, 'sauce', {
        renderer: location.search.includes('svg') ? 'svg' : 'canvas',
    });
    const powerSoftDomain = [0, 700];
    const hrSoftDomain = [70, 190];
    const paceSoftDomain = [0, 100];
    const visualMapCommon = {
        show: false,
        type: 'continuous',
        hoverLink: false,
    };
    const options = {
        color: [colors.power, colors.hr, colors.pace],
        visualMap: [{
            ...visualMapCommon,
            seriesIndex: 0,
            min: powerSoftDomain[0],
            max: powerSoftDomain[1],
            inRange: {
                colorAlpha: [0.4, 1],
            },
        }, {
            ...visualMapCommon,
            seriesIndex: 1,
            min: hrSoftDomain[0],
            max: hrSoftDomain[1],
            inRange: {
                colorAlpha: [0.1, 0.7],
            },
        }, {
            ...visualMapCommon,
            seriesIndex: 2,
            min: paceSoftDomain[0],
            max: paceSoftDomain[1],
            inRange: {
                colorAlpha: [0.1, 0.8],
            },
        }],
        grid: {
            top: 20,
            left: 24,
            right: 24,
            bottom: 2,
        },
        legend: {
            show: false, // need to enable actions.
        },
        tooltip: {
            trigger: 'axis',
        },
        xAxis: [{
            show: false,
            data: Array.from(new Array(maxLineChartLen)).map((x, i) => i),
        }],
        yAxis: [{
            show: false,
            min: powerSoftDomain[0],
            max: x => Math.max(powerSoftDomain[1], x.max),
        }, {
            show: false,
            min: x => Math.min(hrSoftDomain[0], x.min),
            max: x => Math.max(hrSoftDomain[1], x.max),
        }, {
            show: false,
            min: x => Math.min(paceSoftDomain[0], x.min),
            max: x => Math.max(paceSoftDomain[1], x.max),
        }],
        series: [{
            id: 'power',
            name: 'Power',
            type: 'line',
            z: 4,
            showSymbol: false,
            emphasis: {disabled: true},
            tooltip: {
                valueFormatter: x => H.power(x, {suffix: true}),
            },
            areaStyle: {},
            lineStyle: {
                color: colors.power,
            }
        }, {
            id: 'hr',
            name: 'HR',
            type: 'line',
            z: 3,
            showSymbol: false,
            emphasis: {disabled: true},
            yAxisIndex: 1,
            tooltip: {
                valueFormatter: x => H.number(x) + 'bpm'
            },
            areaStyle: {},
            lineStyle: {
                color: colors.hr,
            }
        }, {
            id: 'pace',
            name: 'Pace',
            type: 'line',
            z: 2,
            showSymbol: false,
            emphasis: {disabled: true},
            yAxisIndex: 2,
            tooltip: {
                valueFormatter: x => H.pace(x, {precision: 0, suffix: true}),
            },
            areaStyle: {},
            lineStyle: {
                color: colors.pace,
            }
        }]
    };
    lineChart.setOption(options);
    new charts.SauceLegend({
        el: el.nextElementSibling,
        chart: lineChart,
        hiddenStorageKey: `watching-hidden-graph-p${sIndex}`,
    });
    chartRefs.add(new WeakRef(lineChart));
    return lineChart;
}

const sectionSpecs = {
    'large-data-fields': {
        title: 'Data Fields (large)',
        groups: 1,
    },
    'data-fields': {
        title: 'Data Fields',
        groups: 1,
    },
    'split-data-fields': {
        title: 'Split Data Fields',
        groups: 2,
    },
};

const groupSpecs = {
    power: {
        title: 'Power',
        backgroundImage: 'url(../images/fa/bolt-duotone.svg)',
        fields: [{
            value: x => H.number(x && x.state.power),
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
           value: x => humanWkg(x && x.state.power, x && x.athlete),
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
    },
    hr: {
        title: 'Heart Rate',
        backgroundImage: 'url(../images/fa/heartbeat-duotone.svg)',
        fields: [{
            value: x => H.number(x && x.state.heartrate || null),
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
    },
    cadence: {
        title: 'Cadence',
        backgroundImage: 'url(../images/fa/solar-system-duotone.svg)',
        fields: [{
            value: x => H.number(x && x.state.cadence),
            label: () => 'rpm',
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
    },
    draft: {
        title: 'Draft',
        backgroundImage: 'url(../images/fa/wind-duotone.svg)',
        fields: [{
            value: x => H.number(x && x.state.draft),
            label: () => '%',
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
    },
};


async function getTpl(name) {
    return await sauce.template.getTemplate(`templates/${name}.html.tpl`);
}


export async function main() {
    common.initInteractionListeners();
    settings = common.storage.get(settingsKey, {
        lockedFields: false,
        screens: [{
            id: 'default-screen-1',
            sections: [{
                type: 'large-data-fields',
                id: 'default-large-data-fields',
                groups: [{
                    id: 'default-power',
                    type: 'power',
                }],
            }, {
                type: 'data-fields',
                id: 'default-data-fields',
                groups: [{
                    type: 'hr',
                    id: 'default-hr',
                }],
            }, {
                type: 'split-data-fields',
                id: 'default-split-data-fields',
                groups: [{
                    type: 'cadence',
                    id: 'default-cadence',
                }, {
                    type: 'draft',
                    id: 'default-draft',
                }],
            }],
        }],
    });
    const content = document.querySelector('#content');
    const renderers = [];
    let curScreen;
    const layoutTpl = await getTpl('watching-screen-layout');
    for (const [sIndex, screen] of settings.screens.entries()) {
        const screenEl = (await layoutTpl({
            screen,
            sIndex,
            groupSpecs,
            sectionSpecs
        })).querySelector('.screen');
        if (sIndex) {
            screenEl.classList.add('hidden');
        } else {
            curScreen = screenEl;
        }
        content.appendChild(screenEl);
        const renderer = new common.Renderer(screenEl, {
            id: screen.id,
            fps: 2,
            locked: settings.lockedFields,
        });
        for (const groupEl of screenEl.querySelectorAll('[data-group-id]')) {
            const mapping = [];
            for (const [i, fieldEl] of groupEl.querySelectorAll('[data-field]').entries()) {
                const id = fieldEl.dataset.field;
                mapping.push({id, default: Number(fieldEl.dataset.default || i)});
            }
            renderer.addRotatingFields({
                el: groupEl,
                mapping,
                fields: groupSpecs[groupEl.dataset.groupType].fields,
            });
        }
        renderers.push(renderer);
        /*
        const chartData = {
            pace: [],
            hr: [],
            power: [],
        };
        let dataCount = 0;
        const lineChart = createStatHistoryChart(screen.querySelector('.chart-holder.ec'), sIndex);
        let lastRender = 0;
        renderer.addCallback(data => {
            const now = Date.now();
            if (now - lastRender < 900) {
                return;
            }
            lastRender = now;
            if (data) {
                chartData.power.push(data.state.power || 0);
                chartData.hr.push(data.state.heartrate || 0);
                chartData.pace.push(data.state.speed || 0);
                if (chartData.power.length > maxLineChartLen) {
                    chartData.power.shift();
                    chartData.hr.shift();
                    chartData.pace.shift();
                }
            }
            const maxPower = sauce.data.max(chartData.power);
            const maxPIndex = chartData.power.indexOf(maxPower);
            lineChart.setOption({
                xAxis: [{
                    data: [...sauce.data.range(maxLineChartLen)].map(i =>
                        (dataCount > maxLineChartLen ? dataCount - maxLineChartLen : 0) + i),
                }],
                series: [{
                    data: chartData.power,
                    markLine: {
                        symbol: 'none',
                        data: [{
                            name: 'Max',
                            xAxis: maxPIndex,
                            label: {
                                formatter: x => H.power(chartData.power[x.value], {suffix: true})
                            },
                            emphasis: {
                                disabled: true,
                            },
                        }],
                    },
                }, {
                    data: chartData.hr,
                }, {
                    data: chartData.pace,
                }]
            });
        });
        */
        renderer.render();
    }
    common.storage.set(settingsKey, settings);
    const prevBtn = document.querySelector('.button-bar .button.prev-screen');
    const nextBtn = document.querySelector('.button-bar .button.next-screen');
    prevBtn.classList.add('disabled');
    if (settings.screens.length === 1) {
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
        resizeCharts();
        if (Number(curScreen.dataset.index) === 0) {
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
        resizeCharts();
        if (settings.screens.length === Number(curScreen.dataset.index) + 1) {
            nextBtn.classList.add('disabled');
        }
    });
    const resetBtn = document.querySelector('.button-bar .button.reset');
    resetBtn.addEventListener('click', ev => {
        common.rpc.resetStats();
    });
    const lapBtn = document.querySelector('.button-bar .button.lap');
    lapBtn.addEventListener('click', ev => {
        common.rpc.startLap();
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
    common.storage.addEventListener('globalupdate', ev => {
        if (ev.data.key === '/imperialUnits') {
            imperial = ev.data.value;
            L.setImperial(imperial);
        }
    });
    common.storage.addEventListener('update', ev => {
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


async function initScreenSettings() {
    const layoutTpl = await getTpl('watching-screen-layout');
    let sIndex = 0;
    const activeScreenEl = document.querySelector('main .active-screen');
    const sIndexEl = document.querySelector('.sIndex');
    const sLenEl = document.querySelector('.sLen');
    const prevBtn = document.querySelector('main header .button[data-action="prev"]');
    const nextBtn = document.querySelector('main header .button[data-action="next"]');
    const delBtn = document.querySelector('main header .button[data-action="delete"]');

    async function renderScreen() {
        sIndexEl.textContent = sIndex + 1;
        const sLen = settings.screens.length;
        sLenEl.textContent = sLen;
        const screen = settings.screens[sIndex];
        const screenEl = (await layoutTpl({
            screen,
            sIndex,
            groupSpecs,
            sectionSpecs,
            configuring: true
        })).querySelector('.screen');
        activeScreenEl.innerHTML = '';
        activeScreenEl.appendChild(screenEl);
        prevBtn.classList.toggle('disabled', sIndex === 0);
        nextBtn.classList.toggle('disabled', sIndex === sLen - 1);
        delBtn.classList.toggle('disabled', sLen === 1);
    }

    document.querySelector('main header .button-group').addEventListener('click', ev => {
        const btn = ev.target.closest('.button-group .button');
        const action = btn && btn.dataset.action;
        if (!action) {
            return;
        }
        if (action === 'add') {
            settings.screens.push({
                id: `user-section-${settings.screens.length +1}-${Date.now()}`,
                sections: []
            });
            common.storage.set(settingsKey, settings);
            sIndex = settings.screens.length - 1;
            renderScreen();
        } else if (action === 'next') {
            sIndex++;
            renderScreen();
        } else if (action === 'prev') {
            sIndex--;
            renderScreen();
        } else if (action === 'delete') {
            settings.screens.splice(sIndex, 1);
            sIndex = Math.max(0, sIndex -1);
            common.storage.set(settingsKey, settings);
            renderScreen();
        }
    });
    document.querySelector('main .add-section input[type="button"]').addEventListener('click', ev => {
        ev.preventDefault();
        const type = ev.currentTarget.closest('.add-section').querySelector('select[name="type"]').value;
        const screen = settings.screens[sIndex];
        screen.sections.push({
            type,
            id: `user-section-${Date.now()}`,
            groups: Array.from(new Array(sectionSpecs[type].groups)).map((_, i) => ({
                id: `user-group-${i}-${Date.now()}`,
                type: Object.keys(groupSpecs)[i] || 'power',
            })),
        });
        common.storage.set(settingsKey, settings);
        renderScreen();
    });
    activeScreenEl.addEventListener('click', ev => {
        const btn = ev.target.closest('.screen-section .button-group .button');
        const action = btn && btn.dataset.action;
        if (!action) {
            return;
        }
        const sectionEl = btn.closest('.screen-section');
        const sectionId = sectionEl.dataset.sectionId;
        const screen = settings.screens[sIndex];
        if (action === 'edit') {
            const d = sectionEl.querySelector('dialog.edit');
            d.addEventListener('close', ev => {
                if (d.returnValue !== 'save') {
                    return;
                }
                const section = screen.sections.find(x => x.id === sectionId);
                for (const g of d.querySelectorAll('select[name="group"]')) {
                    section.groups.find(x => x.id === g.dataset.id).type = g.value;
                }
                common.storage.set(settingsKey, settings);
                renderScreen();
            }, {once: true});
            d.showModal();
        } else if (action === 'delete') {
            screen.sections.splice(screen.sections.findIndex(x => x.id === sectionId), 1);
            common.storage.set(settingsKey, settings);
            renderScreen();
        } else {
            throw new TypeError("Invalid action: " + action);
        }
    });
    await renderScreen();
}


export async function settingsMain() {
    common.initInteractionListeners();
    settings = common.storage.get(settingsKey);
    await common.initSettingsForm('form#general', {settingsKey});
    await initScreenSettings();
}

