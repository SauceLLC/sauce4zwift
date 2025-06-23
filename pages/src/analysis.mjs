import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as echarts from '../deps/src/echarts.mjs';
import * as theme from './echarts-sauce-theme.mjs';
import * as charts from './charts.mjs';
import * as map from './map.mjs';
import * as color from './color.mjs';
import * as sc from '../deps/src/saucecharts/index.mjs';


const chartLeftPad = 50;
const chartRightPad = 20;

common.enableSentry();
echarts.registerTheme('sauce', theme.getTheme('dynamic', {fg: 'intrinsic-inverted', bg: 'intrinsic'}));
common.settingsStore.setDefault({
    preferWkg: false,
    peakEffortSource: 'power',
});

let zwiftMap;
let elevationChart;
let streamStackCharts;
let powerZonesChart;
let templates;
let athleteData;
let ftp;
let sport;
let powerZones;

const state = {
    laps: [],
    segments: [],
    streams: {},
    positions: [],
    startOffset: 0,
    startTime: undefined,
    sport: undefined,
    zoomStart: undefined,
    zoomEnd: undefined,
    voidAutoCenter: false,
};
window.state = state; // XXX


const settings = common.settingsStore.get();
const H = sauce.locale.human;
const q = new URLSearchParams(location.search);
const athleteIdent = q.get('id') || 'self';
const chartRefs = new Set();
const minVAMTime = 60;
const rolls = {
    power: new sauce.power.RollingPower(null, {idealGap: 1, maxGap: 15}),
};


function formatPreferredPower(x, options) {
    if (settings.preferWkg && athleteData?.athlete?.weight) {
        return H.wkg(x ? x / athleteData.athlete.weight : null,
                     {suffix: true, html: true, ...options});
    } else {
        return H.power(x, {suffix: true, html: true, ...options});
    }
}


const peakFormatters = {
    power: formatPreferredPower,
    np: formatPreferredPower,
    speed: x => H.pace(x, {suffix: true, html: true, sport}),
    hr: x => H.number(x, {suffix: 'bpm', html: true}),
    draft: x => H.power(x, {suffix: true, html: true}),
};

const streamSeries = ['power', 'hr', 'speed', 'cadence', 'wbal', 'draft'].map(x => charts.streamFields[x]);


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
        return true;
    }
    return false;
}


