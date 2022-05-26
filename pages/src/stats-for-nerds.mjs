import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as echarts from '../deps/src/echarts.mjs';
import {theme} from './echarts-sauce-theme.mjs';

echarts.registerTheme('sauce', theme);

const L = sauce.locale;
const H = L.human;
const maxLen = 150;
const MB = 1024 * 1024;


async function makeMetricCharts(proc, el) {
    const decodedNames = {
        Browser: 'Backend Service', // node
        GPU: 'GPU Bridge', // not GPU usage but the proc that proxies GPU ops.
        Tab: 'Window',
    };
    const spec = await common.rpc.getWindowSpecForPID(proc.pid);
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
    const memSoftCeil = 2048;
    const options = {
        visualMap: [{
            show: false,
            type: 'continuous',
            hoverLink: false,
            seriesIndex: 0,
            min: 0,
            max: cpuSoftCeil,
            inRange: {
                color: ['#fff', '#ff4', '#fc2', '#f44'],
                colorAlpha: [0.5, 0.9],
            },
        }, {
            show: false,
            type: 'continuous',
            hoverLink: false,
            seriesIndex: 1,
            min: 0,
            max: memSoftCeil,
            z: 0,
            inRange: {
                color: ['#33f', '#33f', '#50c', '#e22'],
                colorAlpha: [0.5, 0.9],
            },
        }],
        grid: {
            top: 30,
            left: 10,
            right: 10,
            bottom: 10,
        },
        title: [{
            left: 'left',
            text: `${spec ? spec.prettyName : ''} ${spec && spec.subWindow ? 'Sub' : ''} ` +
                `${decodedNames[proc.type] || proc.name || proc.type}, PID: ${proc.pid}`,
        }],
        tooltip: {
            trigger: 'axis',
            confine: true,
            valueFormatter: H.number
        },
        xAxis: [{
            show: false,
            data: Array.from(new Array(maxLen)).map((x, i) => i),
        }],
        yAxis: [{
            show: false,
            name: 'CPU',
            min: 0,
            max: x => Math.max(cpuSoftCeil, x.max || 0),
            axisLabel: {
                align: 'left',
                formatter: '{value}%',
            }
        }, {
            show: false,
            min: 0,
            max: x => Math.max(memSoftCeil, x.max || 0),
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
    const commonGaugeSeries = {
        type: 'gauge',
        radius: '95%',
        axisLine: {
            roundCap: true,
            lineStyle: {
                color: [[1, '#777']],
                width: 10,
            },
        },
        progress: {
            show: true,
            roundCap: true,
            width: 10,
        },
        pointer: {
            length: 40,
            width: 3,
            itemStyle: {
                icon: 'circle',
            }
        },
        anchor: {
            show: true,
            showAbove: true,
            size: 10,
            itemStyle: {
                color: '#aaa',
                borderColor: '#000',
                borderWidth: 3,
            }
        },
        axisTick: {
            show: false,
        },
        splitLine: {
            show: false,
        },
        axisLabel: {
            show: false,
        },
        data: [],
    };
    gaugeChart.setOption({
        visualMap: [{
            show: false,
            type: 'continuous',
            hoverLink: false,
            seriesIndex: 0,
            min: 0,
            max: cpuSoftCeil,
            inRange: {
                color: ['#fff', '#ff4', '#fc2', '#f44'],
                colorAlpha: [0.5, 0.9],
            },
        }, {
            show: false,
            type: 'continuous',
            hoverLink: false,
            seriesIndex: 1,
            min: 0,
            max: memSoftCeil,
            inRange: {
                color: ['#33f', '#33f', '#50c', '#e22'],
                colorAlpha: [0.5, 0.9],
            }
        }],
        series: [{
            ...commonGaugeSeries,
            name: 'CPU',
            startAngle: 200,
            endAngle: 40,
            min: 0,
            max: cpuSoftCeil,
            center: ['30%', '60%'],
            itemStyle: {
                color: '#fc3',
            },
            detail: {
                offsetCenter: [0, '50%'],
                formatter: '{value}%',
            },
        }, {
            ...commonGaugeSeries,
            name: 'Memory',
            startAngle: 200,
            endAngle: 340,
            min: 0,
            max: memSoftCeil,
            center: ['70%', '60%'],
            itemStyle: {
                color: '#33f',
            },
            detail: {
                offsetCenter: [0, '50%'],
                formatter: x => H.number(x) + 'MB',
            },
        }],
    });
    return {
        line: lineChart,
        gauge: gaugeChart,
    };
}


const friendlyPlatforms = {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux',
};


const unit = x => `<abbr class="unit">${x}</abbr>`;
const debugFormatters = {
    uptime: x => H.timer(x.app.uptime),
    version: x => x.app.version,
    appCPU: x => H.number((x.app.cpu.user + x.app.cpu.system) / 1000000 / x.app.uptime * 100) + unit('%'),
    appMemHeap: x => H.number(x.app.mem.heapTotal / MB) + unit('MB'),
    os: x => `${friendlyPlatforms[x.sys.platform]} ${x.sys.productVersion}`,
    arch: x => `${x.sys.arch}`,
    sysUptime: x => H.duration(x.sys.uptime, {short: true}),
    sysMem: x => H.number(x.sys.mem.total / 1024 / 1024) + unit('GB'),
    gpu: x => x.sys.gpu.status.gpu_compositing,
    statesDropped: x => H.number(x.game.stateDupCount) + ' / ' + H.number(x.game.stateStaleCount),
    dbRowsAthletes: x => H.number(x.databases.find(x => x.tableName === 'athletes').rows) + unit('rows'),
    dbRowsSettings: x => H.number(x.databases.find(x => x.tableName === 'store').rows) + unit('rows'),
};
function defaultDebugFormatter(path) {
    return data => {
        for (const p of path.split('.')) {
            data = data[p];
        }
        return H.number(data);
    };
}


export async function main() {
    common.initInteractionListeners();
    const debugEl = document.querySelector('section.debug-info');
    const graphsEl = document.querySelector('section.metrics .graphs');
    const allCharts = new Map();
    addEventListener('resize', () => {
        for (const {charts} of allCharts.values()) {
            charts.line.resize();
            charts.gauge.resize();
        }
    });
    let iter = 0;
    while (true) {
        const metrics = await common.rpc.pollAppMetrics().catch(e =>
            void console.warn("Failed to get metrics:", e));
        const debugInfo = await common.rpc.getDebugInfo().catch(e =>
            void console.warn("Failed to get debugInfo:", e));
        if (!metrics || !debugInfo) {
            await sauce.sleep(1000);
            continue;
        }
        for (const el of debugEl.querySelectorAll('value[data-id]')) {
            const fmt = debugFormatters[el.dataset.id] || defaultDebugFormatter(el.dataset.id);
            el.innerHTML = fmt(debugInfo);
        }
        const unused = new Set(allCharts.keys());
        for (const x of metrics) {
            if (!allCharts.has(x.pid)) {
                const el = document.createElement('div');
                el.classList.add('chart-holder');
                graphsEl.appendChild(el);
                allCharts.set(x.pid, {
                    charts: await makeMetricCharts(x, el),
                    el,
                    datas: {
                        //cpu: [...sauce.data.range(maxLen - 10)].map(i => 25 + Math.sin(i / 3) * 25),
                        //mem: [...sauce.data.range(maxLen - 10)].map(i => 150 + Math.cos(i / 10) * 100),
                        //count: maxLen - 10, // Match ^^^
                        cpu: [],
                        mem: [],
                        count: 0,
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
                                position: maxMemIndex > maxLen / 2 ? 'insideEndTop' : 'insideEndBottom',
                                formatter: x => `${H.number(datas.mem[x.value])}MB`
                            },
                            emphasis: {
                                disabled: true,
                            },
                        }],
                    },
                }]
            });
            const gaugeTitle = {
                offsetCenter: [0, '-40%'],
                color: '#fffa',
                fontSize: 12,
                fontWeight: 700,
                textShadowColor: '#000',
                textShadowBlur: 3,
            };
            charts.gauge.setOption({
                series: [{
                    data: [{name: 'CPU', value: Math.round(cpu), title: gaugeTitle}],
                }, {
                    data: [{name: 'Mem', value: Math.round(mem), title: gaugeTitle}],
                }]
            });
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
