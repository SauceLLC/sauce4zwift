import sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as charts from './charts.mjs';

const L = sauce.locale;
const H = L.human;


function makeMetricChart(proc, bindto) {
    const chart = new charts.Chart({
        title: {
            text: `${proc.name || proc.type}: ${proc.pid}`,
        },
        names: {
            cpu: 'CPU',
            mem: 'Memory',
        },
        colors: {
            cpu: '#ccc',
            mem: '#22e',
        },
        /*scales: [{
            id: 'cpu',
            origin: 'y',
            domain: [0, 100],
        }, {
            id: 'mem',
            origin: 'y2',
        }],*/
        data: {
            columns: [['cpu'], ['mem']],
            type: 'area',
            axes: {
                cpu: 'y',
                mem: 'y2',
            }
        },
        area: {
            linearGradient: true,
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
                    position: 'inner-middle',
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
            //console.info(x.pid, x.cpu.percentCPUUsage, x.memory.workingSetSize);
            chart.load({
                columns: [
                    ['cpu', x.cpu.percentCPUUsage * 10],
                    ['mem', x.memory.workingSetSize / 1024],
                ],
                append: true,
            });
        }
        for (const pid of unused) {
            const {chart, el} = charts.get(pid);
            charts.delete(pid);
            el.remove();
        }
    }
    document.addEventListener('settings-updated', ev => {
        location.reload();
    });
}
