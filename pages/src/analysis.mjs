import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as echarts from '../deps/src/echarts.mjs';
import * as theme from './echarts-sauce-theme.mjs';
import * as chartsMod from './charts.mjs';
import * as map from './map.mjs';
import * as color from './color.mjs';
import * as sc from '../deps/src/saucecharts/index.mjs';

common.enableSentry();
echarts.registerTheme('sauce', theme.getTheme('dynamic', {fg: 'intrinsic-inverted', bg: 'intrinsic'}));
common.settingsStore.setDefault({
    preferWkg: false,
    peakEffortSource: 'power',
});

const H = sauce.locale.human;
const settings = common.settingsStore.get();
const q = new URLSearchParams(location.search);
const athleteIdent = q.get('id') || 'self';
const refreshInterval = Number(q.get('refresh') || 2) * 1000;

const minVAMTime = 60;
const chartLeftPad = 50;
const chartRightPad = 20;

const laps = [];
const segments = [];
const streams = {};
const positions = [];
const rolls = {power: new sauce.power.RollingPower(null, {idealGap: 1, maxGap: 15})};
let courseId;
let zwiftMap;
let elevationChart;
let streamStackCharts;
let powerZonesChart;
let packTimeChart;
let templates;
let athleteData;
let athlete;
let sport;
let powerZones;
let worldList;
let nationFlags;
let geoOffset = 0;
let timeOfft;
let segmentOfft;
let lapOfft;
let curPeaksSig;
let zoomStart;
let zoomEnd;
let voidAutoCenter = false;
let geoSelection;
let activeLapOrSegment;
let selectedLap;
let selectedSegment;


function resetData() {
    laps.length = 0;
    segments.length = 0;
    positions.length = 0;
    for (const x of Object.values(streams)) {
        x.length = 0;
    }
    rolls.power = new sauce.power.RollingPower(null, {idealGap: 1, maxGap: 15});
    geoOffset = 0;
    voidAutoCenter = false;
    sport = timeOfft = segmentOfft = lapOfft = curPeaksSig = zoomStart = zoomEnd =
        geoSelection = activeLapOrSegment = undefined;
}


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

const streamSeries = ['power', 'hr', 'speed', 'cadence', 'wbal', 'draft'].map(x => chartsMod.streamFields[x]);


function resizeCharts() {
    powerZonesChart.resize();
    packTimeChart.resize();
}


async function getTemplates(basenames) {
    return Object.fromEntries(await Promise.all(basenames.map(k =>
        sauce.template.getTemplate(`templates/analysis/${k}.html.tpl`, {html: true}).then(v =>
            // camelCase conv keys-with_snakecase--chars
            [k.replace(/[-_]+(.)/g, (_, x) => x.toUpperCase()), v]))));
}


