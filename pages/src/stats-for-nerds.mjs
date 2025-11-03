import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as echarts from '../deps/src/echarts.mjs';
import {cssColor, getTheme} from './echarts-sauce-theme.mjs';

common.enableSentry();
echarts.registerTheme('sauce', getTheme('dynamic-alt'));

const L = sauce.locale;
const H = L.human;
const maxLen = 150;
const MB = 1024 * 1024;

let sortByCPU = true;
let filters = [];


async function makeMetricCharts(proc, el) {
    const decodedNames = {
        Browser: 'Backend Service', // node
        GPU: 'GPU Bridge', // not GPU usage but the ps that proxies to GPU or does SW rendering.
        Tab: 'Window',
    };
    const {spec, title, subWindow} = proc.type !== 'Node' &&
        (await common.rpc.getWindowInfoForPID(proc.pid)) ||
        {};
    const lineEl = document.createElement('div');
    const gaugeEl = document.createElement('div');
    lineEl.classList.add('chart', 'line');
    gaugeEl.classList.add('chart',  'gauge');
    el.appendChild(lineEl);
    el.appendChild(gaugeEl);
    const lineChart = echarts.init(lineEl, 'sauce', {renderer: 'svg'});
    const cpuSoftCeil = 100;
    const memSoftCeil = 2048;
    const titleText = `${spec ? (common.stripHTML(spec.prettyName) + ' ') : ''}${subWindow ? 'Sub ' : ''}` +
        `${decodedNames[proc.type] || proc.name || proc.type}${title ? ` (${title})` : ''}, PID: ${proc.pid}`;
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
            top: 20,
            left: 1,
            right: 10,
            bottom: 10,
        },
        title: [{
            left: 'left',
            text: titleText,
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
            animation: false,
            emphasis: {disabled: true},
            tooltip: {valueFormatter: x => H.number(x, {suffix: '%'})},
            areaStyle: {},
        }, {
            id: 'mem',
            name: 'Memory',
            type: 'line',
            showSymbol: false,
            animation: false,
            emphasis: {disabled: true},
            yAxisIndex: 1,
            tooltip: {valueFormatter: x => H.number(x, {suffix: 'MB'})},
            areaStyle: {},
        }]
    };
    lineChart.setOption(options);
    const gaugeChart = new echarts.init(gaugeEl, 'sauce', {renderer: 'svg'});
    const gWidth = 8;
    const commonGaugeSeries = {
        type: 'gauge',
        radius: '95%',
        animation: false,
        axisLine: {
            roundCap: true,
            lineStyle: {
                color: [[1, '#777']],
                width: gWidth,
            },
        },
        progress: {
            show: true,
            roundCap: true,
            width: gWidth,
        },
        pointer: {
            length: 25,
            width: 3,
            itemStyle: {icon: 'circle', borderWidth: 1.5, borderColor: '#fff5'}
        },
        anchor: {
            show: true,
            showAbove: true,
            size: gWidth,
            itemStyle: {
                color: '#aaa',
                borderColor: '#000',
                borderWidth: 3,
            }
        },
        axisTick: {show: false},
        splitLine: {show: false},
        axisLabel: {show: false},
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
            itemStyle: {color: '#fc3'},
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
            itemStyle: {color: '#33f'},
            detail: {
                offsetCenter: [0, '50%'],
                formatter: x => H.number(x, {suffix: 'MB'}),
            },
        }],
    });
    return {
        line: lineChart,
        gauge: gaugeChart,
        filterText: titleText.toLowerCase(),
    };
}


const friendlyPlatforms = {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux',
};


const debugFormatters = {
    uptime: x => H.timer(x.app.uptime, {html:true, long: true}),
    version: x => x.app.version,
    appCPU: x => H.number(x.cpuTotal, {suffix: '%', html: true}),
    appMem: x => H.number(x.memTotal / 1024, {suffix: 'GB', precision: 1, html: true}),
    os: x => `${friendlyPlatforms[x.sys.platform]} ${x.sys.productVersion}`,
    cpuModel: x => x.sys.cpus[0]?.model || x.sys.arch,
    cpuCores: x => x.sys.cpus.length,
    cpuSpeed: x => H.number(sauce.data.avg(x.sys.cpus.map(x => x.speed / 1000)),
                            {suffix: 'Ghz', precision: 1, fixed: true, html: true}),
    sysMem: x => H.number(x.sys.mem.total / MB, {suffix: 'GB', html: true}),
    gpu: x => x.gpu?.gpu_compositing || 'n/a',
    statesDups: x => H.number(x.stats.stateDupCount),
    statesStale: x => H.number(x.stats.stateStaleCount),
    dbRowsAthletes: x => H.number(
        x.databases.find(xx => xx.tableName === 'athletes').rows, {suffix: 'rows', html: true}),
    dbRowsSettings: x => H.number(
        x.databases.find(xx => xx.tableName === 'store').rows, {suffix: 'rows', html: true}),
    zwiftActive: x => x.zwift.active ? 'active' : 'inactive'
};


