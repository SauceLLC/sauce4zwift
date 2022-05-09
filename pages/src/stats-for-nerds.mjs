import sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as echarts from '../deps/src/echarts.mjs';

const L = sauce.locale;


async function makeMetricCharts(proc, el) {
    const decodedNames = {
        Browser: 'Backend Service', // node
        GPU: 'GPU Bridge', // not GPU usage but the proc that proxies GPU ops.
        Tab: 'Window',
    };
    const spec = await common.rpc('getWindowSpecForPID', proc.pid);
    const lineEl = document.createElement('div');
    const gaugeEl = document.createElement('div');
    lineEl.classList.add('chart', 'line');
    gaugeEl.classList.add('chart',  'gauge');
    el.appendChild(lineEl);
    el.appendChild(gaugeEl);
    const lineChart = echarts.init(lineEl);
    const options = {
        visualMap: [{
            show: false,
            type: 'continuous',
            seriesIndex: 0,
            min: 0,
            max: 100
        }],
        grid: {
            top: 40,
            left: 0,
            right: 0,
            bottom: 0,
        },
        title: [{
            left: 'left',
            text: `${spec ? spec.prettyName : ''} ${decodedNames[proc.type] || proc.name || proc.type}, PID: ${proc.pid}`,
        }],
        tooltip: {
            trigger: 'axis'
        },
        xAxis: [{show: false}],
        yAxis: [{show: false}, {show: false}],
        series: [{
            type: 'line',
            showSymbol: false,
        }, {
            type: 'line',
            showSymbol: false,
            yAxisIndex: 1,
        }]
    };
    lineChart.setOption(options);
    const gaugeChart = new echarts.init(gaugeEl);
    gaugeChart.setOption({
        series: [{
            name: 'CPU',
            type: 'gauge',
            detail: {
                formatter: '{value}%'
            },
            data: [{
                value: 0,
                name: 'CPU'
            }]
        }]
    });
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
                    datas: {
                        cpu: Array.from(new Array(300)).map(() => 0),
                        mem: Array.from(new Array(300)).map(() => 0),
                    },
                    el,
                });
            }
            unused.delete(x.pid);
            const {charts, datas} = allCharts.get(x.pid);
            const cpu = x.cpu.percentCPUUsage * 10;  // XXX why is it 10x off?
            const mem = x.memory.workingSetSize / 1024;  // MB
            datas.cpu.push(cpu);
            datas.cpu.shift();
            datas.mem.push(mem);
            datas.mem.shift();
            charts.line.setOption({
                series: [{
                    data: datas.cpu.map((x, i) => [i, x]),
                }, {
                    data: datas.mem.map((x, i) => [i, x]),
                }]
            });
            charts.gauge.setOption({series: [{data: [{value: Math.round(cpu)}]}]});
        }
        for (const pid of unused) {
            const {el} = allCharts.get(pid);
            allCharts.delete(pid);
            el.remove();
        }
    }
}
