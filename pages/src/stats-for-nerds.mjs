import sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as charts from './charts.mjs';

const L = sauce.locale;
const H = L.human;


function makeMetricChart(proc, bindto) {
    const chart = new charts.Chart({
        title: {
            text: `${proc.name || proc.type}, PID: ${proc.pid}`,
        },
        names: {
            cpu: 'CPU',
            mem: 'Memory',
        },
        colors: {
            cpu: '#ccc',
            mem: '#22e',
        },
        data: {
            columns: [['cpu'], ['mem']],
            type: 'area',
            axes: {
                cpu: 'y',
                mem: 'y2',
            },
        },
        area: {
            linearGradient: true,
            /*
            linearGradient: {
                x: [0, 0],
                y: [1, 0],
                stops: [[ // offset, stop-color, opacity
                    0,
                    id => id === 'cpu' ? '#fff' : '#00f',
                    0.1
                ], [
                    0.5,
                    id => id === 'cpu' ? '#fff' : '#00f',
                    0.8
                ], [
                    0.5,
                    id => id === 'cpu' ? '#f00' : '#0f0',
                    0.8
                ], [
                    1,
                    id => id === 'cpu' ? '#f00' : '#0f0',
                    1 
                ]]
            }
            */
        },
        point: {
            focus: {
                only: true,
            },
        },
        legend: {
            show: false,
            hide: true,
        },
        axis: {
            x: {
                tick: {
                    outer: false,
                    show: false,
                    text: {
                        show: false,
                    },
                },
            },
            y: {
                min: 0,
                max: 100,
                show: true,
                padding: 0,
                label: {
                    text: 'CPU',
                    position: 'outside-middle',
                },
                tick: {
                    culling: {
                        max: 4,
                    },
                    count: 7,
                    format: x => H.number(x) + '%',
                },
            },
            y2: {
                show: true,
                min: 0,
                max: 200,
                padding: 0,
                label: {
                    text: 'Memory',
                    position: 'outside-middle',
                },
                tick: {
                    culling: {
                        max: 4,
                    },
                    format: x => H.number(x) + 'MB',
                    count: 7,
                },
            },
        },
        tooltip: {
            format: {
                value: (value, ratio, id) => {
                    const func = {
                        cpu: x => H.number(x) + '%',
                        mem: x => H.number(x) + 'MB',
                    }[id];
                    return func(value);
                },
            },
        },
        padding: {
            top: 10,
        },
        bindto
    });
    return chart;
}


export async function main() {
    common.initInteractionListeners();
    const content = document.querySelector('#content');
    const charts = new Map();
    while (true) {
        const metrics = await common.rpc('pollAppMetrics');
        const unused = new Set(charts.keys());
        for (const x of metrics) {
            if (!charts.has(x.pid)) {
                const el = document.createElement('div');
                el.classList.add('chart');
                content.appendChild(el);
                charts.set(x.pid, {
                    chart: makeMetricChart(x, el),
                    el,
                });
            }
            unused.delete(x.pid);
            const {chart} = charts.get(x.pid);
            const cpu = x.cpu.percentCPUUsage * 10;  // XXX why is it 10x off?
            const mem = x.memory.workingSetSize / 1024;  // MB
            const maxRanges = chart.axis.max();
            if (cpu > maxRanges.y) {
                chart.axis.max({y: Math.ceil(cpu)});
            }
            if (mem > maxRanges.y2) {
                const y2Max = Math.round((mem + 20) / 10) * 10;
                chart.axis.max({y2: y2Max});
                // convert ygrid line for 200MB to y axis domain. :(
                const yMax = chart.axis.max().y;
                chart.ygrids([{value: yMax * (200 / y2Max)}]);
            }
            chart.load({
                columns: [
                    ['cpu', x.cpu.percentCPUUsage * 10], // XXX No idea why, but cpu is 10x what it should be
                    ['mem', x.memory.workingSetSize / 1024],
                ],
                append: true,
            });
        }
        for (const pid of unused) {
            const {el} = charts.get(pid);
            charts.delete(pid);
            el.remove();
        }
    }
}
