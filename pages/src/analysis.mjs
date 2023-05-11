import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as echarts from '../deps/src/echarts.mjs';
import * as theme from './echarts-sauce-theme.mjs';
import * as map from './map.mjs';
import * as color from './color.mjs';
// XXX
// import * as fieldsMod from './fields.mjs';

echarts.registerTheme('sauce', theme.getTheme('dynamic', {fg: 'intrinsic-inverted', bg: 'intrinsic'}));

common.settingsStore.setDefault({
    preferWkg: false,
    peakEffortSource: 'power',
});

let laps;
let segments;
let streams;
let sport;
let elevationChart;
let zoomableChart;
let athleteData;
let templates;
let zoomStart;
let zoomEnd;
let paused;

const settings = common.settingsStore.get();
const H = sauce.locale.human;
const q = new URLSearchParams(location.search);
const athleteIdent = q.get('id') || 'self';
const chartRefs = new Set();
const minVAMTime = 60;
const rolls = {
    power: new sauce.power.RollingPower(null, {idealGap: 1, maxGap: 15}),
};

const peakFormatters = {
    power: x => H.power(x, {suffix: true, html: true}),
    speed: x => H.pace(x, {suffix: true, html: true, sport}),
    hr: x => H.number(x, {suffix: 'bpm', html: true}),
    draft: x => H.power(x, {suffix: true, html: true}),
};

const elevationChartSeries = [{
    id: 'altitude',
    stream: 'altitude',
    name: 'Elevation',
    color: '#bbb',
    domain: [null, 30],
    rangeAlpha: [0.4, 1],
    fmt: x => H.elevation(x, {separator: ' ', suffix: true}),
}];