const _tplSigs = new Map();
async function updateTemplate(selector, tpl, attrs) {
    await sauce.sleep(1);
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
    let leadInKj = 0;
    if (zoomStart != null) {
        const start = streams.time[zoomStart];
        const end = streams.time[zoomEnd];
        powerRoll = powerRoll.slice(start, end);
        if (start) {
            const prePowerRoll = rolls.power.slice(0, start);
            leadInKj = prePowerRoll.joules() / 1000;
        }
    }
    const activeTime = powerRoll.active();
    const elapsedTime = powerRoll.elapsed();
    const powerAvg = powerRoll.avg({active: true});
    const np = powerRoll.np();
    const rank = athlete?.weight ?
        sauce.power.rank(activeTime, powerAvg, np, athlete.weight, athlete.gender) :
        null;
    const start = streams.time.indexOf(powerRoll.firstTime({noPad: true}));
    const end = streams.time.indexOf(powerRoll.lastTime({noPad: true})) + 1;
    const distStream = streams.distance.slice(start, end);
    const altStream = streams.altitude.slice(start, end);
    const hrStream = streams.hr.slice(start, end).filter(x => x);
    const cadenceStream = streams.cadence.slice(start, end).filter(x => x);
    const wbalStream = streams.wbal.slice(start, end);
    const draftStream = streams.draft.slice(start, end);
    const speedStream = streams.speed.slice(start, end);
    const distance = distStream[distStream.length - 1] - distStream[0];
    const {gain, loss} = sauce.geo.altitudeChanges(altStream);
    const r = {
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
            avgElapsed: powerRoll.avg({active: false}),
            max: sauce.data.max(powerRoll.values()),
            np,
            kj: powerRoll.joules() / 1000,
            leadInKj,
            tss: athlete.ftp ?
                sauce.power.calcTSS(np > powerAvg ? np : powerAvg, activeTime, athlete.ftp) :
                null,
            intensity: athlete.ftp ? (np || powerAvg) / athlete.ftp : null,
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
        } : null,
        speed: hrStream.length ? {
            avg: (distance / activeTime) * 3.6,
            max: sauce.data.max(speedStream),
        } : null,
        cadence: cadenceStream.length ? {
            avg: sauce.data.avg(cadenceStream),
            max: sauce.data.max(cadenceStream),
        } : null,
        wbal: wbalStream.length ? {
            avg: sauce.data.avg(wbalStream),
            min: sauce.data.min(wbalStream),
        } : null,
        draft: draftStream.length ? {
            avg: sauce.data.avg(draftStream),
            max: sauce.data.max(draftStream),
        } : null,
    };
    if (r.hr && r.hr.avg > 20) {
        r.hr.pwhr = sauce.power.calcPwHrDecouplingFromRoll(powerRoll, hrStream);
        if (athlete.maxHeartRate != null && athlete.maxHeartRate > 100) {
            const ltHR = athlete.maxHeartRate * 0.85;
            const restingHR = athlete.ftp ? sauce.perf.estimateRestingHR(athlete.ftp) : 60;
            r.hr.tTss = sauce.perf.tTSS(
                hrStream,
                streams.time.slice(start, end),
                streams.active.slice(start, end),
                ltHR,
                restingHR,
                athlete.maxHeartRate,
                athlete.gender
            );
        }
    }
    return r;
}


let selStatsActive;
let selStatsPendingRelease;
let mapCenterTimeout;
let streamStatsEls;
function schedUpdateSelectionStats() {
    const run = () => {
        const stats = getSelectionStats();
        selStatsActive = updateTemplate('.selection-stats', templates.selectionStats,
                                        {selectionStats: stats, settings}).finally(() => {
            selStatsActive = null;
            if (selStatsPendingRelease) {
                selStatsPendingRelease();
                selStatsPendingRelease = null;
            }
        });
        if (!streamStatsEls) {
            streamStatsEls = new Map(Array.from(document.querySelectorAll(`.stream-stats .stat[data-id]`))
                .map(x => [x.dataset.id, x]));
        }

        streamStatsEls.get('power').innerHTML = `
            Avg: ${H.power(stats.power.avg)}<br/>
            Max: ${H.power(stats.power.max)}<br/>
            <small>watts</small>`;
        streamStatsEls.get('hr').innerHTML = stats.hr ? `
            Avg: ${H.number(stats.hr.avg)}<br/>
            Max: ${H.number(stats.hr.max)}<br/>
            <small>bpm</small>` : '';
        streamStatsEls.get('speed').innerHTML = stats.speed ? `
            Avg: ${H.pace(stats.speed.avg, {fixed: true, precision: 1})}<br/>
            Max: ${H.pace(stats.speed.max, {fixed: true, precision: 1})}<br/>
            <small>${H.pace(1, {suffixOnly: true})}</small>` : '';
        streamStatsEls.get('cadence').innerHTML = stats.cadence ? `
            Avg: ${H.number(stats.cadence.avg)}<br/>
            Max: ${H.number(stats.cadence.max)}<br/>
            <small>rpm</small>` : '';
        streamStatsEls.get('wbal').innerHTML = stats.wbal ? `
            Avg: ${H.number(stats.wbal.avg / 1000, {fixed: true, precision: 1})}<br/>
            Min: ${H.number(stats.wbal.min / 1000, {fixed: true, precision: 1})}<br/>
            <small>kj</small>` : '';
        streamStatsEls.get('draft').innerHTML = stats.draft ? `
            Avg: ${H.power(stats.draft.avg)}<br/>
            Max: ${H.power(stats.draft.max)}<br/>
            <small>w</small>` : '';
    };
    if (selStatsPendingRelease) {
        selStatsPendingRelease(true);
        selStatsPendingRelease = null;
    }
    if (selStatsActive) {
        const promise = new Promise(r => selStatsPendingRelease = r);
        promise.then(cancelled => !cancelled && run());
    } else {
        run();
    }
    if (!voidAutoCenter) {
        if (!mapCenterTimeout) {
            mapCenterTimeout = setTimeout(() => {
                mapCenterTimeout = null;
                if (!voidAutoCenter) {
                    centerMap(geoSelection || positions.slice(geoOffset));
                }
            }, 500);
        }
    }
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
        color: '#a86',
        hidePoints: true,
        disableAnimation: true,
        tooltip: {
            linger: 0,
            format: ({entry}) => H.elevation(entry.y, {separator: ' ', suffix: true})
        },
        xAxis: {
            format: ({value}) => H.distance(value, {suffix: true}),
        },
        yAxis: {
            format: ({value}) => H.elevation(value, {suffix: true}),
        },
        brush: {
            disableZoom: true,
        },
    });
    const geoMaskSegment = {
        x: 0,
        color: {
            type: 'linear', // Prevent auto-gradient behavior..
            colors: ['#eaf0ede0']
        },
    };
    chart.updateData = () => {
        let segments;
        if (geoOffset) {
            geoMaskSegment.width = streams.distance[geoOffset - 1];
            segments = [geoMaskSegment];
        } else {
            segments = [];
        }
        const data = streams.altitude.map((x, i) => [streams.distance[i], x]);
        chart.yMax = Math.max(30, sauce.data.max(data.map(x => x[1])));
        chart.yMin = Math.min(0, sauce.data.min(data.map(x => x[1])));
        chart.setSegments(segments, {render: false});
        chart.setData(data);
    };
    chart.addEventListener('brush', ev => {
        if (ev.detail.internal) {
            let {x1, x2} = ev.detail;
            if (x1 == null || x2 == null) {
                zoomStart = null;
                zoomEnd = null;
            } else if (x1 !== x2) {
                if (x2 < x1) {
                    [x1, x2] = [x2, x1];
                }
                zoomStart = common.binarySearchClosest(streams.distance, x1);
                zoomEnd = common.binarySearchClosest(streams.distance, x2);
            }
            if (activeLapOrSegment) {
                activeLapOrSegment = null;
                packTimeChart.updateData();
            }
        }
    });
    return chart;
}


