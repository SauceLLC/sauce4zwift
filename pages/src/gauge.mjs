import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import {cssColor, getTheme} from './echarts-sauce-theme.mjs';

common.enableSentry();
common.RAFThrottlePatcher.singleton().setFPSLimit(12);

const doc = document.documentElement;
const page = window.location.pathname.split('/').at(-1).split('.')[0];
const type = (new URLSearchParams(window.location.search)).get('t') || page || 'power';
const L = sauce.locale;
const H = L.human;
let settings; // eslint-disable-line prefer-const
let powerZones;
let sport = 'cycling';

const defaultAxisColorBands = [[1, cssColor('fg', 1, 0.2)]];


let _wPrime;
function getWBalValue(x) {
    _wPrime = x.athlete && x.athlete.wPrime;
    if (!_wPrime) {
        return;
    }
    return x.wBal / _wPrime * 100;
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
        defaultColor: '#35e',
        getValue: x => settings.dataSmoothing ? x.stats.power.smooth[settings.dataSmoothing] : x.state.power,
        getAvgValue: x =>
            (settings.currentLap ? x.stats.laps.at(-1).power : x.stats.power).avg,
        getMaxValue: x =>
            (settings.currentLap ? x.stats.laps.at(-1).power : x.stats.power).max,
        getLabel: H.number,
        detailFormatter: x => `{value|${H.power(x)}}\n{unit|watts}`,
        axisColorBands: data => {
            if (powerZones === undefined) {
                powerZones = null;
                common.rpc.getPowerZones(1).then(zones => powerZones = zones);
                return;
            }
            if (!powerZones || !data.athlete || !data.athlete.ftp) {
                return;
            }
            const min = settings.min;
            const delta = settings.max - min;
            const power = gaugeConfigs.power.getValue(data);
            const normZones = powerZones.filter(x => !x.overlap);
            if (normZones[0].from > 0) {
                // Always pad in case of non zero offset (i.e. fake active recovery zone)
                normZones.unshift({zone: '', from: 0, to: normZones[0].from});
            }
            const zoneColors = common.getPowerZoneColors(normZones);
            const bands = normZones.map(x => [
                Math.min(1, Math.max(0, ((x.to || Infinity) * data.athlete.ftp - min) / delta)),
                zoneColors[x.zone] + (power / data.athlete.ftp < (x.from || 0) ? '3' : '')
            ]);
            if (bands[bands.length - 1][0] < 1) {
                // Unlikely custom zones with none Infinite final zone
                bands.push([1, '#0005']);
            }
            return bands;
        },
    },
    hr: {
        name: 'Heart Rate',
        defaultColor: '#d22',
        ticks: 8,
        defaultSettings: {
            min: 70,
            max: 190,
        },
        getValue: x => settings.dataSmoothing ? x.stats.hr.smooth[settings.dataSmoothing] : x.state.heartrate,
        getLabel: H.number,
        detailFormatter: x => `{value|${H.number(x)}}\n{unit|bpm}`,
        longPeriods: true,
    },
    pace: {
        name: 'Speed',
        defaultColor: '#273',
        ticks: common.imperialUnits ? 6 : 10,
        defaultSettings: {
            min: 0,
            max: 100,
        },
        getValue: x => settings.dataSmoothing ? x.stats.speed.smooth[settings.dataSmoothing] : x.state.speed,
        getLabel: x => H.pace(x, {precision: 0, sport}),
        detailFormatter: x => {
            const unit = sport === 'running' ?
                (common.imperialUnits ? '/mi' : '/km') :
                (common.imperialUnits ? 'mph' : 'kph');
            return `{value|${H.pace(x, {precision: 1, sport})}}\n{unit|${unit}}`;
        },
        longPeriods: true,
    },
    cadence: {
        name: 'Cadence',
        defaultColor: '#ee3',
        ticks: 10,
        defaultSettings: {
            min: 40,
            max: 140,
        },
        getValue: x => x.state.cadence,
        getLabel: H.number,
        detailFormatter: x => `{value|${H.number(x)}}\n{unit|rpm}`,
        longPeriods: true,
    },
    draft: {
        name: 'Draft',
        defaultColor: '#930',
        ticks: 6,
        defaultSettings: {
            min: 0,
            max: 300,
        },
        getValue: x => settings.dataSmoothing ? x.stats.draft.smooth[settings.dataSmoothing] : x.state.draft,
        getLabel: H.number,
        detailFormatter: x => `{value|${H.number(x)}}\n{unit|w savings}`,
        longPeriods: true,
    },
    wbal: {
        name: 'W\'bal',
        defaultColor: '#555',
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
        noSmoothing: true,
    },
};

const config = new Map(Object.entries(gaugeConfigs)).get(type);
const settingsStore = new common.SettingsStore(`gauge-settings-v1-${type}`);
settings = settingsStore.get(null, {
    refreshInterval: 1,
    dataSmoothing: 0,
    showAverage: false,
    showMax: false,
    currentLap: false,
    boringMode: false,
    gaugeTransparency: 20,
    solidBackground: false,
    backgroundColor: '#00ff00',
    colorOverride: false,
    color: '#7700ff',
    ...config.defaultSettings,
});
common.themeInit(settingsStore);
common.localeInit(settingsStore);
doc.classList.remove('hidden-during-load');
config.color = settings.colorOverride ? settings.color : config.defaultColor;

