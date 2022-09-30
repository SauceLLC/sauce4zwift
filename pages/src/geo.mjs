import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as echarts from '../deps/src/echarts.mjs';
import {theme} from './echarts-sauce-theme.mjs';

echarts.registerTheme('sauce', theme);

const L = sauce.locale;
const H = L.human;
let imperial = !!common.storage.get('/imperialUnits');
L.setImperial(imperial);


export async function main() {
    common.initInteractionListeners();
    const content = document.querySelector('#content');
    const chart = echarts.init(content.querySelector('.scatter'), 'sauce', {
        renderer: location.search.includes('svg') ? 'svg' : 'canvas',
    });
    const initChart = () => {
        chart.setOption({
            animationDurationUpdate: 100,
            tooltip: {},
            xAxis: {
                min: 10000,
                max: 10000,
            },
            yAxis: {
                min: 10000,
                max: 10000,
            },
            series: [{
                type: 'scatter',
                coordinateSystem: 'cartesian2d',
                symbolSize: (x, {data}) => {
                    if (data.obj.watching) {
                        return 40;
                    } else {
                        const a = data.obj.athlete;
                        if (a && a.type === 'PACER_BOT') {
                            return 30;
                        }
                    }
                    return 15;
                },
                label: {
                    position: 'right',
                    fontSize: 16,
                    show: true,
                    color: '#fff',
                    formatter: ({data}) => {
                        const x = data.obj;
                        const a = x.athlete;
                        if (x.watching) {
                            return `${a && a.initials}: ${Math.round(x.state.roadCompletion / 1000000 * 100)}%`;
                        } else {
                            return `${a && a.initials}: ${H.timer(Math.abs(x.gap))} ${Math.round(x.state.roadCompletion / 1000000 * 100)}%`;
                        }
                    }
                },
                itemStyle: {
                    color: ({data}) => {
                        const x = data.obj;
                        const a = x.athlete;
                        if (x.watching) {
                            return '#33c7';
                        } else if (a && a.type === 'PACER_BOT') {
                            return '#3c37';
                        }
                        return '#7777';
                    }
                },
            }],
        });
    };
    initChart();
    const renderer = new common.Renderer(content);
    let xmin = Infinity;
    let xmax = -Infinity;
    let ymin = Infinity;
    let ymax = -Infinity;
    //const data = [];
    renderer.addCallback(nearby => {
        const series = {};
        if (nearby) {
            //const w = nearby.find(x => x.watching);
            //data.push(w);
            const data = nearby;
            series.data = data.map(x => {
                //x.state.x *= -1;
                //x.state.y *= -1;
                xmin = Math.min(xmin, x.state.x);
                ymin = Math.min(ymin, x.state.y);
                xmax = Math.max(xmax, x.state.x);
                ymax = Math.max(ymax, x.state.y);
                return {value: [x.state.x, x.state.y], obj: x};
            });
        }
        const size = Math.ceil(Math.max(ymax - ymin, xmax - xmin) * 1.1 / 1000) * 1000;
        chart.setOption({
            series: [series],
            xAxis: {
                min: Math.round(xmin - ((size - (xmax - xmin)) / 2)),
                max: Math.round(xmax + ((size - (xmax - xmin)) / 2)),
            },
            yAxis: {
                min: Math.round(ymin - ((size - (ymax - ymin)) / 2)),
                max: Math.round(ymax + ((size - (ymax - ymin)) / 2)),
            }
        });
    });
    addEventListener('resize', () => {
        initChart();
        chart.resize();
        renderer.render({force: true});
    });
    common.subscribe('nearby', nearby => {
        renderer.setData(nearby);
        renderer.render();
    });
    renderer.render();
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form');
}