function createStreamStackCharts(el) {
    const topPad = 30;
    const seriesPad = 6;
    const bottomPad = 2;
    const height = 60;

    const powerZoneColors = new Map(Object.entries(common.getPowerZoneColors(powerZones)).map(([k, v]) => {
        const color = sc.color.parse(v);
        return [k, {
            type: 'linear',
            colors: [color.adjustLight(0.2), color]
        }];
    }));
    const charts = [];
    for (const [i, series] of streamSeries.entries()) {
        const first = i === 0;
        const last = i === streamSeries.length - 1;
        const title = typeof series.name === 'function' ? series.name() : series.name;
        const ttFrag = document.createDocumentFragment();
        const ttEl = document.createElement('div');
        const chart = new sc.LineChart({
            el: first ? el : undefined,
            parent: charts[0],
            title,
            color: series.color,
            height,
            padding: [
                topPad + (seriesPad + height) * i,
                0,
                last ? bottomPad : 0,
                chartLeftPad
            ],
            disableAnimation: true,
            hidePoints: true,
            tooltip: {
                linger: 0,
                formatKey: ({value}) => title,
                format: ({value}) => {
                    const html = series.fmt(value, {html: true});
                    ttEl.innerHTML = html;
                    ttFrag.replaceChildren(...ttEl.childNodes);
                    return ttFrag;
                }
            },
            xAxis: {
                disabled: !first,
                showFirst: true,
                position: 'top',
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

        const powerSegments = [];
        const geoMaskSegment = {
            x: 0,
            color: '#fff',
        };
        const wbalSegment = {x: 0, y: 0, color: '#f00e'};
        chart.updateData = () => {
            const data = streams[series.id].map((x, i) => [streams.time[i] * 1000, x]);
            if (!data.length) {
                chart.reset();
                return;
            }
            if (series.domain[0] != null) {
                chart.yMin = Math.min(series.domain[0], sauce.data.min(data.map(x => x[1])));
            }
            if (series.domain[1] != null) {
                chart.yMax = Math.max(series.domain[1], sauce.data.max(data.map(x => x[1])));
            }
            let baseSegments;
            if (geoOffset) {
                // + 1 geooffset shades the likely y value transition to 0/null
                geoMaskSegment.width = streams.time[geoOffset + 1] * 1000;
                baseSegments = [geoMaskSegment];
            } else {
                baseSegments = [];
            }
            if (series.id === 'wbal') {
                baseSegments.push(wbalSegment);
            }
            if (series.id === 'power' && powerZones && athlete.ftp) {
                const normZones = powerZones.filter(x => !x.overlap);
                // NOTE: A little extra work goes into reusing the powerSegments objects which
                // allows sauce charts to reuse elements and improve performance.
                let segCount = 0;
                let zone;
                for (let i = 0; i < data.length; i++) {
                    const intensity = data[i][1] / athlete.ftp;
                    for (let j = 0; j < normZones.length; j++) {
                        const z = powerZones[j];
                        if (intensity <= z.to || z.to == null) {
                            if (zone !== z) {
                                if (zone) {
                                    const s = powerSegments[segCount - 1];
                                    s.width = data[i][0] - s.x;
                                }
                                if (powerSegments.length <= segCount) {
                                    powerSegments.push({});
                                }
                                Object.assign(powerSegments[segCount], {
                                    color: powerZoneColors.get(z.zone),
                                    x: data[i][0]
                                });
                                zone = z;
                                segCount++;
                            }
                            break;
                        }
                    }
                }
                const s = powerSegments[segCount - 1];
                s.width = data[data.length - 1][0] - s.x;
                powerSegments.length = segCount;
                chart.setSegments(powerSegments.concat(baseSegments), {render: false});
            } else {
                chart.setSegments(baseSegments, {render: false});
            }
            chart.setData(data);
        };

        if (!charts.length) {
            chart.addEventListener('brush', ev => {
                if (ev.detail.internal) {
                    let {x1, x2} = ev.detail;
                    if (x1 == null || x2 == null) {
                        zoomStart = null;
                        zoomEnd = null;
                    } else if (x1 !== x2) {
                        if (x2 < x1) {
                            [x1, x2] = [x2, x1];
                        }
                        zoomStart = common.binarySearchClosest(streams.time, x1 / 1000);
                        zoomEnd = common.binarySearchClosest(streams.time, x2 / 1000);
                    }
                    if (activeLapOrSegment) {
                        activeLapOrSegment = null;
                        packTimeChart.updateData();
                    }
                }
            });
        }
        charts.push(chart);
    }
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
    let colors;
    let aid;
    let normZones;
    chart.updateData = () => {
        if (!powerZones || !athlete.ftp || !athleteData.timeInPowerZones) {
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


function valueGradient(color, value) {
    const shadeColor = sc.color.parse(color).adjustLight(0.2).adjustSaturation(-0.2).toString({rgb:true});
    return {
        type: 'linear',
        x: 1,
        y: 1,
        x2: 1,
        y2: 0,
        colorStops: [
            {offset: 0, color},
            {offset: value, color},
            {offset: value, color: shadeColor},
            {offset: 1, color: shadeColor},
        ]
    };
}


function createPackTimeChart(el) {
    const headerEl = el.closest('section').querySelector('header');
    const chart = echarts.init(el, 'sauce', {renderer: 'svg'});
    let totalTime = 0;
    let powers;
    const barSeries = {
        type: 'bar',
        barCategoryGap: 10,
        stack: 'total',
    };
    chart.setOption({
        grid: {top: 1, left: 1, right: 1, bottom: 1},
        tooltip: {
            className: 'ec-tooltip',
            formatter: ({value, data, name, seriesIndex, dataIndex}) => {
                return `
                    <b>${name}:</b><br/>
                    Time: <b>${H.timer(value * totalTime, {long: true, html: true})}</b><br/>
                    Power: <b>${H.power(powers[seriesIndex], {suffix: true, html: true})}</b>
                `;
            }
        },
        xAxis: {
            show: false,
            type: 'value',
            min: 0,
            max: 1,
        },
        yAxis: {
            show: false,
            type: 'category'
        },
        series: [barSeries, barSeries, barSeries],
    });
    chart.updateData = () => {
        const data = activeLapOrSegment?.stats || athleteData?.stats;
        if (!data) {
            return;
        }
        totalTime = data.sitTime + data.soloTime + data.workTime;
        let subTitle = '';
        if (activeLapOrSegment) {
            if (activeLapOrSegment.segmentId != null) {
                let name = activeLapOrSegment.segment?.name || 'Segment';
                const max = 28;
                if (name.length > max) {
                    name = name.substr(0, max - 1) + '…';
                }
                subTitle = `<br/>${name}`;
            } else {
                subTitle = `<br/>Lap ${selectedLap + 1}`;
            }
        }
        headerEl.innerHTML = `Pack Time${subTitle}`;
        powers = [
            data.sitTime ? data.sitKj / data.sitTime * 1000 : 0,
            data.soloTime ? data.soloKj / data.soloTime * 1000 : 0,
            data.workTime ? data.workKj / data.workTime * 1000 : 0,
        ];
        const maxPower = Math.max(...powers);
        chart.setOption({
            label: {
                show: true,
                position: 'inside',
                color: '#fff',
                formatter: ({value}) => {
                    if (value > 0.25) {
                        return `${H.number(value * 100, {suffix: '%'})}`;
                    } else {
                        return '';
                    }
                },
            },
            series: [{
                itemStyle: {borderRadius: [2, 0, 0, 2]},
                data: [{
                    name: 'Sitting',
                    value: data.sitTime / totalTime,
                    itemStyle: {color: valueGradient('#65a354', powers[0] / maxPower)},
                }],
            }, {
                data: [{
                    name: 'Solo',
                    value: data.soloTime / totalTime,
                    itemStyle: {color: valueGradient('#d1c209', powers[1] / maxPower)},
                }],
            }, {
                itemStyle: {borderRadius: [0, 2, 2, 0]},
                data: [{
                    name: 'Working',
                    value: data.workTime / totalTime,
                    itemStyle: {color: valueGradient('#ca3805', powers[2] / maxPower)},
                }],
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
    zwiftMap.setBounds([xMin, yMax], [xMax, yMin], {padding: 0.20});
}


export async function main() {
    common.initInteractionListeners();
    [athlete, templates, nationFlags, worldList, powerZones] = await Promise.all([
        common.rpc.getAthlete(athleteIdent),
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
    const contentEl = document.querySelector('#content');
    contentEl.innerHTML = await templates.main({
        athlete,
        templates,
        nationFlags,
        worldList,
        settings,
        common,
        peakFormatters,
    });
    if (!athlete) {
        console.warn("Unrecoverable state: page reload required if this is transient");
        return;
    }
    elevationChart = createElevationChart(contentEl.querySelector('.chart-holder.elevation .chart'));
    streamStackCharts = createStreamStackCharts(contentEl.querySelector('.chart-holder.stream-stack .chart'));
    powerZonesChart = createTimeInPowerZonesPie(contentEl.querySelector('nav .time-in-power-zones'));
    packTimeChart = createPackTimeChart(contentEl.querySelector('nav .pack-time'));
    zwiftMap = new map.SauceZwiftMap({
        el: document.querySelector('#map'),
        worldList,
        zoomMin: 0.05,
        fpsLimit: 60,
    });
    window.zwiftMap = zwiftMap; // debug
    zwiftMap.addEventListener('drag', () => voidAutoCenter = true);
    zwiftMap.addEventListener('zoom', () => voidAutoCenter = true);
    zwiftMap.startEnt = new map.MapEntity('start');
    zwiftMap.addEntity(zwiftMap.startEnt);
    zwiftMap.endEntity = new map.MapEntity('end');
    zwiftMap.endEntity.transition.setDuration(0);
    zwiftMap.addEntity(zwiftMap.endEntity);
    zwiftMap.cursorEntity = new map.MapEntity('cursor');
    zwiftMap.cursorEntity.transition.setDuration(0);
    zwiftMap.addEntity(zwiftMap.cursorEntity);

    document.querySelector('#map-resizer').addEventListener('pointerdown', ev => {
        const abrt = new AbortController();
        const wrap = document.querySelector('#map-wrap');
        const rect = wrap.getBoundingClientRect();
        const initY = ev.y;
        addEventListener('pointermove', ev => {
            wrap.style.setProperty('height', `${rect.height + (ev.y - initY)}px`);
        }, {signal: abrt.signal});
        addEventListener('pointercancel', () => abrt.abort(), {signal: abrt.signal});
        addEventListener('pointerup', () => abrt.abort(), {signal: abrt.signal});
    });
    addEventListener('resize', resizeCharts);

    document.querySelector('.button.export-file').addEventListener('click', () => {
        const started = new Date(athleteData.created);
        const name = `${athlete ? athlete.fLast : athleteIdent} - ${started.toLocaleString()}`;
        exportFITActivity(name);
    });

    contentEl.addEventListener('click', ev => {
        const row = ev.target.closest('table.selectable > tbody > tr');
        if (!row) {
            return;
        }
        const deselecting = row.classList.contains('selected');
        contentEl.querySelectorAll('table.selectable tr.selected').forEach(x =>
            x.classList.remove('selected'));
        if (deselecting) {
            selectedSegment = selectedLap = null;
            setSelection();
        } else {
            let sel;
            let scrollTo;
            let lapish;
            if (row.dataset.segmentIndex) {
                selectedSegment = Number(row.dataset.segmentIndex);
                selectedLap = null;
                lapish = sel = segments[selectedSegment];
            } else if (row.dataset.lapIndex) {
                selectedLap = Number(row.dataset.lapIndex);
                selectedSegment = null;
                lapish = sel = laps[selectedLap];
                scrollTo = true;
            } else if (row.dataset.peakSource) {
                const period = Number(row.dataset.peakPeriod);
                const peak = athleteData.stats[row.dataset.peakSource].peaks[period];
                const endIndex = streams.time.indexOf(peak.time);
                const startIndex = common.binarySearchClosest(streams.time, peak.time - period);
                sel = {startIndex, endIndex};
                scrollTo = true;
                selectedSegment = selectedLap = null;
            }
            if (sel) {
                row.classList.add('selected');
                setSelection(sel.startIndex, sel.endIndex, {scrollTo, lapish});
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
        x1: zoomStart != null ? streams.distance[zoomStart] : null,
        x2: zoomEnd != null ? streams.distance[zoomEnd] : null
    }));
    let brushPath;
    let mapHiUpdateTO;
    elevationChart.addEventListener('brush', ev => {
        const hasZoom = zoomStart != null && zoomStart < zoomEnd;
        if (hasZoom) {
            geoSelection = geoOffset < zoomEnd ?
                positions.slice(Math.max(geoOffset, zoomStart), zoomEnd) :
                null;
            if (geoSelection) {
                if (!brushPath) {
                    brushPath = zwiftMap.addHighlightLine(geoSelection, 'selection', {color: '#2885ffcc'});
                } else if (!mapHiUpdateTO) {
                    // Expensive call with large datasets. throttle a bit...
                    mapHiUpdateTO = setTimeout(() => {
                        mapHiUpdateTO = null;
                        zwiftMap.updateHighlightLine(brushPath, geoSelection);
                    }, geoSelection.length / 100);
                }
            }
        }
        if ((!hasZoom || !geoSelection) && brushPath) {
            clearTimeout(mapHiUpdateTO);
            mapHiUpdateTO = null;
            zwiftMap.removeHighlightLine(brushPath);
            brushPath = null;
            geoSelection = null;
        }
        if (ev.detail.internal) {
            for (const chart of streamStackCharts) {
                if (zoomStart != null && zoomStart < zoomEnd) {
                    chart.setZoom({
                        xRange: [
                            streams.time[zoomStart] * 1000,
                            streams.time[zoomEnd] * 1000
                        ]
                    });
                } else {
                    chart.setZoom();
                }
            }
        }
        schedUpdateSelectionStats();
    });

    function onTooltip(ev) {
        const {x, chart, internal} = ev.detail;
        if (!internal) {
            return;
        }
        const otherChart = chart === elevationChart ? streamStackCharts[0] : elevationChart;
        if (x !== undefined) {
            const index = chart.findNearestIndexFromXCoord(x);
            const pos = positions[index];
            zwiftMap.cursorEntity.toggleHidden(!pos);
            if (pos) {
                zwiftMap.cursorEntity.setPosition(pos);
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


function setSelection(startIndex, endIndex, {scrollTo, lapish}={}) {
    zoomStart = startIndex;
    zoomEnd = endIndex;
    elevationChart.setBrush({
        x1: zoomStart != null ? streams.distance[zoomStart] : null,
        x2: zoomEnd != null ? streams.distance[zoomEnd] : null
    });
    for (const x of streamStackCharts) {
        if (zoomStart != null && zoomStart < zoomEnd) {
            x.setZoom({
                xRange: [
                    streams.time[zoomStart] * 1000,
                    streams.time[zoomEnd] * 1000
                ]
            });
        } else {
            x.setZoom();
        }
    }
    activeLapOrSegment = lapish;
    packTimeChart.updateData();
    if (scrollTo) {
        document.querySelector('#map').scrollIntoView({behavior: 'smooth'});
    }
}


async function onSegmentExpand(targetEl, srcEl) {
    const idx = Number(srcEl.dataset.segmentIndex);
    const segment = segments[idx];
    const results = await common.rpc.getSegmentResults(segment.segmentId);
    //const results2 = await common.rpc.getSegmentResults(segment.segmentId, {live: true});
    console.debug({results});
    targetEl.innerHTML = await templates.segmentResults({results});
}


function onSegmentCollapse() {
    console.debug("XXX unused", arguments);
}


async function updatePeaksTemplate() {
    const source = settings.peakEffortSource || 'power';
    const formatter = peakFormatters[source];
    const peaks = athleteData?.stats?.[source]?.peaks;
    if (peaks) {
        for (const [_period, x] of Object.entries(peaks)) {
            const period = Number(_period);
            const start = streams.time[common.binarySearchClosest(streams.time, x.time - period)];
            const powerRoll = rolls.power.slice(start, x.time);
            const elapsedTime = powerRoll.elapsed();
            const powerAvg = powerRoll.avg();
            const np = powerRoll.np();
            x.rank = athlete?.weight ?
                sauce.power.rank(elapsedTime, powerAvg, np, athlete.weight, athlete.gender) :
                null;
        }
    }
    await updateTemplate('.peak-efforts', templates.peakEfforts, {
        source,
        peaks,
        formatter,
        sport,
    });
}


function updateLoop() {
    if (refreshInterval) {
        updateAll().finally(() => setTimeout(updateLoop, refreshInterval));
    } else {
        updateAll();
    }
}


async function updateData({reset}={}) {
    const [newAthleteData, newStreams, newSegments, newLaps] = await Promise.all([
        common.rpc.getAthleteData(athleteIdent),
        common.rpc.getAthleteStreams(athleteIdent, {startTime: timeOfft}),
        common.rpc.getAthleteSegments(athleteIdent, {endTime: segmentOfft, active: false}),
        common.rpc.getAthleteLaps(athleteIdent, {endTime: lapOfft, active: true}),
    ]);
    const changed = {
        reset,
        athleteData: athleteData?.created !== newAthleteData?.created,
        sport: sport !== newAthleteData?.state?.sport,
    };
    if (changed.athleteData && timeOfft) {
        console.debug("Data reset detected");
        setSelection();
        resetData();
        return await updateData({reset: true});
    }
    athleteData = newAthleteData;
    sport = newAthleteData?.state?.sport;
    if (changed.sport) {
        console.debug("Setting sport to:", sport);
    }
    if (newLaps?.length) {
        changed.laps = true;
        for (const x of newLaps) {
            const existingIdx = laps.findIndex(xx => xx.startIndex === x.startIndex);
            if (existingIdx !== -1) {
                laps.splice(existingIdx, 1, x);
            } else {
                laps.push(x);
                console.debug("New lap found:", laps.length);
            }
        }
        lapOfft = laps.at(-1).end;
    }
    if (athleteData) {
        changed.athlete = JSON.stringify(athlete) !== JSON.stringify(athleteData.athlete);
        if (changed.athlete) {
            athlete = athleteData.athlete;
            console.debug("Athlete updated:", athlete.fullname);
        }
        if (athleteData.courseId !== courseId) {
            changed.course = true;
            courseId = athleteData.courseId;
            geoOffset = 0;
            for (let i = laps.length - 2; i >= 0; i--) {
                if (laps[i].courseId !== courseId) {
                    geoOffset = laps[i + 1].startIndex;
                    break;
                }
            }
            console.debug("Setting course to:", courseId);
            console.debug("Course geo offset:", geoOffset);
        }
    } else if (courseId != null) {
        console.debug("Athlete data is no longer available");
        changed.course = true;
        courseId = undefined;
        geoOffset = 0;
    }
    if (newStreams?.time?.length) {
        //console.debug("Streams data found:", newStreams.time.length);
        changed.streams = true;
        for (const [k, stream] of Object.entries(newStreams)) {
            if (!streams[k]) {
                streams[k] = [];
            }
            for (const x of stream) {
                streams[k].push(x);
            }
        }
        timeOfft = newStreams.time.at(-1) + 1e-6;
    }
    if (newSegments?.length) {
        console.debug("Segments found:", newSegments.length);
        changed.segments = true;
        for (const x of newSegments) {
            const existingIdx = segments.findIndex(xx => xx.segmentId === x.segmentId);
            if (existingIdx !== -1) {
                segments.splice(existingIdx, 1, x);
            } else {
                segments.push(x);
            }
        }
        segmentOfft = Math.max(...segments.map(x => x.end).filter(x => x));
    }
    return changed;
}


async function updateAll() {
    if (!common.isVisible()) {
        return;
    }
    const changed = await updateData();
    if (changed.sport || changed.reset) {
        chartsMod.setSport(sport);
    }
    if (changed.course || changed.reset) {
        const title = worldList.find(x => x.courseId === courseId)?.name;
        document.querySelector('#world-map-title').textContent = title || '';
        zwiftMap.setDragOffset(0, 0);
        voidAutoCenter = false; // must follow set-drag-offset
        if (zwiftMap.histPath) {
            zwiftMap.removeHighlightLine(zwiftMap.histPath);
            zwiftMap.histPath = null;
        }
        if (courseId != null) {
            await zwiftMap.setCourse(courseId);
        }
    }
    if (changed.athleteData || changed.reset) {
        document.querySelector('#content').classList.toggle('no-data', !athleteData);
        const exportBtn = document.querySelector('.button.export-file');
        if (athleteData) {
            exportBtn.removeAttribute('disabled');
            console.debug("Athlete-data creation:", H.datetime(athleteData.created));
        } else {
            exportBtn.setAttribute('disabled', 'disabled');
            console.debug("Athlete-data not available");
        }
    }
    if (changed.streams || changed.reset) {
        if (streams.time?.length) {
            for (let i = positions.length; i < streams.time.length; i++) {
                positions.push(zwiftMap.latlngToPosition(streams.latlng[i]));
                const p = streams.power[i];
                rolls.power.add(streams.time[i], (p || streams.active[i]) ? p : new sauce.data.Pad(p));
            }
            const coursePositions = positions.slice(geoOffset);
            zwiftMap.startEnt.setPosition(coursePositions[0]);
            zwiftMap.endEntity.setPosition(coursePositions.at(-1));
            if (!zwiftMap.histPath) {
                zwiftMap.histPath = zwiftMap.addHighlightLine(coursePositions, 'history', {layer: 'low'});
            } else {
                zwiftMap.updateHighlightLine(zwiftMap.histPath, coursePositions);
            }
        }
        for (const x of streamStackCharts) {
            x.updateData();
        }
        elevationChart.updateData();
        powerZonesChart.updateData();
        packTimeChart.updateData();
        schedUpdateSelectionStats();

        // Only update peaks widget if we're not interacting with it...
        if (!document.activeElement || !document.activeElement.closest('.peak-efforts')) {
            const sig = JSON.stringify(athleteData.stats[settings.peakEffortSource || 'power']?.peaks);
            if (!sig || sig !== curPeaksSig) {
                curPeaksSig = sig;
                updatePeaksTemplate(); // bg okay
            }
        }
    }
    if (changed.segments || changed.reset) {
        updateTemplate('table.segments', templates.segments, {
            settings,
            athlete,
            segments,
            selected: selectedSegment,
        }).then(updated => {
            if (updated) {
                common.initExpanderTable(document.querySelector('table.segments.expandable'),
                                         onSegmentExpand, onSegmentCollapse);
            }
        }); // bg okay
    }
    if (changed.laps || changed.reset) {
        updateTemplate('table.laps', templates.laps, {
            settings,
            athlete,
            streams,
            laps,
            selected: selectedLap,
        }); // bg okay
        if (activeLapOrSegment && selectedLap != null) {
            if (selectedLap >= laps.length) { // possible data reset
                activeLapOrSegment = null;
                selectedLap = null;
                setSelection();
            } else {
                activeLapOrSegment = laps[selectedLap];
                const l = activeLapOrSegment;
                setSelection(l.startIndex, l.endIndex, {lapish: l});
            }
        }
    }
    updateTemplate('.activity-summary', templates.activitySummary, {athleteData}); // bg okay
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
