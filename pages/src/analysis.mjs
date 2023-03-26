import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';

common.settingsStore.setDefault({
    preferWkg: false,
});

let stats;
let athlete;
let laps;
let segments;
let streams;
const settings = common.settingsStore.get();
const H = sauce.locale.human;
const q = new URLSearchParams(location.search);
const athleteId = q.get('id') || 'self';
const chartRefs = new Set();

const lineChartFields = [{
    id: 'power',
    stream: 'power',
    name: 'Power',
    color: '#46f',
    domain: [0, 700],
    rangeAlpha: [0.4, 1],
    fmt: x => H.power(x, {seperator: ' ', suffix: true}),
}, {
    id: 'hr',
    stream: 'hr',
    name: 'HR',
    color: '#e22',
    domain: [70, 190],
    rangeAlpha: [0.1, 0.7],
    fmt: x => H.number(x, {suffix: ' bpm'}),
}, {
    id: 'speed',
    stream: 'speed',
    name: x => x.sport === 'running' ? 'Pace' : 'Speed',
    color: '#4e3',
    domain: [0, 100],
    rangeAlpha: [0.1, 0.8],
    fmt: x => H.pace(x, {suffix: true, seperator: ' '}),
}, {
    id: 'cadence',
    stream: 'cadence',
    name: 'Cadence',
    color: '#ee1',
    domain: [0, 140],
    rangeAlpha: [0.1, 0.8],
    fmt: x => H.number(x, {suffix: ' rpm'}),
}, {
    id: 'draft',
    stream: 'draft',
    name: 'Draft',
    color: '#e88853',
    domain: [0, 300],
    rangeAlpha: [0.1, 0.9],
    fmt: x => H.number(x, {suffix: ' %'}),
}];


function getLapStream(stream, lap) {
    const end = lap.endIndex ? lap.endIndex + 1 : undefined;
    return streams[stream].slice(lap.startIndex, end);
}


let _themeRegistered = 0;
async function createLineChart(el, lap) {
    const timeStream = getLapStream('time', lap);
    const [charts, echarts, theme] = await Promise.all([
        import('./charts.mjs'),
        import('../deps/src/echarts.mjs'),
        import('./echarts-sauce-theme.mjs'),
    ]);
    if (!_themeRegistered++) {
        echarts.registerTheme('sauce', theme.getTheme('dynamic'));
        addEventListener('resize', resizeCharts);
    }
    const fields = lineChartFields.filter(x => settings[x.id + 'En'] !== false);
    const lineChart = echarts.init(el, 'sauce', {renderer: 'svg'});
    const visualMapCommon = {
        show: false,
        type: 'continuous',
        hoverLink: false,
    };
    const seriesCommon = {
        type: 'line',
        animation: false,  // looks better and saves gobs of CPU
        showSymbol: false,
        emphasis: {disabled: true},
        areaStyle: {},
    };
    const options = {
        color: fields.map(f => f.color),
        visualMap: fields.map((f, i) => ({
            ...visualMapCommon,
            seriesIndex: i,
            min: f.domain[0],
            max: f.domain[1],
            inRange: {colorAlpha: f.rangeAlpha},
        })),
        grid: {top: 0, left: 0, right: 0, bottom: 0},
        legend: {show: false},
        tooltip: {
            trigger: 'axis',
            axisPointer: {label: {formatter: () => ''}}
        },
        xAxis: [{
            show: false,
            data: timeStream.map((x, i) => i),
        }],
        yAxis: fields.map(f => ({
            show: false,
            min: x => Math.min(f.domain[0], x.min),
            max: x => Math.max(f.domain[1], x.max),
        })),
        series: fields.map((f, i) => ({
            ...seriesCommon,
            id: f.id,
            name: typeof f.name === 'function' ? f.name(lap, f) : f.name,
            z: fields.length - i + 1,
            yAxisIndex: i,
            tooltip: {valueFormatter: f.fmt},
            lineStyle: {color: f.color},
            data: getLapStream(f.stream, lap),
            markLine: settings.markMax === f.id ? {
                symbol: 'none',
                data: [{
                    name: f.markMin ? 'Min' : 'Max',
                    xAxis: f.points.indexOf(sauce.data[f.markMin ? 'min' : 'max'](f.points)),
                    label: {
                        formatter: x => {
                            const nbsp ='\u00A0';
                            return [
                                ''.padStart(Math.max(0, 5 - x.value), nbsp),
                                nbsp, nbsp, // for unit offset
                                f.fmt(f.points[x.value]),
                                ''.padEnd(Math.max(0, x.value - (timeStream.length - 1) + 5), nbsp)
                            ].join('');
                        },
                    },
                    emphasis: {disabled: true},
                }],
            } : undefined,
        })),
    };
    lineChart.setOption(options);
    lineChart._sauceLegend = new charts.SauceLegend({
        el: el.closest('.chart-holder').querySelector('.legend'),
        chart: lineChart,
        hiddenStorageKey: `analysis-hidden-graph`,
    });
    chartRefs.add(new WeakRef(lineChart));
    return lineChart;
}


function resizeCharts() {
    for (const r of chartRefs) {
        const c = r.deref();
        if (!c) {
            chartRefs.delete(r);
        } else {
            c.resize();
        }
    }
}


async function onLapExpand(row, summaryRow) {
    const lap = laps[Number(summaryRow.dataset.lap)];
    const detailTpl = await sauce.template.getTemplate(`templates/analysis/lap-details.html.tpl`);
    row.append(await detailTpl({lap}));
    await createLineChart(row.querySelector('.chart-holder .chart'), lap);
}


async function onSegmentExpand(row, summaryRow) {
    const segment = segments[Number(summaryRow.dataset.segment)];
    const detailTpl = await sauce.template.getTemplate(`templates/analysis/segment-details.html.tpl`);
    row.append(await detailTpl({segment}));
    await createLineChart(row.querySelector('.chart-holder .chart'), segment);
}


function onLapCollapse() {
    console.warn("collapse");
}


export async function main() {
    common.initInteractionListeners();
    let mainTpl;
    [stats, laps, segments, streams, mainTpl] = await Promise.all([
        common.rpc.getAthleteData(athleteId),
        common.rpc.getAthleteLaps(athleteId),
        common.rpc.getAthleteSegments(athleteId),
        common.rpc.getAthleteStreams(athleteId),
        sauce.template.getTemplate(`templates/analysis/main.html.tpl`),
    ]);
    athlete = stats && stats.athlete;
    const contentEl = await render(mainTpl);
    if (athlete) {
        common.initExpanderTable(contentEl.querySelector('table.laps'), onLapExpand, onLapCollapse);
        common.initExpanderTable(contentEl.querySelector('table.segments'), onSegmentExpand, onLapCollapse);
        await createLineChart(contentEl.querySelector('section.summary .chart-holder .chart'), stats);
    }
}


async function render(tpl) {
    console.log({laps, segments, stats});
    const frag = await tpl({
        stats,
        athlete,
        laps,
        segments,
        streams,
        settings,
    });
    const contentEl = document.querySelector('#content');
    contentEl.innerHTML = '';
    contentEl.append(frag);
    return contentEl;
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