const zoomableChartSeries = [{
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
    domain: [0, 80],
    rangeAlpha: [0.1, 0.8],
    fmt: x => H.pace(x, {suffix: true, separator: ' ', sport}),
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


async function getTemplates(basenames) {
    return Object.fromEntries(await Promise.all(basenames.map(k =>
        sauce.template.getTemplate(`templates/analysis/${k}.html.tpl`, {html: true}).then(v =>
            // camelCase conv keys-with_snakecase--chars
            [k.replace(/[-_]+(.)/g, (_, x) => x.toUpperCase()), v]))));
}


const _tplSigs = new Map();
async function updateTemplate(selector, tpl, attrs) {
    const html = await tpl(attrs);
    const sig = common.hash(html);
    if (_tplSigs.get(selector) !== sig) {
        _tplSigs.set(selector, sig);
        document.querySelector(selector).outerHTML = html;
    }
}


function getSelectionStats() {
    if (!athleteData) {
        return;
    }
    const powerRoll = rolls.power.slice(zoomStart / 1000, zoomEnd / 1000);
    const activeTime = powerRoll.active();
    const elapsedTime = powerRoll.elapsed();
    const powerAvg = powerRoll.avg({active: true});
    const np = powerRoll.np();
    const athlete = athleteData.athlete;
    const rank = athlete?.weight ?
        sauce.power.rank(activeTime, powerAvg, np, athlete.weight, athlete.gender || 'male') :
        null;
    const start = streams.time.indexOf(powerRoll.firstTime({noPad: true}));
    const end = streams.time.indexOf(powerRoll.lastTime({noPad: true})) + 1;
    const distStream = streams.distance.slice(start, end);
    const altStream = streams.altitude.slice(start, end);
    const hrStream = streams.hr.slice(start, end).filter(x => x);
    const distance = distStream[distStream.length - 1] - distStream[0];
    const {gain, loss} = sauce.geo.altitudeChanges(altStream);
    console.log({distance, activeTime});
    console.log(rank);
    return {
        activeTime,
        elapsedTime,
        athlete,
        sport,
        env: {
            distance,
            speed: distance / 1000 * (3600 / activeTime),
        },
        power: {
            avg: powerAvg,
            max: sauce.data.max(powerRoll.values()),
            np,
            kj: powerRoll.joules() / 1000,
            tss: sauce.power.calcTSS(np > powerAvg ? np : powerAvg, activeTime, athlete?.ftp),
            rank,
        },
        el: {
            gain,
            loss,
            grade: (altStream[altStream.length - 1] - altStream[0]) / distance,
            vam: elapsedTime >= minVAMTime ? (gain / elapsedTime) * 3600 : 0,
        },
        hr: hrStream.length ? {
            avg: sauce.data.avg(hrStream),
            max: sauce.data.max(hrStream),
        } : null
    };
}


async function updateSelectionStats() {
    const selectionStats = getSelectionStats();
    await updateTemplate('.selection-stats', templates.selectionStats, {selectionStats});
}


async function exportFITActivity(name) {
    const fitData = await common.rpc.exportFIT(athleteIdent);
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


function createElevationLineChart(el) {
    const series = elevationChartSeries;
    const xAxes = series.map((x, i) => i);
    const chart = echarts.init(el, 'sauce', {renderer: 'svg'});
    const topPad = 10;
    const seriesPad = 1;
    const bottomPad = 20;
    const leftPad = 36;  // tuned to axisLabel rotate of 55
    const rightPad = 12; // just enough for angle labels on end of xaxis
    let pointerActionTaken = true;
    let updateDeferred;
    console.log(el.clientWidth);

    const options = {
        animation: false, // slow and we want a responsive interface not a pretty static one
        color: series.map(f => f.color),
        legend: {show: false},  // required for sauceLegned to toggle series
        visualMap: series.map((f, i) => ({
            show: false,
            type: 'continuous',
            hoverLink: false,
            seriesIndex: i,
            min: f.domain[0],
            max: f.domain[1],
            inRange: {colorAlpha: f.rangeAlpha},
        })),
        axisPointer: {link: [{xAxisIndex: 'all'}]},
        grid: series.map((x, i) => {
            const count = series.length;
            return {
                top: `${topPad + i / count * (100 - topPad - bottomPad)}%`,
                height: `${(100 - topPad - bottomPad) / count - seriesPad}%`,
                left: leftPad,
                right: rightPad,
            };
        }),
        NOdataZoom: [{
            type: 'inside',
            xAxisIndex: xAxes,
            zoomOnMouseWheel: false,
            moveOnMouseMove: false,
            moveOnMouseWheel: false,
            preventDefaultMouseMove: true,
            zoomLock: true, // workaround for https://github.com/apache/echarts/issues/10079
        }],
        brush: {
            brushLink: 'all',
            seriesIndex: xAxes,
            xAxisIndex: xAxes,
            brushType: 'lineX',
            brushMode: 'single',
            brushStyle: {
                color: 'var(--selection-color)',
                borderWidth: 'var(--selection-border-width)',
                borderColor: 'var(--selection-border-color)',
            },
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: {label: {formatter: () => void 0}}, // XXX there must be a better way
        },
        xAxis: series.map((f, i) => ({
            show: false,
            type: 'time',
            gridIndex: i,
        })),
        yAxis: series.map((f, i) => ({
            type: 'value',
            gridIndex: i,
            min: x => f.domain[0] != null ? Math.min(f.domain[0], x.min) : x.min,
            max: x => f.domain[1] != null ? Math.max(f.domain[1], x.max) : x.max,
            splitNumber: undefined,
            interval: Infinity, // disable except for min/max
            axisLine: {show: false},
            splitLine: {show: false},
            axisLabel: {
                rotate: 55,
                showMinLabel: true,
                formatter: H.number,
            },
        })),
        series: series.map((f, i) => ({
            type: 'line',
            animation: false,
            showSymbol: false,
            emphasis: {disabled: true},
            areaStyle: {origin: 'start'},
            id: f.id,
            name: typeof f.name === 'function' ? f.name() : f.name,
            z: series.length - i + 1,
            xAxisIndex: i,
            yAxisIndex: i,
            tooltip: {valueFormatter: f.fmt},
            lineStyle: {color: f.color},
        })),
        toolbox: {show: false},
    };
    chart.setOption(options);
    chart.updateData = () => {
        if (paused) {
            updateDeferred = true;
            return;
        }
        updateDeferred = false;
        chart.setOption({
            /*dataZoom: [{
                startValue: zoomStart,
                endValue: zoomEnd,
            }],*/
            series: series.map(f => ({
                data: streams[f.stream].map((x, i) => [streams.time[i] * 1000, x]),
            }))
        });
    };
    chart.setSelection = (startValue, endValue) => {
        startValue *= 1000;
        endValue *= 1000;
        chart.dispatchAction({type: 'dataZoom', startValue, endValue});
    };
    chart.on('datazoom', ev => {
        pointerActionTaken = true;
        console.warn('elevation DATAZOOM', ev);
        if (ev.start !== undefined || ev.end !== undefined) {
            if (ev.start !== 0 || ev.end !== 100) {
                throw new Error('non-reset percent based datazoom is unsupported');
            }
            zoomStart = undefined;
            zoomEnd = undefined;
        } else {
            zoomStart = ev.startValue;
            zoomEnd = ev.endValue;
        }
    });
    chart.on('brush', ev => {
        pointerActionTaken = true;
        if (ev.areas.length) {
            const range = ev.areas[0].coordRange;
            zoomStart = range[0];
            zoomEnd = range[1];
        }
    });
    chart.on('brushEnd', ev => {
        pointerActionTaken = true;
        if (!ev.areas.length) {
            return;
        }
        const range = ev.areas[0].coordRange;
        /*chart.dispatchAction({
            type: 'dataZoom',
            startValue: range[0],
            endValue: range[1],
        });
        chart.dispatchAction({type: 'brush', areas: []});  // clear selection
        */
    });
    el.addEventListener('pointerdown', () => {
        paused = true;
        pointerActionTaken = false;
    });
    const unpause = () => {
        paused = false;
        if (!pointerActionTaken) {
            chart.dispatchAction({type: 'dataZoom', start: 0, end: 100});
        }
        if (updateDeferred) {
            // Must queue callback to prevent conflict with other mouseup actions.
            requestAnimationFrame(chart.updateData);
        }
    };
    document.addEventListener('pointercancel', unpause);
    document.addEventListener('pointerup', unpause);
    chart.updateData();
    // This is the only way to enable brush selection by default. :/
    chart.dispatchAction({
        type: 'takeGlobalCursor',
        key: 'brush',
        brushOption: {
            brushType: 'lineX',
            brushMode: 'single',
        }
    });
    chartRefs.add(new WeakRef(chart));
    return chart;
}


function createZoomableLineChart(el) {
    const series = zoomableChartSeries;
    const xAxes = series.map((x, i) => i);
    const chart = echarts.init(el, 'sauce', {renderer: 'svg'});
    const topPad = 3;
    const seriesPad = 1;
    const bottomPad = 8;
    const leftPad = 36;  // tuned to axisLabel rotate of 55
    const rightPad = 12; // just enough for angle labels on end of xaxis
    let pointerActionTaken = true;
    let updateDeferred;
    const options = {
        animation: false, // slow and we want a responsive interface not a pretty static one
        color: series.map(f => f.color),
        legend: {show: false},  // required for sauceLegned to toggle series
        visualMap: series.map((f, i) => ({
            show: false,
            type: 'continuous',
            hoverLink: false,
            seriesIndex: i,
            min: f.domain[0],
            max: f.domain[1],
            inRange: {colorAlpha: f.rangeAlpha},
        })),
        axisPointer: {link: [{xAxisIndex: 'all'}]},
        grid: series.map((x, i) => {
            const count = series.length;
            return {
                top: `${topPad + i / count * (100 - topPad - bottomPad)}%`,
                height: `${(100 - topPad - bottomPad) / count - seriesPad}%`,
                left: leftPad,
                right: rightPad,
            };
        }),
        dataZoom: [{
            type: 'inside',
            xAxisIndex: xAxes,
            zoomOnMouseWheel: false,
            moveOnMouseMove: false,
            moveOnMouseWheel: false,
            preventDefaultMouseMove: true,
            zoomLock: true, // workaround for https://github.com/apache/echarts/issues/10079
        }],
        brush: {
            brushLink: 'all',
            seriesIndex: xAxes,
            xAxisIndex: xAxes,
            brushType: 'lineX',
            brushMode: 'single',
            brushStyle: {
                color: 'var(--selection-color)',
                borderWidth: 'var(--selection-border-width)',
                borderColor: 'var(--selection-border-color)',
            },
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: {label: {formatter: () => void 0}}, // XXX there must be a better way
        },
        xAxis: series.map((f, i) => ({
            type: 'time',
            gridIndex: i,
            //splitNumber: el.clientWidth / 10 | 0,
            axisTick: {
                show: i === series.length - 1,
            },
            axisLabel: {
                show: i === series.length - 1,
                formatter: t => H.timer(t / 1000),
            },
        })),
        yAxis: series.map((f, i) => ({
            type: 'value',
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
            min: x => f.domain[0] != null ? Math.min(f.domain[0], x.min) : x.min,
            max: x => f.domain[1] != null ? Math.max(f.domain[1], x.max) : x.max,
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
        series: series.map((f, i) => ({
            type: 'line',
            animation: false,
            showSymbol: false,
            emphasis: {disabled: true},
            areaStyle: {},
            id: f.id,
            name: typeof f.name === 'function' ? f.name() : f.name,
            z: series.length - i + 1,
            xAxisIndex: i,
            yAxisIndex: i,
            tooltip: {valueFormatter: f.fmt},
            lineStyle: {color: f.color},
        })),
        toolbox: {show: false},
    };
    chart.setOption(options);
    chart.updateData = () => {
        if (paused) {
            updateDeferred = true;
            return;
        }
        updateDeferred = false;
        chart.setOption({
            dataZoom: [{
                startValue: zoomStart,
                endValue: zoomEnd,
            }],
            series: series.map(f => ({
                data: streams[f.stream].map((x, i) => [streams.time[i] * 1000, x]),
            }))
        });
    };
    chart.setSelection = (startValue, endValue) => {
        startValue *= 1000;
        endValue *= 1000;
        chart.dispatchAction({type: 'dataZoom', startValue, endValue});
    };
    chart.on('datazoom', ev => {
        pointerActionTaken = true;
        console.warn('zoom DATAZOOM', ev);
        if (ev.start !== undefined || ev.end !== undefined) {
            if (ev.start !== 0 || ev.end !== 100) {
                throw new Error('non-reset percent based datazoom is unsupported');
            }
            zoomStart = undefined;
            zoomEnd = undefined;
        } else {
            zoomStart = ev.startValue;
            zoomEnd = ev.endValue;
        }
    });
    chart.on('brush', ev => {
        pointerActionTaken = true;
        if (ev.areas.length) {
            const range = ev.areas[0].coordRange;
            zoomStart = range[0];
            zoomEnd = range[1];
        }
    });
    chart.on('brushEnd', x => {
        pointerActionTaken = true;
        if (!x.areas.length) {
            return;
        }
        const range = x.areas[0].coordRange;
        chart.dispatchAction({
            type: 'dataZoom',
            startValue: range[0],
            endValue: range[1],
        });
        chart.dispatchAction({type: 'brush', areas: []});  // clear selection
    });
    el.addEventListener('pointerdown', () => {
        paused = true;
        pointerActionTaken = false;
    });
    const unpause = () => {
        paused = false;
        if (!pointerActionTaken) {
            chart.dispatchAction({type: 'dataZoom', start: 0, end: 100});
        }
        if (updateDeferred) {
            // Must queue callback to prevent conflict with other mouseup actions.
            requestAnimationFrame(chart.updateData);
        }
    };
    document.addEventListener('pointercancel', unpause);
    document.addEventListener('pointerup', unpause);
    chart.updateData();
    // This is the only way to enable brush selection by default. :/
    chart.dispatchAction({
        type: 'takeGlobalCursor',
        key: 'brush',
        brushOption: {
            brushType: 'lineX',
            brushMode: 'single',
        }
    });
    chartRefs.add(new WeakRef(chart));
    return chart;
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
        tooltip: {
            className: 'ec-tooltip'
        },
        series: [{
            type: 'pie',
            radius: ['30%', '80%'],
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
    const [_ad, _laps, _segments, _streams, _templates, nationFlags, worldList] = await Promise.all([
        common.rpc.getAthleteData(athleteIdent),
        common.rpc.getAthleteLaps(athleteIdent),
        common.rpc.getAthleteSegments(athleteIdent),
        common.rpc.getAthleteStreams(athleteIdent),
        getTemplates(['main', 'activity-summary', 'selection-stats', 'peak-efforts', 'segments', 'laps']),
        common.initNationFlags(),
        common.getWorldList(),
    ]);
    athleteData = _ad, laps = _laps, segments = _segments, streams = _streams, templates = _templates;
    console.warn({_ad, streams}); // XXX debug
    const contentEl = document.querySelector('#content');
    contentEl.innerHTML = await templates.main({
        athleteData,
        laps,
        segments,
        streams,
        templates,
        nationFlags,
        worldList,
        settings,
        common,
        peakFormatters,
        selectionStats: getSelectionStats(),
    });
    if (!athleteData) {
        return;
    }
    sport = athleteData.state.sport;
    const renderer = new common.Renderer(contentEl, {fps: 1});
    /*renderer.addRotatingFields({
        mapping: [{
            id: 'testing-1',
            default: 'grade',
        }],
        fields: fieldsMod.fields
    });*/
    const athlete = athleteData.athlete;
    const started = new Date(Date.now() - athleteData.stats.elapsedTime * 1000);
    const name = `${athlete ? athlete.fLast : athleteIdent} - ${started.toLocaleString()}`;
    const exportBtn = document.querySelector('.button.export-file');
    exportBtn.addEventListener('click', () => exportFITActivity(name));
    exportBtn.removeAttribute('disabled');
    elevationChart = createElevationLineChart(contentEl.querySelector('.chart-holder.elevation .chart'));
    zoomableChart = createZoomableLineChart(contentEl.querySelector('.chart-holder.zoomable .chart'));
    createTimeInPowerZonesPie(contentEl.querySelector('.time-in-power-zones'), renderer);  // bg okay
    const zwiftMap = new map.SauceZwiftMap({
        el: document.querySelector('#map'),
        worldList,
        zoomMin: 0.05,
    });
    window.zwiftMap = zwiftMap; // debug
    let voidAutoCenter;
    zwiftMap.addEventListener('drag', () => voidAutoCenter = true);
    zwiftMap.addEventListener('zoom', () => voidAutoCenter = true);
    zwiftMap.setCourse(athleteData.state.courseId);
    let histPath;
    const startEnt = new map.MapEntity('start');
    zwiftMap.addEntity(startEnt);
    const endEntity = new map.MapEntity('end');
    endEntity.transition.setDuration(0);
    zwiftMap.addEntity(endEntity);
    const positions = [];

    contentEl.addEventListener('click', ev => {
        const row = ev.target.closest('table.laps tbody tr, table.segments tbody tr');
        if (!row) {
            return;
        }
        let sel;
        if (row.dataset.segment) {
            sel = segments[Number(row.dataset.segment)];
        } else if (row.dataset.lap) {
            sel = laps[Number(row.dataset.lap)];
        }
        if (sel) {
            console.log(sel.startIndex, sel.endIndex);
            zoomableChart.setSelection(sel.startIndex, sel.endIndex);
            elevationChart.setSelection(sel.startIndex, sel.endIndex);
        }
    });
    contentEl.addEventListener('input', async ev => {
        const peakSource = ev.target.closest('select[name="peak-effort-source"]');
        if (!peakSource) {
            return;
        }
        common.settingsStore.set('peakEffortSource', peakSource.value);
        await updateTemplate('.peak-efforts', templates.peakEfforts, {athleteData, settings, peakFormatters});
    });

    let zoomBrushing = false;
    zoomableChart.on('brush', async ev => {
        zoomBrushing = true;
        try {
            elevationChart.dispatchAction({
                type: 'brush',
                areas: [{
                    brushType: 'lineX',
                    xAxisIndex: 0,
                    coordRange: [zoomStart, zoomEnd],
                }],
            });
        } finally {
            zoomBrushing = false;
        }
        await updateSelectionStats();
    });
    /*elevationChart.on('brush', async ev => {
        await updateSelectionStats();
    });*/
    zoomableChart.on('datazoom', async ev => {
        console.log('on zoom datazoom', ev, zoomStart, zoomEnd);
        elevationChart.dispatchAction({
            type: 'brush',
            areas: zoomStart !== undefined ? [{
                brushType: 'lineX',
                xAxisIndex: 0,
                coordRange: [zoomStart, zoomEnd],
            }] : [],
        });
        await updateSelectionStats();
    });
    elevationChart.on('brush', async ev => {
        if (zoomBrushing) {
            return;
        }
        zoomableChart.setOption({
            dataZoom: [{
                startValue: zoomStart,
                endValue: zoomEnd,
            }],
        });
        await updateSelectionStats();
    });

    let lastPeaksSig;
    renderer.addCallback(async x => {
        athleteData = x;
        await updateTemplate('.activity-summary', templates.activitySummary, {athleteData});
        if (!document.activeElement || !document.activeElement.closest('.peak-efforts')) {
            const sig = JSON.stringify(athleteData.stats[settings.peakEffortSource || 'power'].peaks);
            if (sig !== lastPeaksSig) {
                lastPeaksSig = sig;
                await updateTemplate('.peak-efforts', templates.peakEfforts,
                                     {athleteData, settings, peakFormatters});
            }
        }
    });

    // Always use streams for data to avoid ambiguous differences in state data.
    setInterval(async () => {
        streams = await common.rpc.getAthleteStreams(athleteIdent);
        if (streams.time.length === positions.length) {
            return;
        }
        for (let i = positions.length; i < streams.time.length; i++) {
            positions.push(zwiftMap.latlngToPosition(streams.latlng[i]));
            rolls.power.add(streams.time[i], streams.power[i]);
        }
        endEntity.setPosition(positions.at(-1));
        if (!voidAutoCenter) {
            centerMap(zwiftMap, positions);
        }
        if (histPath) {
            histPath.path.remove();
            histPath.node.remove();
        } else {
            startEnt.setPosition(positions[0]);
        }
        histPath = zwiftMap.addHighlightPath(positions, 'history');
        zoomableChart.updateData();
        elevationChart.updateData();
        await updateSelectionStats();
    }, 2000);

    let segmentCount = segments.length;
    let lapCount = laps.length;
    setInterval(async () => {
        segments = await common.rpc.getAthleteSegments(athleteIdent);
        if (segments.length !== segmentCount) {
            segmentCount = segments.length;
            await updateTemplate('table.segments', templates.segments,
                                 {athleteData, streams, settings, segments});
        }
        laps = await common.rpc.getAthleteLaps(athleteIdent);
        if (laps.length !== lapCount) {
            lapCount = laps.length;
            await updateTemplate('table.laps', templates.laps, {athleteData, streams, settings, laps});
        }
    }, 5500);

    common.subscribe(`athlete/${athleteIdent}`, x => {
        renderer.setData(x);
        renderer.render();
    });

    renderer.setData(athleteData);
    renderer.render();
    for (const x of streams.latlng) {
        positions.push(zwiftMap.latlngToPosition(x));
    }
    if (positions.length) {
        centerMap(zwiftMap, positions);
        startEnt.setPosition(positions[0]);
        endEntity.setPosition(positions.at(-1));
        histPath = zwiftMap.addHighlightPath(positions, 'history');
        for (const [i, ts] of streams.time.entries()) {
            rolls.power.add(ts, streams.power[i]);
        }
        await updateSelectionStats();
    }
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
