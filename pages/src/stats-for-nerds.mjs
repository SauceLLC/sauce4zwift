import sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as echarts from '../deps/src/echarts.mjs';
import {theme} from './echarts-sauce-theme.mjs';

echarts.registerTheme('sauce', theme);

const L = sauce.locale;
const H = L.human;
const maxLen = 300;


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
    const lineChart = echarts.init(lineEl, 'sauce', {
        renderer: location.search.includes('svg') ? 'svg' : 'canvas',
    });
    const cpuSoftCeil = 100;
    const memSoftCeil = 1024;
    const options = {
        visualMap: [{
            show: false,
            type: 'continuous',
            hoverLink: false,
            seriesIndex: 1,
            min: 0,
            max: memSoftCeil,
            z: 0,
            inRange: {
                color: ['#226', '#83a', '#e22'],
                opacity: [0, 0.8],
            },
        }, {
            show: false,
            type: 'continuous',
            hoverLink: false,
            seriesIndex: 0,
            min: 0,
            max: cpuSoftCeil,
            inRange: {
                color: ['#dbdb00', '#a600db'],
                opacity: [0, 0.8],
            },
        }],
        grid: {
            top: 20,
            left: 20,
            right: 20,
            bottom: 14,
        },
        title: [{
            left: 'left',
            text: `${spec ? spec.prettyName : ''} ${decodedNames[proc.type] || proc.name || proc.type}, PID: ${proc.pid}`,
        }],
        tooltip: {
            trigger: 'axis',
            confine: true,
            valueFormatter: H.number
            //formatter: '{a} {b} {c} {d}',
        },
        xAxis: [{
            show: false,
            data: Array.from(new Array(maxLen)).map((x, i) => i),
        }],
        yAxis: [{
            show: false,
            name: 'CPU',
            min: 0,
            max: x => Math.max(cpuSoftCeil, x.max),
            axisLabel: {
                align: 'left',
                formatter: '{value}%',
            }
        }, {
            show: false,
            min: 0,
            max: x => Math.max(memSoftCeil, x.max),
        }],
        series: [{
            id: 'cpu',
            name: 'CPU',
            type: 'line',
            showSymbol: false,
            emphasis: {disabled: true},
            tooltip: {
                valueFormatter: x => H.number(x) + '%'
            },
            areaStyle: {},
        }, {
            id: 'mem',
            name: 'Memory',
            type: 'line',
            showSymbol: false,
            emphasis: {disabled: true},
            yAxisIndex: 1,
            tooltip: {
                valueFormatter: x => H.number(x) + 'MB'
            },
            areaStyle: {},
        }]
    };
    lineChart.setOption(options);
    const gaugeChart = new echarts.init(gaugeEl, 'sauce', {
        renderer: location.search.includes('svg') ? 'svg' : 'canvas',
    });
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
        }],
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
    addEventListener('resize', () => {
        for (const {charts} of allCharts.values()) {
            charts.line.resize();
            charts.gauge.resize();
        }
    });
    let iter = 0;
    while (true) {
        const metrics = await common.rpc('pollAppMetrics').catch(e => {
            console.warn("Failed to get metrics:", e);
            return sauce.sleep(1000);
        });
        if (!metrics) {
            continue;
        }
        const unused = new Set(allCharts.keys());
        for (const x of metrics) {
            if (!allCharts.has(x.pid)) {
                const el = document.createElement('div');
                el.classList.add('chart-holder');
                content.appendChild(el);
                allCharts.set(x.pid, {
                    charts: await makeMetricCharts(x, el),
                    el,
                    datas: {
                        cpu: [...sauce.data.range(maxLen - 10)].map(i => 25 + Math.sin(i / 3) * 25),
                        mem: [...sauce.data.range(maxLen - 10)].map(i => 150 + Math.cos(i / 10) * 100),
                        count: maxLen - 10, // Match ^^^
                    },
                });
            }
            unused.delete(x.pid);
            const {charts, datas} = allCharts.get(x.pid);
            const cpu = Math.round(x.cpu.percentCPUUsage * 10);  // XXX why is it 10x off?
            const mem = Number((x.memory.workingSetSize / 1024).toFixed(1));  // MB
            datas.cpu.push(cpu);
            datas.mem.push(mem);
            datas.count++;
            while (datas.cpu.length > maxLen) {
                datas.cpu.shift();
                datas.mem.shift();
            }
            const maxMemIndex = datas.mem.indexOf(sauce.data.max(datas.mem));
            charts.line.setOption({
                xAxis: [{
                    data: [...sauce.data.range(maxLen)].map(i =>
                        (datas.count > maxLen ? datas.count - maxLen : 0) + i)
                }],
                series: [{
                    data: datas.cpu,
                }, {
                    data: datas.mem,
                    markLine: {
                        symbol: 'none',
                        data: [{
                            name: 'Max',
                            xAxis: maxMemIndex,
                            label: {
                                position: maxMemIndex > datas.mem.length / 2 ? 'insideEndTop' : 'insideEndBottom',
                                formatter: x => `${H.number(datas.mem[x.value])}MB`
                            },
                            emphasis: {
                                disabled: true,
                            },
                        }],
                    },
                }]
            });
            charts.gauge.setOption({series: [{data: [{value: Math.round(cpu)}]}]});
        }
        iter++;
        for (const pid of unused) {
            const {charts, el} = allCharts.get(pid);
            allCharts.delete(pid);
            charts.line.dispose();
            charts.gauge.dispose();
            el.remove();
        }
        if (location.search.includes('slow')) {
            await sauce.sleep(iter * 1000);
        }
    }
}
