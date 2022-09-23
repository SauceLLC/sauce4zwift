import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as echarts from '../deps/src/echarts.mjs';
import {theme} from './echarts-sauce-theme.mjs';

echarts.registerTheme('sauce', theme);

const type = (new URLSearchParams(location.search)).get('t') || 'power';
const title = {
    power: 'Power Gauge',
    hr: 'Heart Rate Gauge',
    draft: 'Draft Gauge',
    pace: 'Pace Gauge',
    wbal: 'W\'bal Gauge',
}[type];
const commonDefaultSettings = {
    refreshInterval: 1,
    dataSmoothing: 0,
    showAverage: false,
    showMax: false,
    currentLap: false,
    boringMode: false,
    gaugeTransparency: 20,
    solidBackground: false,
    backgroundColor: '#00ff00',
};

const L = sauce.locale;
const H = L.human;
const settingsKey = `gauge-settings-v1-${type}`;
let settings;
let imperial = !!common.storage.get('/imperialUnits');
L.setImperial(imperial);

const defaultAxisColorBands = [[1, '#0008']];


let _wPrime;
function getWBalValue(x) {
    _wPrime = x.athlete && x.athlete.wPrime;
    if (!_wPrime) {
        return;
    }
    return x.stats.power.wBal / _wPrime * 100;
}


function wBalDetailFormatter(x) {
    return x != null ? `{value|${H.number((x / 100) * _wPrime / 1000, {precision: 1})}}\n{unit|kJ}` : '';
}


const gaugeConfigs = {
    power: {
        name: 'Power',
        defaultSettings: {
            min: 0,
            max: 700,
        },
        color: '#35e',
        getValue: x => settings.dataSmoothing ? x.stats.power.smooth[settings.dataSmoothing] : x.state.power,
        getAvgValue: x =>
            (settings.currentLap ? x.stats.laps.at(-1).power : x.stats.power).avg,
        getMaxValue: x =>
            (settings.currentLap ? x.stats.laps.at(-1).power : x.stats.power).max,
        getLabel: H.number,
        detailFormatter: x => `{value|${H.power(x)}}\n{unit|watts}`,
        axisColorBands: data => {
            if (data.athlete && data.athlete.ftp) {
                const zones = sauce.power.cogganZones(data.athlete.ftp);
                const min = settings.min;
                const delta = settings.max - min;
                const p = gaugeConfigs.power.getValue(data);
                return [
                    [(zones.z1 - min) / delta, '#444d'],
                    [(zones.z2 - min) / delta, p > zones.z1 ? '#24d' : '#24d3'],
                    [(zones.z3 - min) / delta, p > zones.z2 ? '#5b5' : '#5b53'],
                    [(zones.z4 - min) / delta, p > zones.z3 ? '#dd3' : '#dd33'],
                    [(zones.z5 - min) / delta, p > zones.z4 ? '#fa0' : '#fa03'],
                    [(zones.z6 - min) / delta, p > zones.z5 ? '#b22' : '#b223'],
                    [(zones.z7 - min) / delta, p > zones.z6 ? '#407' : '#4073'],
                ];
            }
        },
    },
    hr: {
        name: 'Heart Rate',
        color: '#d22',
        ticks: 8,
        defaultSettings: {
            min: 70,
            max: 190,
        },
        getValue: x => settings.dataSmoothing ? x.stats.hr.smooth[settings.dataSmoothing].avg : x.state.heartrate,
        getLabel: H.number,
        detailFormatter: x => `{value|${H.number(x)}}\n{unit|bpm}`,
    },
    pace: {
        name: 'Pace',
        color: '#273',
        ticks: imperial ? 6 : 10,
        defaultSettings: {
            min: 0,
            max: 100,
        },
        getValue: x => settings.dataSmoothing ? x.stats.speed.smooth[settings.dataSmoothing].avg : x.state.speed,
        getLabel: x => H.pace(x, {precision: 0}),
        detailFormatter: x => `{value|${H.pace(x, {precision: 0})}}\n{unit|${imperial ? 'mph' : 'kph'}}`,
    },
    draft: {
        name: 'Draft',
        color: '#930',
        ticks: 6,
        defaultSettings: {
            min: 0,
            max: 300,
        },
        getValue: x => x.state.draft,
        getLabel: H.number,
        detailFormatter: x => `{value|${H.number(x)}}\n{unit|% boost}`,
    },
    wbal: {
        name: 'W\'bal',
        color: '#555',
        ticks: 10,
        defaultSettings: {
            min: 0,
            max: 100,
        },
        getValue: getWBalValue,
        getLabel: x => H.number(x / 100000 * _wPrime),
        detailFormatter: wBalDetailFormatter,
        visualMap: [{
            show: false,
            type: 'continuous',
            hoverLink: false,
            seriesIndex: 0,
            min: 0,
            max: 100,
            inRange: {
                color: ['#b01010', '#dad00c', '#9da665', '#16ff18'],
                colorAlpha: [0.5, 0.9],
            },
        }],
    },
};


function setBackground({solidBackground, backgroundColor}) {
    const doc = document.documentElement;
    doc.classList.toggle('solid-background', solidBackground);
    if (solidBackground) {
        doc.style.setProperty('--background-color', backgroundColor);
    } else {
        doc.style.removeProperty('--background-color');
    }
}


