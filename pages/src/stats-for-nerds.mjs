import sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as charts from './charts.mjs';

const L = sauce.locale;
const H = L.human;


async function makeMetricCharts(proc, el) {
    const decodedNames = {
        Browser: 'Backend Service', // node
        GPU: 'GPU Bridge', // not GPU usage but the proc that proxies GPU ops.
        Tab: 'Window',
    };
    const spec = await common.rpc('getWindowSpecForPID', proc.pid);
    const lineEl = document.createElement('div');
    lineEl.classList.add('chart', 'line');
    const lineChart = new charts.Chart({
        title: {
            text: `${spec ? spec.prettyName : ''} ${decodedNames[proc.type] || proc.name || proc.type}, PID: ${proc.pid}`,
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
                max: 1024,
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
            bottom: 0,
        },
        bindto: lineEl,
    });
    const gaugeEl = document.createElement('div');
    gaugeEl.classList.add('chart',  'gauge');
    const gaugeChart = new charts.Chart({
        names: {
            cpu: 'CPU',
            mem: 'Memory',
        },
        color: {
            pattern: [
                "#60B044",
                "#F6C600",
                "#F97600",
                "#FF0000",
            ],
            threshold: {
                values: [
                    25,
                    50,
                    75,
                    100,
                ]
            }
        },
        colors: {
            cpu: '#ccc',
            mem: '#22e',
        },
        data: {
            columns: [['cpu', 0]],
            type: 'gauge',
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
                max: 1024,
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
        bindto: gaugeEl,
    });
    el.appendChild(lineEl);
    el.appendChild(gaugeEl);
    return {
        line: lineChart,
        gauge: gaugeChart,
    };
}


export async function main() {
    common.initInteractionListeners();
    const content = document.querySelector('#content');
    const allCharts = new Map();
    while (true) {
        const metrics = await common.rpc('pollAppMetrics');
        const unused = new Set(allCharts.keys());
        for (const x of metrics) {
            if (!allCharts.has(x.pid)) {
                const el = document.createElement('div');
                el.classList.add('chart-holder');
                content.appendChild(el);
                allCharts.set(x.pid, {
                    charts: await makeMetricCharts(x, el),
                    el,
                });
            }
            unused.delete(x.pid);
            const {charts} = allCharts.get(x.pid);
            const cpu = x.cpu.percentCPUUsage * 10;  // XXX why is it 10x off?
            const mem = x.memory.workingSetSize / 1024;  // MB
            const maxRanges = charts.line.axis.max();
            if (cpu > maxRanges.y) {
                charts.line.axis.max({y: Math.ceil(cpu)});
            }
            if (mem > maxRanges.y2) {
                const y2Max = Math.round((mem + 20) / 10) * 10;
                charts.line.axis.max({y2: y2Max});
                // convert ygrid line for 200MB to y axis domain. :(
                const yMax = charts.line.axis.max().y;
                charts.line.ygrids([{value: yMax * (200 / y2Max)}]);
            }
            charts.line.load({
                columns: [
                    ['cpu', cpu],
                    ['mem', mem],
                ],
                append: true,
            });
            charts.gauge.load({columns: [['cpu', cpu]]});
        }
        for (const pid of unused) {
            const {el} = allCharts.get(pid);
            allCharts.delete(pid);
            el.remove();
        }
    }
}
