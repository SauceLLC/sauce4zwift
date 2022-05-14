import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as echarts from '../deps/src/echarts.mjs';
import {theme} from './echarts-sauce-theme.mjs';

echarts.registerTheme('sauce', theme);

const type = (new URLSearchParams(location.search)).get('t');
const title = {
    power: 'Power Gauge',
    hr: 'Heart Rate Gauge',
    draft: 'Draft Gauge',
}[type];
const commonDefaultSettings = {
    refreshInterval: 1,
    dataSmoothing: 0,
    showAverage: false,
    showMax: false,
    currentLap: false,
    boringMode: false,
};

const L = sauce.locale;
const H = L.human;
const settingsKey = `gauge-settings-v1-${type}`;
let settings;
let imperial = !!common.storage.get('/imperialUnits');
L.setImperial(imperial);

const defaultAxisColorBands = [[1, '#3333']];
let axisColorBands = defaultAxisColorBands;

const gaugeConfigs = {
    power: {
        name: 'Power',
        defaultSettings: {
            min: 0,
            max: 700,
        },
        color: '#339',
        getValue: x => settings.dataSmoothing ? x.stats.power.smooth[settings.dataSmoothing] : x.power,
        getAvgValue: x =>
            (settings.currentLap ? x.stats.laps.at(-1).power : x.stats.power).avg,
        getMaxValue: x =>
            (settings.currentLap ? x.stats.laps.at(-1).power : x.stats.power).max,
        getLabel: H.number,
        detailFormatter: x => H.power(x, {suffix: true}),
        axisColorBands: data => {
            if (data.athlete && data.athlete.ftp) {
                const zones = sauce.power.cogganZones(data.athlete.ftp);
                const min = settings.min;
                const delta = settings.max - min;
                return [
                    [(zones.z1 - min) / delta, '#4443'],
                    [(zones.z2 - min) / delta, '#44de'],
                    [(zones.z3 - min) / delta, '#5b5e'],
                    [(zones.z4 - min) / delta, '#dd3e'],
                    [(zones.z5 - min) / delta, '#fa0e'],
                    [(zones.z6 - min) / delta, '#b22e'],
                    [(zones.z7 - min) / delta, '#407e'],
                ];
            }
        },
    },
    hr: {
        name: 'Heart Rate',
        color: '#e22',
        defaultSettings: {
            min: 70,
            max: 190,
        },
        getValue: x => x.heartrate,
        getLabel: H.number,
        detailFormatter: x => H.number(x) + 'bpm',
    },
    pace: {
        name: 'Pace',
        color: '#4e3',
        defaultSettings: {
            min: 0,
            max: 100,
        },
        getValue: x => x.speed,
        getLabel: H.number,
        detailFormatter: x => H.pace(x, {precision: 0, suffix: true}),
    },
    draft: {
        name: 'Draft',
        color: '#46f',
        defaultSettings: {
            min: 0,
            max: 300,
        },
        getValue: x => x.draft,
        getLabel: H.number,
        detailFormatter: x => H.number(x) + '%'
    },
};


