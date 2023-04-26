import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as charts from './charts.mjs';
import * as echarts from '../deps/src/echarts.mjs';
import * as theme from './echarts-sauce-theme.mjs';
import * as map from './map.mjs';
import * as color from './color.mjs';

echarts.registerTheme('sauce', theme.getTheme('dynamic', {fg: 'intrinsic-inverted', bg: 'intrinsic'}));

common.settingsStore.setDefault({
    preferWkg: false,
});

let ad;
let laps;
let segments;
let streams;
let nations;
let flags;
let worldList;
let sport;
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
    fmt: x => H.power(x, {separator: ' ', suffix: true}),
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
    name: x => sport === 'running' ? 'Pace' : 'Speed',
    color: '#4e3',
    domain: [0, 100],
    rangeAlpha: [0.1, 0.8],
    fmt: x => H.pace(x, {suffix: true, separator: ' '}),
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
    fmt: x => H.power(x, {separator: ' ', suffix: true}),
}];


async function exportFITActivity(name) {
    const fitData = await common.rpc.exportFIT(athleteId);
    const f = new File([new Uint8Array(fitData)], `${name}.fit`, {type: 'application/binary'});
    const l = document.createElement('a');
    l.download = f.name;
    l.style.display = 'none';
    l.href = URL.createObjectURL(f);
    try {
        document.body.appendChild(l);
        l.click();
    } finally {
        URL.revokeObjectURL(l.href);
        l.remove();
    }
}


function getLapStream(stream, lap) {
    const end = lap.endIndex ? lap.endIndex + 1 : undefined;
    return streams[stream].slice(lap.startIndex, end);
}


function createLineChart(el, lap) {
    const timeStream = lap ? getLapStream('time', lap) : streams.time;
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
            show: true,
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
            data: lap ? getLapStream(f.stream, lap) : streams[f.stream],
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
    lineChart.updateData = () => {
        lineChart.setOption({
            xAxis: [{
                data: timeStream.map((x, i) => i),
            }],
            series: fields.map((f, i) => ({
                data: lap ? getLapStream(f.stream, lap) : streams[f.stream],
            }))
        });
    };
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
    createLineChart(row.querySelector('.chart-holder .chart'), lap);
}


async function onSegmentExpand(row, summaryRow) {
    const segment = segments[Number(summaryRow.dataset.segment)];
    const detailTpl = await sauce.template.getTemplate(`templates/analysis/segment-details.html.tpl`);
    row.append(await detailTpl({segment}));
    createLineChart(row.querySelector('.chart-holder .chart'), segment);
}


function onLapCollapse() {
    console.warn("collapse");
}


function powerZoneColors(zones, fn) {
    const colors = {};
    for (const [k, v] of Object.entries(common.getPowerZoneColors(zones))) {
        const c = color.parse(v);
        colors[k] = fn ? fn(c) : c;
    }
    return colors;
}


async function createTimeInPowerZones(el, renderer) {
    const chart = echarts.init(el, 'sauce', {renderer: 'svg'});
    chart.setOption({
        grid: {top: '5%', left: '6%', right: '4', bottom: '3%', containLabel: true},
        tooltip: {
            className: 'ec-tooltip',
            trigger: 'axis',
            axisPointer: {type: 'shadow'}
        },
        xAxis: {type: 'category'},
        yAxis: {
            type: 'value',
            min: 0,
            splitNumber: 2,
            minInterval: 60,
            axisLabel: {
                formatter: H.timer,
                rotate: 50,
                fontSize: '0.6em',
            }
        },
        series: [{
            type: 'bar',
            barWidth: '90%',
            tooltip: {valueFormatter: x => H.timer(x, {long: true})},
        }],
    });
    chartRefs.add(new WeakRef(chart));
    let colors;
    let aid;
    const powerZones = await common.rpc.getPowerZones(1);
    renderer.addCallback(data => {
        if (!data || !data.stats || !data.athlete || !data.athlete.ftp) {
            return;
        }
        const extraOptions = {};
        if (data.athleteId !== aid) {
            aid = data.athleteId;
            colors = powerZoneColors(powerZones, c => ({
                c,
                g: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
                    {offset: 0, color: c.toString()},
                    {offset: 1, color: c.alpha(0.5).toString()}
                ])
            }));
            Object.assign(extraOptions, {xAxis: {data: powerZones.map(x => x.zone)}});
        }
        chart.setOption({
            ...extraOptions,
            series: [{
                data: data.stats.timeInPowerZones.map(x => ({
                    value: x.time,
                    itemStyle: {color: colors[x.zone].g},
                })),
            }],
        });
    });
}