export async function main() {
    document.title = `${title} - Sauce for Zwift™`;
    document.querySelector('#titlebar header .title').textContent = title;
    common.addOpenSettingsParam('t', type);
    common.initInteractionListeners();
    const config = gaugeConfigs[type];
    settings = common.storage.get(settingsKey, {...commonDefaultSettings, ...config.defaultSettings});
    setBackground(settings);
    const content = document.querySelector('#content');
    const gauge = echarts.init(content.querySelector('.gauge'), 'sauce', {
        renderer: location.search.includes('svg') ? 'svg' : 'canvas',
    });
    let relSize;
    const initGauge = () => {
        // Can't use em for most things on gauges. :(
        relSize = Math.min(content.clientHeight * 1.20, content.clientWidth) / 600;
        gauge.setOption({
            animationDurationUpdate: Math.max(200, Math.min(settings.refreshInterval * 1000, 1000)),
            animationEasingUpdate: 'linear',
            tooltip: {},
            visualMap: config.visualMap,
            graphic: [{
                elements: [{
                    left: 'center',
                    top: 'middle',
                    type: 'circle',
                    shape: {
                        r: 270 * relSize,
                    },
                    style: {
                        shadowColor: '#000a',
                        shadowBlur: 5 * relSize,
                        fill: {
                            type: 'linear',
                            x: 0,
                            y: 0,
                            x2: 0,
                            y2: 1,
                            colorStops: [{
                                offset: 0,
                                color: '#000',
                            }, {
                                offset: 0.5,
                                color: config.color + 'f',
                            }, {
                                offset: 0.75,
                                color: config.color,
                            }, {
                                offset: 0.75,
                                color: '#0000'
                            }, {
                                offset: 1,
                                color: '#0000'
                            }],
                        },
                        lineWidth: 0,
                        opacity: 1 - (settings.gaugeTransparency / 100),
                    }
                }]
            }],
            series: [{
                radius: '90%', // fill space
                splitNumber: config.ticks || 7,
                name: config.name,
                type: 'gauge',
                min: settings.min,
                max: settings.max,
                startAngle: 210,
                endAngle: 330,
                progress: {
                    show: true,
                    width: 60 * relSize,
                    itemStyle: !config.visualMap ? {
                        color: config.axisColorBands ? '#fff3' : config.color + '4',
                    } : undefined,
                },
                axisLine: {
                    lineStyle: {
                        color: defaultAxisColorBands,
                        width: 60 * relSize,
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
                    distance: 70 * relSize,
                    fontSize: 20 * relSize,
                    formatter: config.getLabel,
                    textShadowColor: '#000',
                    textShadowBlur: 1 * relSize,
                },
                pointer: settings.boringMode ? {
                    // NOTE: Important that all are set so it's not an update
                    icon: null,
                    width: 7 * relSize,
                    length: 190 * relSize,
                    offsetCenter: [0, 0],
                    itemStyle: {
                        color: config.color,
                        opacity: 0.9,
                        borderColor: '#000',
                        borderWidth: 2 * relSize,
                        shadowColor: '#0007',
                        shadowBlur: 8 * relSize,
                    },
                } : {
                    width: 70 * relSize,
                    length: 200 * relSize,
                    icon: 'image://./images/logo_vert_120x320.png',
                    offsetCenter: [0, '10%'],
                    itemStyle: {
                        opacity: 0.9,
                    },
                },
                anchor: settings.boringMode ? {
                    show: true,
                    showAbove: true,
                    size: 25 * relSize,
                    itemStyle: {
                        color: '#aaa',
                        borderColor: '#222',
                        borderWidth: 5 * relSize,
                    }
                } : {show: false},
                detail: {
                    valueAnimation: true,
                    formatter: config.detailFormatter,
                    textShadowColor: '#000',
                    textShadowBlur: 3 * relSize,
                    offsetCenter: [0, '33%'],
                    rich: {
                        value: {
                            color: '#fffd',
                            fontSize: 80 * relSize,
                            fontWeight: 'bold',
                            lineHeight: 60 * relSize,
                        },
                        unit: {
                            fontSize: 20 * relSize,
                            color: '#fff9',
                            lineHeight: 16 * relSize,
                        }
                    }
                },
            }],
        });
    };
    initGauge();
    const renderer = new common.Renderer(content, {fps: 1 / settings.refreshInterval});
    renderer.addCallback(data => {
        const axisColorBands = config.axisColorBands ?
            data && config.axisColorBands(data) : defaultAxisColorBands;
        const series = {
            axisLine: {lineStyle: {color: axisColorBands || defaultAxisColorBands}}
        };
        if (data) {
            series.data = [{
                name: config.name,
                title: {
                    offsetCenter: [0, '-20%'],
                    color: '#fff9',
                    fontSize: 50 * relSize,
                    fontWeight: 700,
                    textShadowColor: '#0009',
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
        renderer.render({force: true});
    });
    let reanimateTimeout;
    common.storage.addEventListener('update', ev => {
        settings = ev.data.value;
        setBackground(settings);
        renderer.fps = 1 / settings.refreshInterval;
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
    common.subscribe('athlete/watching', watching => {
        renderer.setData(watching);
        renderer.render();
    });
    renderer.render();
}


export async function settingsMain() {
    document.title = `${title} - Settings - Sauce for Zwift™`;
    document.querySelector('#titlebar header .title').textContent = `${title} - Settings`;
    common.initInteractionListeners();
    await common.initSettingsForm('form', {settingsKey})();
}