function defaultDebugFormatter(path, type) {
    if (!type) {
        debugger;
    }
    return data => {
        for (const p of path.split('.')) {
            data = data[p];
        }
        return {
            number: H.number,
            string: x => x,
            timer: x => H.timer(x, {long: true, html: true}),
            msDuration: x => H.number(x, {suffix: 'ms', html: true}),
            time: x => H.time(x, {style: 'default'}),
        }[type || 'string'](data);
    };
}


export async function main() {
    common.initInteractionListeners();
    const debugEl = document.querySelector('section.debug-info');
    const processesEl = document.querySelector('section.metrics .processes');
    const allCharts = new Map();
    addEventListener('resize', () => {
        for (const {charts} of allCharts.values()) {
            charts.line.resize();
            charts.gauge.resize();
        }
    });
    document.querySelector('input[name="sort-by-cpu"]').addEventListener('click', ev =>
        sortByCPU = ev.currentTarget.checked);
    document.querySelector('input[name="filter"]').addEventListener('input', ev => {
        filters = ev.currentTarget.value.split(/[, |]+/).filter(x => x).map(x => x.toLowerCase());
        console.debug("Filters:", filters);
    });
    let iter = 0;
    while (true) {
        const metrics = await common.rpc.pollMetrics().catch(e =>
            void console.warn("Failed to get metrics:", e));
        const debugInfo = await common.rpc.getDebugInfo().catch(e =>
            void console.warn("Failed to get debugInfo:", e));
        if (!metrics || !debugInfo) {
            await sauce.sleep(1000);
            continue;
        }
        const cpuCount = debugInfo.sys.cpus.length;
        const unused = new Set(allCharts.keys());
        let cpuTotal = 0;
        let memTotal = 0;
        for (const metric of metrics) {
            if (!allCharts.has(metric.pid)) {
                const el = document.createElement('div');
                el.classList.add('chart-holder');
                processesEl.appendChild(el);
                const {filterText, ...charts} = await makeMetricCharts(metric, el);
                allCharts.set(metric.pid, {
                    filterText,
                    charts,
                    el,
                    datas: {
                        cpu: [],
                        mem: [],
                        count: 0,
                    },
                });
            }
            unused.delete(metric.pid);
            const {charts, datas, filterText, el} = allCharts.get(metric.pid);
            if (filters.length && !filters.some(x => filterText.match(x))) {
                el.classList.add('hidden');
                continue;
            }
            el.classList.remove('hidden');
            const cpu = metric.cpu.percentCPUUsage * cpuCount; // % of one core
            const mem = metric.memory.workingSetSize / 1024; // MB
            cpuTotal += cpu;
            memTotal += mem;
            datas.cpu.push(Math.round(cpu));
            datas.mem.push(Number(mem.toFixed(1)));
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
                        label: {
                            rotate: 0,
                            position: maxMemIndex > maxLen / 2 ? 'insideEndTop' : 'insideStartTop',
                            formatter: x => H.number(datas.mem[x.value], {suffix: 'MB'}),
                            distance: [3, 35],
                            opacity: 0.8,
                        },
                        emphasis: {disabled: true},
                        data: [{xAxis: maxMemIndex}],
                    },
                }]
            });
            const gaugeTitle = {
                offsetCenter: [0, '-40%'],
                color: cssColor('fg-alt', 0, 0.9),
                fontSize: 12,
                fontWeight: 600,
            };
            charts.gauge.setOption({
                series: [{
                    data: [{name: 'CPU', value: Math.round(cpu), title: gaugeTitle}],
                }, {
                    data: [{name: 'Mem', value: Math.round(mem), title: gaugeTitle}],
                }]
            });
        }
        Object.assign(debugInfo, {cpuTotal, memTotal});
        for (const el of debugEl.querySelectorAll('value[data-id]')) {
            const fmt = debugFormatters[el.dataset.id] ||
                defaultDebugFormatter(el.dataset.id, el.dataset.type);
            el.innerHTML = fmt(debugInfo);
            el.title = el.textContent;
        }
        iter++;
        for (const pid of unused) {
            const {charts, el} = allCharts.get(pid);
            allCharts.delete(pid);
            charts.line.dispose();
            charts.gauge.dispose();
            el.remove();
        }

        if (sortByCPU) {
            const byCPU = Array.from(allCharts.values()).map(x =>
                [x.datas.cpu.slice(-30).reduce((a, x) => a + x, 0) / Math.min(30, x.datas.cpu.length), x.el]);
            byCPU.sort((a, b) => b[0] - a[0]);
            for (const [i, {1: el}] of byCPU.entries()) {
                el.style.setProperty('order', i);
            }
        }
        if (window.location.search.includes('slow')) {
            await sauce.sleep(iter * 1000);
        }
    }
}