export async function main() {
    common.initInteractionListeners();
    addEventListener('resize', resizeCharts);
    let mainTpl;
    // Poll laps, segments for updates after this. TBD
    [ad, laps, segments, streams, mainTpl, {nations, flags}, worldList] = await Promise.all([
        common.rpc.getAthleteData(athleteId),
        common.rpc.getAthleteLaps(athleteId),
        common.rpc.getAthleteSegments(athleteId),
        common.rpc.getAthleteStreams(athleteId),
        sauce.template.getTemplate(`templates/analysis/main.html.tpl`),
        common.initNationFlags(),
        common.getWorldList(),
    ]);
    const contentEl = await render(mainTpl);
    const exportBtn = document.querySelector('.button.export-file');
    if (!ad || !ad.state) {
        return;
    }
    sport = ad.state.sport;
    const renderer = new common.Renderer(contentEl, {fps: 0.5});
    const athlete = ad.athlete;
    const started = new Date(Date.now() - ad.stats.elapsedTime * 1000);
    const name = `${athlete ? athlete.fLast : athleteId} - ${started.toLocaleString()}`;
    exportBtn.addEventListener('click', () => exportFITActivity(name));
    exportBtn.removeAttribute('disabled');
    common.initExpanderTable(contentEl.querySelector('table.laps'), onLapExpand, onLapCollapse);
    common.initExpanderTable(contentEl.querySelector('table.segments'), onSegmentExpand, onLapCollapse);
    const mainLineChart = createLineChart(contentEl.querySelector('.summary .chart-holder .chart'));
    await createTimeInPowerZones(contentEl.querySelector('.stats.time-in-power-zones'), renderer);
    const zm = new map.SauceZwiftMap({
        el: document.querySelector('#map'),
        worldList,
        zoomMin: 0.05,
    });
    zm.setCourse(ad.state.courseId);
    let histPath;
    const endEntity = new map.MapEntity('end');
    endEntity.transition.setDuration(0);
    zm.addEntity(endEntity);
    if (streams.latlng.length) {
        renderer.setData(ad);
        renderer.render();
        const positions = streams.latlng.map(x => zm.latlngToPosition(x));
        const xMin = sauce.data.min(positions.map(x => x[0]));
        const yMin = sauce.data.min(positions.map(x => x[1]));
        const xMax = sauce.data.max(positions.map(x => x[0]));
        const yMax = sauce.data.max(positions.map(x => x[1]));
        zm.setBounds([xMin, yMax], [xMax, yMin]);
        const start = new map.MapEntity('start');
        start.setPosition(positions[0]);
        zm.addEntity(start);
        endEntity.setPosition(positions.at(-1));
        histPath = zm.addHighlightPath(positions, 'history');
    }
    renderer.addCallback(({state}) => {
        streams.time.push(state.time);
        streams.power.push(state.power);
        streams.cadence.push(state.cadence);
        streams.hr.push(state.heartrate);
        streams.latlng.push(state.latlng);
        streams.speed.push(state.speed);
        streams.draft.push(state.draft);
        endEntity.setPosition(zm.latlngToPosition(state.latlng));
        mainLineChart.updateData(); // XXX EXPENSIVE!!!
        if (histPath) {
            histPath.path.remove();
            histPath.node.remove();
        }
        const positions = streams.latlng.map(x => zm.latlngToPosition(x));
        histPath = zm.addHighlightPath(positions, 'history');
    });
    window.zwiftMap = zm; // XXX
    common.subscribe(`athlete/${athleteId}`, x => {
        renderer.setData(x);
        renderer.render();
    });
}


async function render(tpl) {
    const frag = await tpl({
        ad,
        laps,
        segments,
        streams,
        settings,
        nations,
        flags,
        common,
        worldList,
    });
    const contentEl = document.querySelector('#content');
    contentEl.replaceChildren(frag);
    return contentEl;
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