function getSelectionStats() {
    if (!athleteData) {
        return;
    }
    let powerRoll = rolls.power;
    if (state.zoomStart != null) {
        const start = state.streams.time[state.zoomStart];
        const end = state.streams.time[state.zoomEnd];
        powerRoll = powerRoll.slice(start, end);
    }
    const activeTime = powerRoll.active();
    const elapsedTime = powerRoll.elapsed();
    const powerAvg = powerRoll.avg({active: true});
    const np = powerRoll.np();
    const athlete = athleteData.athlete;
    const rank = athlete?.weight ?
        sauce.power.rank(activeTime, powerAvg, np, athlete.weight, athlete.gender) :
        null;
    const start = state.streams.time.indexOf(powerRoll.firstTime({noPad: true}));
    const end = state.streams.time.indexOf(powerRoll.lastTime({noPad: true})) + 1;
    const distStream = state.streams.distance.slice(start, end);
    const altStream = state.streams.altitude.slice(start, end);
    const hrStream = state.streams.hr.slice(start, end).filter(x => x);
    const distance = distStream[distStream.length - 1] - distStream[0];
    const {gain, loss} = sauce.geo.altitudeChanges(altStream);
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
            tss: sauce.power.calcTSS(np > powerAvg ? np : powerAvg, activeTime, ftp),
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
    return await updateTemplate('.selection-stats', templates.selectionStats, {selectionStats, settings});
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


function createElevationChart(el) {
    const chart = new sc.LineChart({
        el,
        padding: [2, chartRightPad, 30, chartLeftPad],
        color: '#986a',
        hidePoints: true,
        disableAnimation: true,
        tooltip: {
            linger: 0,
            format: ({entry}) => H.elevation(entry.y, {separator: ' ', suffix: true})
        },
        xAxis: {
            format: ({value}) => {
                return H.distance(value, {suffix: true});
            }
        },
        yAxis: {
            ticks: 1,
        },
        brush: {
            disableZoom: true,
        },
    });
    chart.updateData = () => {
        const data = state.streams.altitude.map((x, i) =>
            i >= state.startOffset ? [state.streams.distance[i], x] : [null, null]);
        chart.yMax = Math.max(30, sauce.data.max(data.map(x => x[1])));
        chart.setData(data);
    };
    chart.addEventListener('brush', ev => {
        if (ev.detail.internal) {
            let {x1, x2} = ev.detail;
            if (x1 == null || x2 == null) {
                state.zoomStart = null;
                state.zoomEnd = null;
            } else if (x1 !== x2) {
                if (x2 < x1) {
                    [x1, x2] = [x2, x1];
                }
                state.zoomStart = common.binarySearchClosest(state.streams.distance, x1);
                state.zoomEnd = common.binarySearchClosest(state.streams.distance, x2);
            }
        }
    });
    return chart;
}


function createStreamStackCharts(el) {
    const topPad = 30;
    const seriesPad = 10;
    const bottomPad = 20;
    const height = 50;

    const charts = [];
    for (const [i, series] of streamSeries.entries()) {
        const first = i === 0;
        const last = i === streamSeries.length - 1;
        const title = typeof series.name === 'function' ? series.name() : series.name;
        const ttFrag = document.createDocumentFragment();
        const ttEl = document.createElement('div');
        const chart = new sc.LineChart({
            el,
            merge: !first,
            title,
            color: series.color,
            height,
            padding: [
                topPad + (seriesPad + height) * i,
                chartRightPad,
                last ? bottomPad : 0,
                chartLeftPad
            ],
            disableAnimation: true,
            hidePoints: true,
            tooltip: {
                linger: 0,
                format: ({value}) => {
                    ttEl.innerHTML = series.fmt(value, {html: true});
                    ttFrag.replaceChildren(...ttEl.childNodes);
                    return ttFrag;
                }
            },
            xAxis: {
                disabled: !first,
                align: 'top',
                ticks: !first ? 0 : undefined,
                format: ({value}) => H.timer(value / 1000)
            },
            yAxis: {
                ticks: 1,
                format: ({value}) => series.fmt(value, {suffix: false})
            },
            brush: {
                shared: true,
            },
        });

        chart.updateData = () => {
            const data = state.streams[series.id].map((x, i) => [state.streams.time[i] * 1000, x]);
            if (series.domain[0] != null) {
                chart.yMin = Math.min(series.domain[0], sauce.data.min(data.map(x => x[0])));
            }
            if (series.domain[1] != null) {
                chart.yMax = Math.max(series.domain[1], sauce.data.max(data.map(x => x[1])));
            }
            chart.setData(data);
        };

        if (!charts.length) {
            chart.addEventListener('brush', ev => {
                if (ev.detail.internal) {
                    let {x1, x2} = ev.detail;
                    if (x1 == null || x2 == null) {
                        state.zoomStart = null;
                        state.zoomEnd = null;
                    } else if (x1 !== x2) {
                        if (x2 < x1) {
                            [x1, x2] = [x2, x1];
                        }
                        state.zoomStart = common.binarySearchClosest(state.streams.time, x1 / 1000);
                        state.zoomEnd = common.binarySearchClosest(state.streams.time, x2 / 1000);
                    }
                }
            });
        }
        charts.push(chart);
    }

    //const options = {
        //visualMap: charts.getStreamFieldVisualMaps(streamSeries),
        //series: streamSeries.map((f, i) => ({
         //   areaStyle: f.id === 'power' && powerZones && ftp ? {color: 'magic-zones'} : {},
        //})),
    //};
    return charts;
}


function powerZoneColors(zones, fn) {
    const colors = {};
    for (const [k, v] of Object.entries(common.getPowerZoneColors(zones))) {
        const c = color.parse(v);
        colors[k] = fn ? fn(c) : c;
    }
    return colors;
}


function createTimeInPowerZonesPie(el) {
    const chart = echarts.init(el, 'sauce', {renderer: 'svg'});
    chart.setOption({
        title: {
            text: 'TIME IN ZONES',
            left: 'center',
            textStyle: {
                fontWeight: 450,
                fontFamily: 'inherit',
                fontSize: '0.76em',
            }
        },
        tooltip: {
            className: 'ec-tooltip'
        },
        series: [{
            type: 'pie',
            radius: ['30%', '80%'],
            top: 10,
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
    chart.updateData = () => {
        if (!powerZones || !ftp || !athleteData.timeInPowerZones) {
            return;
        }
        if (athleteData.athleteId !== aid) {
            aid = athleteData.athleteId;
            colors = powerZoneColors(powerZones, c => ({
                c,
                g: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
                    {offset: 0, color: c.toString({legacy: true})},
                    {offset: 1, color: c.alpha(0.6).toString({legacy: true})}
                ])
            }));
            normZones = new Set(powerZones.filter(x => !x.overlap).map(x => x.zone));
        }
        chart.setOption({
            series: [{
                data: athleteData.timeInPowerZones.filter(x => normZones.has(x.zone)).map(x => ({
                    name: x.zone,
                    value: x.time,
                    label: {color: colors[x.zone].c.l > 0.65 ? '#000b' : '#fffb'},
                    itemStyle: {color: colors[x.zone].g},
                })),
            }],
        });
    };
    return chart;
}


function centerMap(positions) {
    const xMin = sauce.data.min(positions.map(x => x[0]));
    const yMin = sauce.data.min(positions.map(x => x[1]));
    const xMax = sauce.data.max(positions.map(x => x[0]));
    const yMax = sauce.data.max(positions.map(x => x[1]));
    zwiftMap.setBounds([xMin, yMax], [xMax, yMin]);
}


export async function main() {
    common.initInteractionListeners();
    const [_ad, _templates, nationFlags, worldList, _powerZones] = await Promise.all([
        common.rpc.getAthleteData(athleteIdent),
        getTemplates([
            'main',
            'activity-summary',
            'selection-stats',
            'peak-efforts',
            'segments',
            'segment-results',
            'laps'
        ]),
        common.initNationFlags(),
        common.getWorldList({all: true}),
        common.rpc.getPowerZones(1),
    ]);
    athleteData = _ad;
    templates = _templates;
    powerZones = _powerZones;
    const contentEl = document.querySelector('#content');
    contentEl.innerHTML = await templates.main({
        ...state,
        athleteData,
        templates,
        nationFlags,
        worldList,
        settings,
        common,
        peakFormatters,
    });
    if (!athleteData) {
        return;
    }
    sport = athleteData.state.sport;
    ftp = athleteData.athlete?.ftp || 250; // XXX
    charts.setSport(sport);
    const exportBtn = document.querySelector('.button.export-file');
    exportBtn.removeAttribute('disabled');
    exportBtn.addEventListener('click', () => {
        // XXX nope.  athletedata becomes stale over time...
        const started = new Date(Date.now() - athleteData.stats.elapsedTime * 1000);
        const athlete = athleteData.athlete;
        const name = `${athlete ? athlete.fLast : athleteIdent} - ${started.toLocaleString()}`;
        exportFITActivity(name);
    });
    elevationChart = createElevationChart(contentEl.querySelector('.chart-holder.elevation .chart'));
    streamStackCharts = createStreamStackCharts(contentEl.querySelector('.chart-holder.stream-stack .chart'));
    powerZonesChart = createTimeInPowerZonesPie(contentEl.querySelector('.time-in-power-zones'));
    zwiftMap = new map.SauceZwiftMap({
        el: document.querySelector('#map'),
        worldList,
        zoomMin: 0.05,
        fpsLimit: 60,
    });
    window.zwiftMap = zwiftMap; // debug
    zwiftMap.addEventListener('drag', () => state.voidAutoCenter = true);
    zwiftMap.addEventListener('zoom', () => state.voidAutoCenter = true);
    state.startEnt = new map.MapEntity('start');
    zwiftMap.addEntity(state.startEnt);
    state.endEntity = new map.MapEntity('end');
    state.endEntity.transition.setDuration(0);
    zwiftMap.addEntity(state.endEntity);
    state.cursorEntity = new map.MapEntity('cursor');
    state.cursorEntity.transition.setDuration(0);
    zwiftMap.addEntity(state.cursorEntity);

    contentEl.addEventListener('click', ev => {
        const row = ev.target.closest('table.selectable > tbody > tr');
        if (!row) {
            return;
        }
        const deselecting = row.classList.contains('selected');
        contentEl.querySelectorAll('table.selectable tr.selected').forEach(x =>
            x.classList.remove('selected'));
        if (deselecting) {
            setSelection();
        } else {
            let sel;
            let scrollTo;
            if (row.dataset.segmentIndex) {
                sel = state.segments[Number(row.dataset.segmentIndex)];
            } else if (row.dataset.lapIndex) {
                sel = state.laps[Number(row.dataset.lapIndex)];
                scrollTo = true;
            } else if (row.dataset.peakSource) {
                const period = Number(row.dataset.peakPeriod);
                const peak = athleteData.stats[row.dataset.peakSource].peaks[period];
                const endIndex = state.streams.time.indexOf(peak.time);
                const startIndex = common.binarySearchClosest(state.streams.time, peak.time - period);
                sel = {startIndex, endIndex};
                scrollTo = true;
            }
            if (sel) {
                row.classList.add('selected');
                setSelection(sel.startIndex, sel.endIndex, scrollTo);
            }
        }
    });
    contentEl.addEventListener('input', async ev => {
        const peakSource = ev.target.closest('select[name="peak-effort-source"]');
        if (!peakSource) {
            return;
        }
        common.settingsStore.set('peakEffortSource', peakSource.value);
        await updatePeaksTemplate();
    });

    streamStackCharts[0].addEventListener('brush', ev => elevationChart.setBrush({
        x1: state.zoomStart != null ? state.streams.distance[state.zoomStart] : null,
        x2: state.zoomEnd != null ? state.streams.distance[state.zoomEnd] : null
    }));
    elevationChart.addEventListener('brush', async ev => {
        if (state.brushPath) {
            state.brushPath.elements.forEach(x => x.remove());
            state.brushPath = undefined;
        }
        if (state.zoomStart != null && state.zoomStart < state.zoomEnd) {
            const selection = state.positions.slice(state.zoomStart, state.zoomEnd);
            state.brushPath = zwiftMap.addHighlightLine(selection, 'selection', {color: '#4885ff'});
        }
        if (ev.detail.internal) {
            for (const chart of streamStackCharts) {
                if (state.zoomStart != null && state.zoomStart < state.zoomEnd) {
                    chart.setZoom({
                        xRange: [
                            state.streams.time[state.zoomStart] * 1000,
                            state.streams.time[state.zoomEnd] * 1000
                        ]
                    });
                } else {
                    chart.setZoom();
                }
            }
        }
        await updateSelectionStats();
    });

    function onTooltip(ev) {
        const {x, chart, internal} = ev.detail;
        if (!internal) {
            return;
        }
        const otherChart = chart === elevationChart ? streamStackCharts[0] : elevationChart;
        if (x !== undefined) {
            const index = chart.findNearestIndexFromXCoord(x);
            const pos = state.positions[index];
            state.cursorEntity.toggleHidden(!pos);
            if (pos) {
                state.cursorEntity.setPosition(pos);
            }
            otherChart.setTooltipPosition({index});
            otherChart.showTooltip();
        } else if (!otherChart.isTooltipPointing()) {
            otherChart.hideTooltip();
        }
    }
    elevationChart.addEventListener('tooltip', onTooltip);
    streamStackCharts[0].addEventListener('tooltip', onTooltip);
    updateLoop();
}


function setSelection(startIndex, endIndex, scrollTo) {
    state.zoomStart = startIndex;
    state.zoomEnd = endIndex;
    if (startIndex != null && endIndex != null) {
        for (const x of streamStackCharts) {
            x.setZoom({
                xRange: [state.streams.time[startIndex] * 1000, state.streams.time[endIndex] * 1000]
            });
        }
        if (scrollTo) {
            document.querySelector('#map').scrollIntoView({behavior: 'smooth'});
        }
    } else {
        for (const x of streamStackCharts) {
            x.setZoom();
        }
    }
}


async function onSegmentExpand(targetEl, srcEl) {
    const idx = Number(srcEl.dataset.segmentIndex);
    const segment = state.segments[idx];
    //const results = await common.rpc.getSegmentResults(segment.segmentId,
    //    {athleteId: athleteData.athleteId});
    const results = await common.rpc.getSegmentResults(segment.segmentId);
    //const results2 = await common.rpc.getSegmentResults(segment.segmentId, {live: true});
    console.warn({results});
    targetEl.innerHTML = await templates.segmentResults({results});
}


function onSegmentCollapse() {
    console.debug("XXX unused", arguments);
}


async function updatePeaksTemplate() {
    const source = settings.peakEffortSource || 'power';
    const formatter = peakFormatters[source];
    const peaks = athleteData.stats?.[source]?.peaks;
    if (peaks) {
        for (const [_period, x] of Object.entries(peaks)) {
            const period = Number(_period);
            const start = state.streams.time[common.binarySearchClosest(state.streams.time, x.time - period)];
            const powerRoll = rolls.power.slice(start, x.time);
            const elapsedTime = powerRoll.elapsed();
            const powerAvg = powerRoll.avg();
            const np = powerRoll.np();
            const athlete = athleteData.athlete;
            x.rank = athlete?.weight ?
                sauce.power.rank(elapsedTime, powerAvg, np, athlete.weight, athlete.gender) :
                null;
        }
    }
    await updateTemplate('.peak-efforts', templates.peakEfforts,
                         {source, peaks, formatter, athleteData, settings, peakFormatters});
}


function updateLoop() {
    updateData().finally(() => setTimeout(updateLoop, 2000));
}


async function updateData() {
    if (!common.isVisible()) {
        return;
    }
    const [ad, streams, upSegments, upLaps] = await Promise.all([
        common.rpc.getAthleteData(athleteIdent),
        common.rpc.getAthleteStreams(athleteIdent, {startTime: state.timeOfft}),
        common.rpc.getAthleteSegments(athleteIdent, {endTime: state.segmentOfft, active: false}),
        common.rpc.getAthleteLaps(athleteIdent, {endTime: state.lapOfft, active: true}),
    ]);
    athleteData = ad;
    if (!streams || !streams.time.length) {
        return;
    }
    state.timeOfft = streams.time.at(-1) + 1e-6;
    for (const [k, stream] of Object.entries(streams)) {
        if (!state.streams[k]) {
            state.streams[k] = [];
        }
        state.streams[k].push(...stream);
    }
    if (upSegments.length) {
        for (const x of upSegments) {
            const existingIdx = state.segments.findIndex(xx => xx.segmentId === x.segmentId);
            if (existingIdx !== -1) {
                state.segments.splice(existingIdx, 1, x);
            } else {
                state.segments.push(x);
            }
        }
        state.segmentOfft = Math.max(...state.segments.map(x => x.end).filter(x => x));
        if (await updateTemplate('table.segments', templates.segments, {athleteData, settings, ...state})) {
            common.initExpanderTable(document.querySelector('table.segments.expandable'),
                                     onSegmentExpand, onSegmentCollapse);
        }
    }
    if (upLaps.length) {
        for (const x of upLaps) {
            const existingIdx = state.laps.findIndex(xx => xx.startIndex === x.startIndex);
            if (existingIdx !== -1) {
                state.laps.splice(existingIdx, 1, x);
            } else {
                state.laps.push(x);
            }
        }
        state.lapOfft = state.laps.at(-1).end;
        await updateTemplate('table.laps', templates.laps, {athleteData, settings, ...state});
    }
    if (ad.courseId !== state.courseId) {
        state.courseId = ad.courseId;
        for (let i = state.laps.length - 1; i >= 0; i--) {
            if (state.laps[i].courseId !== ad.courseId) {
                state.startOffset = state.laps[i].endIndex + 1;
                break;
            }
        }
        zwiftMap.setDragOffset(0, 0);
        state.voidAutoCenter = false; // must follow set-drag-offset
        await zwiftMap.setCourse(ad.courseId);
    }
    if (streams.time.length) {
        for (let i = 0; i < streams.time.length; i++) {
            state.positions.push(zwiftMap.latlngToPosition(streams.latlng[i]));
            const p = streams.power[i];
            rolls.power.add(streams.time[i], (p || streams.active[i]) ? p : new sauce.data.Pad(p));
        }
        const coursePositions = state.positions.slice(state.startOffset);
        state.startEnt.setPosition(coursePositions[0]);
        state.endEntity.setPosition(coursePositions.at(-1));
        if (state.histPath) {
            state.histPath.elements.forEach(x => x.remove());
        }
        state.histPath = zwiftMap.addHighlightLine(coursePositions, 'history', {layer: 'low'});
        if (!state.voidAutoCenter) {
            centerMap(coursePositions);
        }
    }

    if (!document.activeElement || !document.activeElement.closest('.peak-efforts')) {
        const sig = JSON.stringify(athleteData.stats[settings.peakEffortSource || 'power']?.peaks);
        if (!sig || sig !== state.lastPeaksSig) {
            state.lastPeaksSig = sig;
            await updatePeaksTemplate();
        }
    }

    for (const x of streamStackCharts) {
        x.updateData();
    }
    elevationChart.updateData();
    powerZonesChart.updateData();
    await updateSelectionStats();
    await updateTemplate('.activity-summary', templates.activitySummary, {athleteData});
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
