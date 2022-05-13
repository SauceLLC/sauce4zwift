import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as echarts from '../deps/src/echarts.mjs';
import {theme} from './echarts-sauce-theme.mjs';

echarts.registerTheme('sauce', theme);

const L = sauce.locale;
const H = L.human;
//const settingsKey = 'watching-settings-v2';
//let settings;
let imperial = !!common.storage.get('/imperialUnits');
L.setImperial(imperial);

const gaugeConfigs = {
    power: {
        name: 'Power',
        color: '#46f',
        domain: [0, 700],
        getValue: x => x.power,
        getLabel: H.number,
        detailFormatter: x => H.power(x, {suffix: true}),
    },
    hr: {
        name: 'Heart Rate',
        color: '#e22',
        domain: [70, 190],
        getValue: x => x.heartrate,
        getLabel: H.number,
        detailFormatter: x => H.number(x) + 'bpm',
    },
    pace: {
        name: 'Pace',
        color: '#4e3',
        domain: [0, 100],
        getValue: x => x.speed,
        getLabel: H.number,
        detailFormatter: x => H.pace(x, {precision: 0, suffix: true}),
    },
    draft: {
        name: 'Draft',
        color: '#46f',
        domain: [0, 300],
        getValue: x => x.draft,
        getLabel: H.number,
        detailFormatter: x => H.number(x) + '%'
    },
};


export async function main(type) {
    common.initInteractionListeners();
    /*settings = common.storage.get(settingsKey, {
        numScreens: 2,
        lockedFields: false,
    });*/
    const content = document.querySelector('#content');
    const config = gaugeConfigs[type];
    const gauge = echarts.init(content.querySelector('.gauge'), 'sauce', {
        renderer: location.search.includes('svg') ? 'svg' : 'canvas',
    });
    let relSize;
    const initGauge = () => {
        // Can't use em for most things on gauges. :(
        relSize = content.clientHeight / 600;
        gauge.setOption({
            grid: {
                top: -200,
                left: 0,
                right: 0,
                bottom: -200,
            },
            /*visualMap: [{
                type: 'piecewise',
                pieces: [{
                    min: 0, max: 100
                }, {
                    min: 100, max: 200
                }, {
                    min: 200, max: 300
                }, {
                    min: 300
                }],
                inRange: {
                    color: ['black', 'white', 'red', 'green']
                }
            }],*/
            series: [{
                splitNumber: 7,
                name: config.name,
                type: 'gauge',
                min: config.domain[0],
                max: config.domain[1],
                startAngle: 200,
                endAngle: 340,
                    color: [[0, 'green'], [0.2, config.color], [1, 'red']],
                itemStyle: {
                    color: [[0, 'green'], [0.2, config.color], [1, 'red']],
                },
                progress: {
                    show: true,
                    roundCap: true,
                    width: 30 * relSize,
                    itemStyle: {
                        color: config.color,
                    },
                },
                axisLine: {
                    roundCap: true,
                    lineStyle: {
                        color: [[1, '#0004']],
                        width: 30 * relSize,
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
                    distance: 40 * relSize,
                    fontSize: 18 * relSize,
                    formatter: config.getLabel,
                },
                pointer: {
                    width: 6 * relSize,
                    itemStyle: {
                        color: config.color,
                        shadowColor: '#000a',
                        shadowBlur: 3 * relSize,
                    },
                },
                anchor: {
                    show: true,
                    showAbove: true,
                    size: 25 * relSize,
                    itemStyle: {
                        borderWidth: 10 * relSize,
                        borderColor: config.color,
                        shadowColor: '#000a',
                        shadowBlur: 3 * relSize,
                    }
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
    addEventListener('resize', () => {
        initGauge();
        gauge.resize();
    });
    initGauge();
    const renderer = new common.Renderer(content, {fps: 1});
    renderer.addCallback(data => {
        if (data) {
            gauge.setOption({
                series: [{
                    data: [{
                        name: config.name,
                        title: {
                            offsetCenter: [0, '-33%'],
                            color: '#fff2',
                            fontSize: 40 * relSize,
                            fontWeight: 700,
                            textShadowColor: '#000',
                            textShadowBlur: 3 * relSize,
                        },
                        value: config.getValue(data)
                    }]
                }]
            });
        }
    });
    renderer.render();
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
        renderer.setData(watching);
        renderer.render({force});
    });
}


/*
export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form', {settingsKey});
}*/