export async function main() {
    document.title = `${title} - Sauce for Zwift™`;
    document.querySelector('#titlebar header .title').textContent = document.title;
    common.addOpenSettingsParam('t', type);
    common.initInteractionListeners();
    const config = gaugeConfigs[type];
    settings = common.storage.get(settingsKey, {...commonDefaultSettings, ...config.defaultSettings});
    const content = document.querySelector('#content');
    const gauge = echarts.init(content.querySelector('.gauge'), 'sauce', {
        renderer: location.search.includes('svg') ? 'svg' : 'canvas',
    });
    let relSize;
    const initGauge = () => {
        // Can't use em for most things on gauges. :(
        relSize = Math.min(content.clientHeight * 1.20, content.clientWidth) / 600;
        gauge.setOption({
            series: [{
                radius: '90%', // fill space
                splitNumber: 7,
                name: config.name,
                type: 'gauge',
                min: settings.min,
                max: settings.max,
                startAngle: 200,
                endAngle: 340,
                progress: {
                    show: true,
                    width: 50 * relSize,
                    itemStyle: {
                        color: '#fff8',
                        shadowColor: '#fff',
                        shadowBlur: 12 * relSize,
                        borderWidth: 8 * relSize,
                        borderColor: '#fff3',
                    },
                },
                axisLine: {
                    lineStyle: {
                        color: axisColorBands || defaultAxisColorBands,
                        width: 50 * relSize,
                        shadowColor: '#0007',
                        shadowBlur: 8 * relSize,
                    },
                },
                axisTick: {
                    show: false,
                },
                splitLine: {
                    show: true,
                    distance: 10 * relSize,
                    length: 10 * relSize,
                    lineStyle: {
                        width: 3 * relSize,
                    }
                },
                axisLabel: {
                    distance: 60 * relSize,
                    fontSize: 18 * relSize,
                    formatter: config.getLabel,
                },
                pointer: settings.boringMode ? {
                    // NOTE: Important that all are set so it's not an update
                    icon: null,
                    width: 20 * relSize,
                    length: 180 * relSize,
                    offsetCenter: [0, 0],
                    itemStyle: {
                        color: config.color,
                        opacity: 0.9,
                        shadowColor: '#0007',
                        shadowBlur: 8 * relSize,
                    },
                } : {
                    width: 90 * relSize,
                    length: 240 * relSize,
                    icon: 'image://./images/logo_vert_120x320.png',
                    offsetCenter: [0, '25%'],
                    itemStyle: {
                        opacity: 0.9,
                    },
                },
                detail: {
                    valueAnimation: true,
                    formatter: config.detailFormatter,
                    fontSize: 80 * relSize,
                    textShadowColor: '#000',
                    textShadowBlur: 3 * relSize,
                    offsetCenter: [0, '50%'],
                },
            }],
        });
    };
    initGauge();
    const renderer = new common.Renderer(content, {fps: 1});
    let athleteId;
    renderer.addCallback(data => {
        const newAthlete = (data && data.athleteId || undefined) !== athleteId;
        if (newAthlete) {
            axisColorBands = null;
            athleteId = data.athleteId;
        }
        const series = {};
        if (!axisColorBands) {
            axisColorBands = config.axisColorBands ? data && config.axisColorBands(data) : defaultAxisColorBands;
            series.axisLine = {lineStyle: {color: axisColorBands || defaultAxisColorBands}};
        }
        if (data) {
            series.data = [{
                name: config.name,
                title: {
                    offsetCenter: [0, '-33%'],
                    color: '#fff2',
                    fontSize: 50 * relSize,
                    fontWeight: 700,
                    textShadowColor: '#000',
                    textShadowBlur: 3 * relSize,
                },
                value: config.getValue(data),
            }];
        }
        gauge.setOption({series: [series]});
    });
    addEventListener('resize', () => {
        initGauge();
        gauge.resize();
    });
    let reanimateTimeout;
    common.storage.addEventListener('update', ev => {
        settings = ev.data.value;
        axisColorBands = null;
        initGauge();
        gauge.setOption({series: [{animation: false}]});
        renderer.render({force: true});
        clearTimeout(reanimateTimeout);
        reanimateTimeout = setTimeout(() => gauge.setOption({series: [{animation: true}]}), 400);
    });
    common.storage.addEventListener('globalupdate', ev => {
        if (ev.data.key === '/imperialUnits') {
            imperial = ev.data.value;
            L.setImperial(imperial);
        }
    });
    common.subscribe('watching', watching => {
        renderer.setData(watching);
        renderer.render();
    });
    renderer.render();
}


export async function settingsMain() {
    document.title = `${title} Settings - Sauce for Zwift™`;
    document.querySelector('#titlebar header .title').textContent = document.title;
    common.initInteractionListeners();
    await common.initSettingsForm('form', {settingsKey});
}