// Fix dataSmoothing bug fixed 01-05-2025
if (typeof settings.dataSmoothing === 'string') {
    console.warn('Fixing dataSmoothing bug');
    settings.dataSmoothing = Number(settings.dataSmoothing);
}


function colorAlpha(color, alpha) {
    if (color.length <= 5) {
        return color.slice(0, 4) + alpha[0];
    } else {
        return color.slice(0, 7) + alpha.padStart(2, alpha[0]);
    }
}




export async function main() {
    common.addOpenSettingsParam('t', type);
    common.initInteractionListeners();
    common.setBackground(settings);
    const content = document.querySelector('#content');
    const echarts = await import('../deps/src/echarts.mjs');
    echarts.registerTheme('sauce', getTheme('dynamic'));
    const gauge = echarts.init(content.querySelector('.gauge'), 'sauce', {renderer: 'svg'});
    let relSize;
    const initGauge = () => {
        // Can't use em for most things on gauges. :(
        relSize = Math.min(content.clientHeight * 1.20, content.clientWidth) / 600;
        gauge.setOption({
            animationDurationUpdate: Math.max(200, Math.min(settings.refreshInterval * 1000, 1000)),
            animationEasingUpdate: 'linear',
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
                        shadowColor: cssColor('fg', 1, 2/3),
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
                                color: colorAlpha(config.color, 'f'),
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
                        color: config.axisColorBands ? '#fff3' : colorAlpha(config.color, '4'),
                    } : undefined,
                },
                axisLine: {
                    lineStyle: {
                        color: defaultAxisColorBands,
                        width: 60 * relSize,
                        shadowColor: cssColor('fg', 1, 0.5),
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
                    textShadowColor: cssColor('fg', 1, 0.5),
                    textShadowBlur: 1 * relSize,
                },
                pointer: settings.boringMode ? {
                    // NOTE: Important that all are set so it's not an update
                    icon: null,
                    width: 6 * relSize,
                    length: 180 * relSize,
                    offsetCenter: [0, 0],
                    itemStyle: {
                        color: config.color,
                        opacity: 0.9,
                        borderColor: cssColor('fg', 0, 0.9),
                        borderWidth: 2 * relSize,
                        shadowColor: cssColor('fg', 1, 0.4),
                        shadowBlur: 4 * relSize,
                    },
                } : {
                    width: 70 * relSize,
                    length: 180 * relSize,
                    icon: 'image://../images/logo_vert_120x320.png',
                    offsetCenter: [0, '10%'],
                },
                anchor: settings.boringMode ? {
                    showAbove: true,
                    show: true,
                    size: 25 * relSize,
                    itemStyle: {
                        color: config.color,
                        borderColor: cssColor('fg', 0, 0.9),
                        borderWidth: 2 * relSize,
                        shadowColor: cssColor('fg', 1, 0.5),
                        shadowBlur: 4 * relSize,
                    }
                } : {show: false},
                detail: {
                    valueAnimation: true,
                    formatter: config.detailFormatter,
                    textShadowColor: cssColor('fg', 1, 0.4),
                    textShadowBlur: 1 * relSize,
                    offsetCenter: [0, '32%'],
                    rich: {
                        value: {
                            color: cssColor('fg'),
                            fontSize: 80 * relSize,
                            fontWeight: 'bold',
                            lineHeight: 70 * relSize,
                        },
                        unit: {
                            fontSize: 18 * relSize,
                            color: cssColor('fg', 0, 0.88),
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
                    offsetCenter: [0, '-30%'],
                    color: cssColor('fg', 0, 0.9),
                    fontSize: 80 * relSize * (1 - (config.name.length / 6) * 0.3),
                    fontWeight: 700,
                    textShadowColor: cssColor('fg', 1, 0.4),
                    textShadowBlur: 2 * relSize,
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
    settingsStore.addEventListener('set', ev => {
        const key = ev.data.key;
        if (key === 'color' || key === 'colorOverride') {
            config.color = settings.colorOverride ? settings.color : config.defaultColor;
        }
        common.setBackground(settings);
        renderer.fps = 1 / settings.refreshInterval;
        initGauge();
        gauge.setOption({series: [{animation: false}]});
        renderer.render({force: true});
        clearTimeout(reanimateTimeout);
        reanimateTimeout = setTimeout(() => gauge.setOption({series: [{animation: true}]}), 400);
    });
    common.subscribe('athlete/watching', watching => {
        sport = watching.state.sport;
        if (type === 'pace') {
            config.name = sport === 'running' ? 'Pace' : 'Speed';
        }
        renderer.setData(watching);
        renderer.render();
    });
    renderer.render();
}


export async function settingsMain() {
    common.initInteractionListeners();
    if (config.noSmoothing) {
        document.querySelector('form [name="dataSmoothing"]').disabled = true;
    }
    if (config.longPeriods) {
        Array.from(document.querySelectorAll('form [name="dataSmoothing"] [data-period="short"]'))
            .map(x => x.disabled = true);
    }
    await common.initSettingsForm('form', {store: settingsStore})();
}
