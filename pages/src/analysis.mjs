import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as charts from './charts.mjs';
import * as echarts from '../deps/src/echarts.mjs';
import * as theme from './echarts-sauce-theme.mjs';
import * as map from './map.mjs';
import * as color from './color.mjs';
import * as fields from './fields.mjs';

echarts.registerTheme('sauce', theme.getTheme('dynamic', {fg: 'intrinsic-inverted', bg: 'intrinsic'}));

common.settingsStore.setDefault({
    preferWkg: false,
    peakEffortSource: 'power',
});

let laps;
let segments;
let streams;
let sport;

const settings = common.settingsStore.get();
const H = sauce.locale.human;
const q = new URLSearchParams(location.search);
const athleteId = q.get('id') || 'self';
const chartRefs = new Set();

const peakFormatters = {
    power: x => H.power(x, {suffix: true, html: true}),
    speed: x => H.pace(x, {suffix: true, html: true, sport}),
    hr: x => H.number(x, {suffix: 'bpm', html: true}),
    draft: x => H.power(x, {suffix: true, html: true}),
};

const lineChartFields = [{
    id: 'altitude',
    stream: 'altitude',
    name: 'Elevation',
    color: '#333',
    domain: [0, 300],
    rangeAlpha: [0.4, 1],
    fmt: x => H.elevation(x, {separator: ' ', suffix: true}),
}, {
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


async function getTemplate(basename) {
    return await sauce.template.getTemplate(`templates/analysis/${basename}.html.tpl`);
}


async function getTemplates(basenames) {
    return Object.fromEntries(await Promise.all(basenames.map(k =>
        sauce.template.getTemplate(`templates/analysis/${k}.html.tpl`).then(v =>
            // camelCase conv keys-with_snakecase--chars
            [k.replace(/[-_]+(.)/g, (_, x) => x.toUpperCase()), v]))));
}


async function updateTemplate(selector, tpl, attrs) {
    const frag = await tpl(attrs);
    document.querySelector(selector).replaceWith(frag);
}


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
    const fields = lineChartFields.filter(x => settings[x.id + 'En'] !== false);
    const lineChart = echarts.init(el, 'sauce', {renderer: 'svg'});
    const options = {
        animation: false, // slow and we want a responsive interface not a pretty static one
        color: fields.map(f => f.color),
        visualMap: fields.map((f, i) => ({
            show: false,
            type: 'continuous',
            hoverLink: false,
            seriesIndex: i,
            min: f.domain[0],
            max: f.domain[1],
            inRange: {colorAlpha: f.rangeAlpha},
        })),
        axisPointer: {link: [{xAxisIndex: 'all'}]},
        grid: fields.map((_, i) => {
            const topPad = 2;
            const seriesPad = 2;
            const bottomPad = 4;
            return {
                top: `${topPad + i / fields.length * (100 - topPad - bottomPad)}%`,
                height: `${(100 - topPad - bottomPad) / fields.length - seriesPad}%`,
                right: 12, // just enough for angle labels on end of xaxis
                left: 36,  // tuned to axixLabel rotate of 55
            };
        }),
        tooltip: {
            trigger: 'axis',
            axisPointer: {label: {formatter: () => void 0}}, // XXX there must be a better way
        },
        xAxis: fields.map((f, i) => ({
            type: 'time',
            gridIndex: i,
            splitNumber: el.clientWidth / 110 | 0,
            axisTick: {
                show: i === fields.length - 1,
            },
            axisLabel: {
                show: i === fields.length - 1,
                formatter: t => H.timer(t / 1000),
            },
        })),
        yAxis: fields.map((f, i) => ({
            type: 'value',
            show: true,
            name: typeof f.name === 'function' ? f.name() : f.name,
            nameLocation: 'end',
            nameRotate: 0,
            nameGap: -12,
            nameTextStyle: {
                fontSize: '0.65em',
                fontWeight: 600,
                fontFamily: 'inherit',
                align: 'left',
                padding: [0, 0, 0, 4],
            },
            gridIndex: i,
            min: x => Math.min(f.domain[0], x.min),
            max: x => Math.max(f.domain[1], x.max),
            splitNumber: undefined,
            interval: Infinity, // disable except for min/max
            axisLine: {
                show: true,
            },
            splitLine: {
                show: false,
            },
            axisLabel: {
                rotate: 55,
                showMinLabel: false,
                formatter: H.number,
            },
        })),
        series: fields.map((f, i) => ({
            type: 'line',
            showSymbol: false,
            emphasis: {disabled: true},
            areaStyle: {},
            id: f.id,
            name: typeof f.name === 'function' ? f.name() : f.name,
            z: fields.length - i + 1,
            xAxisIndex: i,
            yAxisIndex: i,
            tooltip: {valueFormatter: f.fmt},
            lineStyle: {color: f.color},
        })),
        toolbox: {show: false},
        brush: {
            brushLink: 'all',
            brushType: 'lineX', // default
            brushMode: 'single', // default
            brushStyle: {
                color: 'var(--selection-color)',
                borderWidth: 'var(--selection-border-width)',
                borderColor: 'var(--selection-border-color)',
            },
        }
    };
    lineChart.setOption(options);
    lineChart._sauceLegend = new charts.SauceLegend({
        el: el.closest('.chart-holder').querySelector('.legend'),
        chart: lineChart,
        hiddenStorageKey: `analysis-hidden-graph`,
    });
    lineChart.updateData = () => {
        const timeStream = lap ? getLapStream('time', lap) : streams.time;
        lineChart.setOption({
            series: fields.map(f => ({
                data: (lap ? getLapStream(f.stream, lap) : streams[f.stream])
                    .map((x, i) => [timeStream[i] * 1000, x]),
            }))
        });
    };
    lineChart.updateData();
    // This is the only way to enable brush selection by default. :/
    lineChart.dispatchAction({
        type: 'takeGlobalCursor',
        key: 'brush',
        brushOption: {
            brushType: 'lineX',
            brushMode: 'single',
        }
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
    const detailTpl = await getTemplate('lap-details');
    row.append(await detailTpl({lap}));
    createLineChart(row.querySelector('.chart-holder .chart'), lap);
}


async function onSegmentExpand(row, summaryRow) {
    const segment = segments[Number(summaryRow.dataset.segment)];
    const detailTpl = await getTemplate('segment-details');
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


async function createTimeInPowerZonesPie(el, renderer) {
    const chart = echarts.init(el, 'sauce', {renderer: 'svg'});
    chart.setOption({
        grid: {top: '1', left: '1', right: '1', bottom: '1'},
        tooltip: {
            className: 'ec-tooltip'
        },
        series: [{
            type: 'pie',
            radius: ['30%', '90%'],
            minShowLabelAngle: 20,
            label: {
                show: true,
                position: 'inner',
            },
            tooltip: {
                valueFormatter: x => H.timer(x, {long: true})
            },
            emphasis: {
                itemStyle: {
                    shadowBlur: 10,
                    shadowOffsetX: 0,
                    shadowColor: 'rgba(0, 0, 0, 0.5)'
                }
            }
        }],
    });
    chartRefs.add(new WeakRef(chart));
    let colors;
    let aid;
    let normZones;
    const powerZones = await common.rpc.getPowerZones(1);
    renderer.addCallback(data => {
        if (!data || !data.stats || !data.athlete || !data.athlete.ftp) {
            return;
        }
        if (data.athleteId !== aid) {
            aid = data.athleteId;
            colors = powerZoneColors(powerZones, c => ({
                c,
                g: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
                    {offset: 0, color: c.toString()},
                    {offset: 1, color: c.alpha(0.6).toString()}
                ])
            }));
            normZones = new Set(powerZones.filter(x => !x.overlap).map(x => x.zone));
        }
        chart.setOption({
            series: [{
                data: data.stats.timeInPowerZones.filter(x => normZones.has(x.zone)).map(x => ({
                    name: x.zone,
                    value: x.time,
                    label: {color: colors[x.zone].c.l > 0.65 ? '#000b' : '#fffb'},
                    itemStyle: {color: colors[x.zone].g},
                })),
            }],
        });
    });
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


function centerMap(zwiftMap, positions) {
    const xMin = sauce.data.min(positions.map(x => x[0]));
    const yMin = sauce.data.min(positions.map(x => x[1]));
    const xMax = sauce.data.max(positions.map(x => x[0]));
    const yMax = sauce.data.max(positions.map(x => x[1]));
    zwiftMap.setBounds([xMin, yMax], [xMax, yMin]);
}


export async function main() {
    common.initInteractionListeners();
    addEventListener('resize', resizeCharts);
    let ad;
    const [_ad, _laps, _segments, _streams, templates, nationFlags, worldList] = await Promise.all([
        common.rpc.getAthleteData(athleteId),
        common.rpc.getAthleteLaps(athleteId),
        common.rpc.getAthleteSegments(athleteId),
        common.rpc.getAthleteStreams(athleteId),
        getTemplates(['main', 'activity-summary', 'selection-stats', 'peak-efforts']),
        common.initNationFlags(),
        common.getWorldList(),
    ]);
    ad = _ad, laps = _laps, segments = _segments, streams = _streams;
    console.log({ad, streams});
    const contentEl = document.querySelector('#content');
    contentEl.replaceChildren(await templates.main({
        ad,
        laps,
        segments,
        streams,
        templates,
        nationFlags,
        worldList,
        settings,
        common,
        peakFormatters,
    }));
    const exportBtn = document.querySelector('.button.export-file');
    if (!ad?.state) {
        return;
    }
    sport = ad.state.sport;
    const renderer = new common.Renderer(contentEl, {fps: 1, backgroundRender: true});
    renderer.addRotatingFields({
        mapping: [{
            id: 'testing-1',
            default: 'grade',
        }],
        fields: fields.fields
    });
    const athlete = ad.athlete;
    const started = new Date(Date.now() - ad.stats.elapsedTime * 1000);
    const name = `${athlete ? athlete.fLast : athleteId} - ${started.toLocaleString()}`;
    exportBtn.addEventListener('click', () => exportFITActivity(name));
    exportBtn.removeAttribute('disabled');
    common.initExpanderTable(contentEl.querySelector('table.laps'), onLapExpand, onLapCollapse);
    common.initExpanderTable(contentEl.querySelector('table.segments'), onSegmentExpand, onLapCollapse);
    const mainLineChart = createLineChart(contentEl.querySelector('.analysis .chart-holder .chart'));
    //await createTimeInPowerZones(contentEl.querySelector('.time-in-power-zones'), renderer);
    await createTimeInPowerZonesPie(contentEl.querySelector('.time-in-power-zones'), renderer);
    const zwiftMap = new map.SauceZwiftMap({
        el: document.querySelector('#map'),
        worldList,
        zoomMin: 0.05,
    });
    window.zwiftMap = zwiftMap; // debug
    let voidAutoCenter;
    zwiftMap.addEventListener('drag', () => voidAutoCenter = true);
    zwiftMap.addEventListener('zoom', () => voidAutoCenter = true);
    zwiftMap.setCourse(ad.state.courseId);
    let histPath;
    const endEntity = new map.MapEntity('end');
    endEntity.transition.setDuration(0);
    zwiftMap.addEntity(endEntity);
    const positions = [];
    if (streams.latlng.length) {
        renderer.setData(ad);
        renderer.render();
        for (const x of streams.latlng) {
            positions.push(zwiftMap.latlngToPosition(x));
        }
        centerMap(zwiftMap, positions);
        const start = new map.MapEntity('start');
        start.setPosition(positions[0]);
        zwiftMap.addEntity(start);
        endEntity.setPosition(positions.at(-1));
        histPath = zwiftMap.addHighlightPath(positions, 'history');
    }
    let lastPeaksSig;
    renderer.addCallback(async x => {
        ad = x;
        await updateTemplate('.activity-summary', templates.activitySummary, {ad});
        if (!document.activeElement || !document.activeElement.closest('.peak-efforts')) {
            const sig = JSON.stringify(ad.stats[settings.peakEffortSource].peaks);
            if (sig !== lastPeaksSig) {
                lastPeaksSig = sig;
                await updateTemplate('.peak-efforts', templates.peakEfforts, {ad, settings, peakFormatters});
            }
        }
        await updateTemplate('.selection-stats', templates.selectionStats, {ad});
    });
    contentEl.addEventListener('input', async ev => {
        const peakSource = ev.target.closest('select[name="peak-effort-source"]');
        if (!peakSource) {
            return;
        }
        common.settingsStore.set('peakEffortSource', peakSource.value);
        console.log(settings);
        await updateTemplate('.peak-efforts', templates.peakEfforts, {ad, settings, peakFormatters});
    });
    // Always use streams for data to avoid ambiguous differences in state data.
    setInterval(async () => {
        streams = await common.rpc.getAthleteStreams(athleteId);
        positions.push(...streams.latlng.slice(positions.length)
            .map(x => zwiftMap.latlngToPosition(x)));
        endEntity.setPosition(positions.at(-1));
        if (!voidAutoCenter) {
            centerMap(zwiftMap, positions);
        }
        if (histPath) {
            histPath.path.remove();
            histPath.node.remove();
        }
        histPath = zwiftMap.addHighlightPath(positions, 'history');
        mainLineChart.updateData(); // XXX EXPENSIVE (update, still with animation false?)
    }, 2000);
    setInterval(async () => {
        segments = await common.rpc.getAthleteSegments(athleteId);
        laps = await common.rpc.getAthleteLaps(athleteId),
        console.warn("render to template");
    }, 10000);
    common.subscribe(`athlete/${athleteId}`, x => {
        renderer.setData(x);
        renderer.render();
    });
}



export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
