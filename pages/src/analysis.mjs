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
    reverseLapsAndSegments: true,
});

const H = sauce.locale.human;
const settings = common.settingsStore.get();
const q = new URLSearchParams(window.location.search);
const athleteIdent = q.get('id') || 'self';
const refreshInterval = Number(q.get('refresh') || 2) * 1000;

const minVAMTime = 60;
const chartLeftPad = 50;

const lapSlices = [];
const segmentSlices = [];
const eventSlices = [];
const streams = {};
const positions = [];
const eventSubgroups = new Map();
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
let lastStreamsTime;
let geoOffset = 0;
let selStart;
let selEnd;
let voidAutoCenter = false;
let geoSelection;
let selectionSource;
let selectionEntry;
let segmentResults;
let segmentResultsType;


function resetData() {
    lapSlices.length = 0;
    lapSlices._offt = null;
    segmentSlices.length = 0;
    segmentSlices._offt = null;
    eventSlices.length = 0;
    eventSlices._offt = null;
    positions.length = 0;
    eventSubgroups.clear();
    for (const x of Object.values(streams)) {
        x.length = 0;
    }
    rolls.power = new sauce.power.RollingPower(null, {idealGap: 1, maxGap: 15});
    geoOffset = 0;
    voidAutoCenter = false;
    sport = lastStreamsTime = selStart = selEnd = geoSelection = selectionSource = selectionEntry = undefined;
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


let templateIds = 0;
async function getTemplates(basenames) {
    return Object.fromEntries(await Promise.all(basenames.map(async k => {
        let file;
        if (k.startsWith('/')) {
            k = k.substr(1);
            file = `${k}.html.tpl`;
        } else {
            file = `analysis/${k}.html.tpl`;
        }
        const tpl = await sauce.template.getTemplate(`templates/${file}`);
        tpl.id = templateIds++;
        // camelCase conv keys-with_snakecase--chars
        return [k.replace(/[-_/]+(.)/g, (_, x) => x.toUpperCase()), tpl];
    })));
}


function renderSurgicalTemplate(selector, tpl, attrs) {
    return common.renderSurgicalTemplate(selector, tpl, {
        settings,
        templates,
        common,
        athlete,
        athleteData,
        ...attrs,
    });
}


function getSelectionStats() {
    if (!athleteData) {
        return;
    }
    let powerRoll = rolls.power;
    let leadInKj = 0;
    if (selStart != null) {
        const start = streams.time[selStart];
        const end = streams.time[selEnd];
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
        selStatsActive = renderSurgicalTemplate('.selection-stats', templates.selectionStats,
                                                {selectionStats: stats}).finally(() => {
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
        common.softInnerHTML(streamStatsEls.get('power'), `
            Avg: ${H.power(stats?.power?.avg)}<br/>
            Max: ${H.power(stats?.power?.max)}<br/>
            <abbr class="unit">watts</abbr>`);
        common.softInnerHTML(streamStatsEls.get('hr'), `
            Avg: ${H.number(stats?.hr?.avg)}<br/>
            Max: ${H.number(stats?.hr?.max)}<br/>
            <abbr class="unit">bpm</abbr>`);
        common.softInnerHTML(streamStatsEls.get('speed'), `
            Avg: ${H.pace(stats?.speed?.avg, {fixed: true, precision: 1})}<br/>
            Max: ${H.pace(stats?.speed?.max, {fixed: true, precision: 1})}<br/>
            <abbr class="unit">${H.pace(1, {suffixOnly: true})}</abbr>`);
        common.softInnerHTML(streamStatsEls.get('cadence'), `
            Avg: ${H.number(stats?.cadence?.avg)}<br/>
            Max: ${H.number(stats?.cadence?.max)}<br/>
            <abbr class="unit">rpm</abbr>`);
        common.softInnerHTML(streamStatsEls.get('wbal'), `
            Avg: ${H.number(stats?.wbal?.avg / 1000, {fixed: true, precision: 1})}<br/>
            Min: ${H.number(stats?.wbal?.min / 1000, {fixed: true, precision: 1})}<br/>
            <abbr class="unit">kj</abbr>`);
        common.softInnerHTML(streamStatsEls.get('draft'), `
            Avg: ${H.power(stats?.draft?.avg)}<br/>
            Max: ${H.power(stats?.draft?.max)}<br/>
            <abbr class="unit">watt savings</abbr>`);
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
        color: '#a86',
        hidePoints: true,
        disableAnimation: true,
        padding: [0, 0, 0, 0],
        tooltip: {
            linger: 0,
            format: ({entry}) => H.elevation(entry.y, {separator: ' ', suffix: true})
        },
        xAxis: {
            tickLength: 10,
            padding: 18,
            format: ({value}) => H.distance(value, {suffix: true}),
        },
        yAxis: {
            disabled: true,
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
        const data = streams.altitude.map((x, i) => [streams.distance[i], x]);
        chart.yMax = Math.max(30, sauce.data.max(data.map(x => x[1])));
        chart.yMin = Math.min(0, sauce.data.min(data.map(x => x[1])));
        const segments = [];
        if (geoOffset) {
            geoMaskSegment.width = streams.distance[geoOffset - 1];
            segments.push(geoMaskSegment);
        }
        chart.setSegments(segments, {render: false});
        chart.setData(data);
    };
    chart.addEventListener('brush', ev => {
        if (ev.detail.internal) {
            let {x1, x2} = ev.detail;
            if (x1 == null || x2 == null) {
                selStart = null;
                selEnd = null;
            } else if (x1 !== x2) {
                if (x2 < x1) {
                    [x1, x2] = [x2, x1];
                }
                selStart = common.binarySearchClosest(streams.distance, x1);
                selEnd = common.binarySearchClosest(streams.distance, x2);
            }
            document.dispatchEvent(new Event('brush'));
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
        const axisLabelValue = sc.createSVG({name: 'tspan'});
        const axisLabelUnits = sc.createSVG({
            name: 'tspan',
            attrs: {x: 56, dy: 18},
            style: {
                "font-size": '0.76em'
            }
        });
        const axisLabelFrag = document.createDocumentFragment();
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
                rotate: -30,
                format: ({value}) => {
                    axisLabelValue.textContent = series.fmt(value, {precision: 0, suffix: false});
                    axisLabelUnits.textContent = series.fmt(value, {suffixOnly: true});
                    axisLabelFrag.replaceChildren(axisLabelValue, axisLabelUnits);
                    return axisLabelFrag;
                }
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
                        selStart = null;
                        selEnd = null;
                    } else if (x1 !== x2) {
                        if (x2 < x1) {
                            [x1, x2] = [x2, x1];
                        }
                        selStart = common.binarySearchClosest(streams.time, x1 / 1000);
                        selEnd = common.binarySearchClosest(streams.time, x2 / 1000);
                    }
                    document.dispatchEvent(new Event('brush'));
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
        if (!powerZones || !athlete?.ftp || !athleteData?.timeInPowerZones) {
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
    new ResizeObserver(() => chart.resize()).observe(el);
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
        const data = selectionEntry?.stats || athleteData?.stats;
        if (!data) {
            return;
        }
        totalTime = data.followTime + data.soloTime + data.workTime;
        let subTitle = '';
        if (selectionSource === 'segments' || selectionSource === 'events') {
            let name = selectionSource === 'segments' ?
                selectionEntry.segment?.name || 'Segment' :
                selectionEntry.eventSubgroup?.name || 'Event';
            const max = 24;
            if (name.length > max) {
                name = `<span title="${common.sanitizeAttr(name)}">${name.substr(0, max - 1)}...</span>`;
            }
            subTitle = `<br/>${name}`;
        } else if (selectionSource === 'laps') {
            subTitle = `<br/>Lap ${lapSlices.indexOf(selectionEntry) + 1}`;
        }
        common.softInnerHTML(headerEl, `Pack Time${subTitle}`);
        powers = [
            data.followTime ? data.followKj / data.followTime * 1000 : 0,
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
                    name: 'Following',
                    value: data.followTime / totalTime,
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
    new ResizeObserver(() => chart.resize()).observe(el);
    return chart;
}


function centerMap(positions) {
    const xMin = sauce.data.min(positions.map(x => x[0]));
    const yMin = sauce.data.min(positions.map(x => x[1]));
    const xMax = sauce.data.max(positions.map(x => x[0]));
    const yMax = sauce.data.max(positions.map(x => x[1]));
    zwiftMap.setBounds([xMin, yMax], [xMax, yMin], {padding: 0.18});
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
            'segment-results',
            'segments-list',
            'laps-list',
            'events-list',
        ]),
        common.initNationFlags(),
        common.getWorldList({all: true}),
        common.rpc.getPowerZones(1),
    ]);
    await renderSurgicalTemplate('#content', templates.main, {
        nationFlags,
        worldList,
        peakFormatters,
    });
    if (!athlete) {
        console.warn("Unrecoverable state: page reload required if this is transient");
        return;
    }
    const contentEl = document.querySelector('#content');
    elevationChart = createElevationChart(contentEl.querySelector('#elevation-chart'));
    streamStackCharts = createStreamStackCharts(contentEl.querySelector('.chart-holder.stream-stack .chart'));
    powerZonesChart = createTimeInPowerZonesPie(contentEl.querySelector('nav .time-in-power-zones'));
    packTimeChart = createPackTimeChart(contentEl.querySelector('nav .pack-time'));
    zwiftMap = new map.SauceZwiftMap({
        el: document.querySelector('#map-holder'),
        worldList,
        zoomMin: 0.05,
        fpsLimit: 30,
        autoCenter: false,
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
    document.querySelector('.button.export-file').addEventListener('click', () => {
        const started = new Date(athleteData.created);
        const name = `${athlete ? athlete.fLast : athleteIdent} - ${started.toLocaleString()}`;
        exportFITActivity(name);
    });
    contentEl.addEventListener('dblclick', ev => {
        if (ev.target.closest('header:has(.expander)')) {
            window.getSelection().removeAllRanges(); // prevent selecting text
            ev.target.closest('section').classList.toggle('compressed');
        }
    });
    contentEl.addEventListener('click', ev => {
        const expanderBtn = ev.target.closest('header > .expander');
        if (expanderBtn) {
            ev.target.closest('section').classList.toggle('compressed');
            return;
        }
        const actionBtn = ev.target.closest('.button[data-action]');
        if (actionBtn) {
            handleActionButton(actionBtn, ev);
            return;
        }
        const row = ev.target.closest('table.selectable > tbody > tr:not(.details)');
        if (!row) {
            return;
        }
        const deselecting = row.classList.contains('selected');
        let entry, source;
        if (!deselecting) {
            if (row.dataset.peakSource) {
                const period = Number(row.dataset.peakPeriod);
                const peak = athleteData.stats[row.dataset.peakSource].peaks[period];
                if (peak.ts != null) {
                    const endIndex = streams.time.indexOf(peak.time);
                    const startIndex = common.binarySearchClosest(streams.time, peak.time - period);
                    entry = {startIndex, endIndex, period};
                    source = 'peaks';
                }
            } else if (row.dataset.source) {
                const slices = {
                    laps: lapSlices,
                    segments: segmentSlices,
                    events: eventSlices,
                }[row.dataset.source];
                entry = slices && slices[Number(row.dataset.index)];
                if (entry) {
                    source = row.dataset.source;
                } else {
                    console.error('View vs backend data mismatch', row.dataset.source, row.dataset.index);
                }
            }
        }
        deselectAllSources();
        if (entry) {
            selectionEntry = entry;
            selectionSource = source;
            row.classList.add('selected');
            setSelection(entry.startIndex, entry.endIndex);
            if (source === 'segments') {
                row.parentElement.querySelectorAll(':scope > .expanded')
                    .forEach(x => x.classList.remove('expanded'));
                row.classList.add('expanded');
                row.scrollIntoView({behavior: 'smooth', container: 'nearest'});
                updateSegmentResults(entry).then(redrawn => {
                    // handle async resized expansion..
                    if (redrawn) {
                        const row = contentEl.querySelector('.segments-list > tbody > tr.selected');
                        row.scrollIntoView({behavior: 'smooth', container: 'nearest'});
                    }
                });  // bg okay
            }
        } else {
            selectionSource = selectionEntry = null;
            setSelection();
        }
    }, {capture: true});  // capture because we want to beat expander table click handler

    let updateSegmentsTimout;
    contentEl.addEventListener('input', async ev => {
        const segResPeriod = ev.target.closest('select[name="segment-results-period"]');
        if (segResPeriod) {
            clearTimeout(updateSegmentsTimout);
            common.settingsStore.set('segmentResultsPeriod', segResPeriod.value);
            if (selectionSource === 'segments' && selectionEntry) {
                updateSegmentResults(selectionEntry);  // bg okay
            }
            return;
        }
        const segLimit = ev.target.closest('input[name="segment-results-limit"]');
        if (segLimit) {
            clearTimeout(updateSegmentsTimout);
            common.settingsStore.set('segmentResultsLimit', Math.max(10, Math.min(100, +segLimit.value)));
            updateSegmentsTimout = setTimeout(() => {
                if (selectionSource === 'segments' && selectionEntry) {
                    updateSegmentResults(selectionEntry);  // bg okay
                }
            }, 500);
            return;
        }
        const peakSource = ev.target.closest('select[name="peak-effort-source"]');
        if (peakSource) {
            common.settingsStore.set('peakEffortSource', peakSource.value);
            await updatePeaksTemplate();
            return;
        }
    });

    streamStackCharts[0].addEventListener('brush', ev => elevationChart.setBrush({
        x1: selStart != null ? streams.distance[selStart] : null,
        x2: selEnd != null ? streams.distance[selEnd] : null
    }));
    let brushPath;
    let mapHiUpdateTO;
    elevationChart.addEventListener('brush', ev => {
        const hasZoom = selStart != null && selStart < selEnd;
        if (hasZoom) {
            geoSelection = geoOffset < selEnd ?
                positions.slice(Math.max(geoOffset, selStart), selEnd) :
                null;
            if (geoSelection) {
                if (!brushPath) {
                    brushPath = zwiftMap.addHighlightLine(geoSelection, 'selection', {color: '#2885ffcc'});
                } else if (!mapHiUpdateTO) {
                    // Expensive call with large datasets.  Throttle a bit...
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
                if (selStart != null && selStart < selEnd) {
                    chart.setZoom({
                        xRange: [
                            streams.time[selStart] * 1000,
                            streams.time[selEnd] * 1000
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
            const showOnMap = pos != null && index >= geoOffset;
            if (showOnMap) {
                zwiftMap.cursorEntity.setPosition(pos);
            }
            zwiftMap.cursorEntity.toggleHidden(!showOnMap);
            otherChart.setTooltipPosition({index});
            otherChart.showTooltip();
        } else if (!otherChart.isTooltipPointing()) {
            otherChart.hideTooltip();
        }
    }

    elevationChart.addEventListener('tooltip', onTooltip);
    streamStackCharts[0].addEventListener('tooltip', onTooltip);
    document.addEventListener('brush', () => {
        if (selectionSource) {
            selectionSource = selectionEntry = null;
            deselectAllSources();
            packTimeChart.updateData();
        }
    });

    updateLoop();
}


function handleActionButton(btn, ev) {
    if (btn.dataset.action === 'refresh-segment-results') {
        if (selectionSource === 'segments' && selectionEntry) {
            updateSegmentResults(selectionEntry);
        }
    }
}


function deselectAllSources() {
    document.querySelectorAll('table.selectable tr.selected').forEach(x => x.classList.remove('selected'));
    document.querySelectorAll('table.selectable tr.expanded').forEach(x => x.classList.remove('expanded'));
}


function setSelection(startIndex, endIndex) {
    selStart = startIndex;
    selEnd = endIndex;
    elevationChart.setBrush({
        x1: selStart != null ? streams.distance[selStart] : null,
        x2: selEnd != null ? streams.distance[selEnd] : null
    });
    for (const x of streamStackCharts) {
        if (selStart != null && selStart < selEnd) {
            x.setZoom({
                xRange: [
                    streams.time[selStart] * 1000,
                    streams.time[selEnd] * 1000
                ]
            });
        } else {
            x.setZoom();
        }
    }
    packTimeChart.updateData();
}


function speedEstSlowdownFactor(slope) {
    // Just a very rough estimate of speed slow down for a given slope.
    // Slope of 0 => 1
    // Slope of 0.07 => 2.5
    // I.e. flat is factor 1, 7% grade is 2.5 times slower.
    return Math.exp(13.091 * slope);
}


async function getEventSegmentResults(segment) {
    // WARNING: this is a hack but I've worked the problem and can find no better solution to the
    // core issue with segment results.  We want to know the eventDistance for each segment result
    // but zwift does not include this.  Our local sparse data collection does but is incomplete.
    // Axioms:
    //   1: Non-live segment API does not include event-subgroup-id.
    //   2. Non-live segment API includes repeated athlete results and can be filtered by dates.
    //   3. Live segment API only returns 1 result per athlete and has no date filters.
    //   4. We must handle late joining.
    //   5. We need to correlate the segment clicked on, which has a specific eventDistance, with the
    //      competitors segment results that come from a segment API (thus lacking eventDistance).
    //   6. Athletes may have quit the event but have stayed on course.  We will wrongly include these segment
    //      results until it's determined that the event is over.
    //   7. Segments can appear multiple times per route.
    //   8. Segments can appear multiple times per event when routes lap.
    //   9. Both #8 and #7 can be true simultainiously.

    // 1. Get every segment result that could possibly be during this event...
    const sg = await common.getEventSubgroup(segment.eventSubgroupId);
    const baseSpeed = 25;  // kph, maybe factor power?
    const estMetersPerSec = baseSpeed / speedEstSlowdownFactor(sg.routeClimbing / sg.routeDistance) / 3.6;
    const eventDuration = sg.durationInSeconds ?
        sg.durationInSeconds * 1000 :
        sg.endDistance / estMetersPerSec * 1000;
    const now = await common.getRealTime();
    const isFinished = sg.ts + eventDuration < now;
    const filter = {
        from: sg.ts,
        to: sg.ts + eventDuration,
    };
    const segmentEndTS = segment.startServerTime + segment.stats.elapsedTime * 1000;
    let results = await common.rpc.getSegmentResults(segment.segmentId, filter);
    if (!results.length) {
        return;
    }
    results.sort((a, b) => a.ts - b.ts);

    // 2. Decide which athletes are apart of the event.
    let evResults;
    let evAthletes;
    if (isFinished) {
        // Safe to filter by results, DNFs get pruned now..
        evResults = await common.rpc.getEventSubgroupResults(segment.eventSubgroupId);
        evAthletes = new Set(evResults.map(x => x.profileId));
        for (const {profileId, activityData} of evResults) {
            const endOfRaceSegmentGrace = 30_000;
            const endTS = +new Date(activityData.endDate) + endOfRaceSegmentGrace;
            // Note: late join information is NOT captured by activityData.durationInMilliseconds.
            // This value is just the event finish time and unrelated to join offset.
            results = results.filter(x => x.athleteId !== profileId || x.ts <= endTS);
        }
    } else {
        // Unsafe to use results yet, so use more inclusive entrants as filter set.
        // Athletes that quit will be included until such time that the event result
        // can be verified.
        const entrants = await common.rpc.getEventSubgroupEntrants(segment.eventSubgroupId);
        evAthletes = new Set(entrants.map(x => x.id));
    }
    const pendingAthletes = new Set();
    results = results.filter(x => {
        if (evAthletes.has(x.athleteId)) {
            pendingAthletes.add(x.athleteId);
            return true;
        }
    });
    if (!results.length) {
        return;
    }

    // 3. Find the best matching segment results using highest to lowest confidence methods...
    if (evResults) {
        // Tier 1: Since only finished athletes are in consideration we can safely organize
        // the results by their relative offset from the end.  I.e. Even if you late join and
        // complete just 1 segment in a multilap race, we know it was the last segment. [GOOD]
        const ourResults = results.filter(x => x.athleteId === athleteData.athleteId);
        const ourResultsByProx = ourResults.toSorted((a, b) =>
            Math.abs(a.ts - segmentEndTS) - Math.abs(b.ts - segmentEndTS));
        const nearest = ourResultsByProx[0];
        if (nearest && Math.abs(nearest.ts - segmentEndTS) < 15_000) {
            const endOfft = ourResults.indexOf(nearest) - ourResults.length;
            for (const {profileId, lateJoin} of evResults) {
                pendingAthletes.delete(profileId);
                const candidates = results.filter(x => x.athleteId === profileId);
                const r = candidates.at(endOfft);
                if (r) {
                    results = results.filter(x => x.athleteId !== profileId || x === r);
                } else {
                    if (!lateJoin) {
                        console.warn("Could not find same segment result based on end offset:",
                                     endOfft, candidates);
                    }
                    results = results.filter(x => x.athleteId !== profileId);
                }
            }
        } else {
            // We may have quit.. fallthrough...
            console.warn("Did not find this segment in the results!", segment, ourResults);
        }
    }
    // Tier 2: Look for intersection with our local athlete-data collections [BAD]..
    for (const athleteId of pendingAthletes) {
        const candidates = results.filter(x => x.athleteId === athleteId);
        const locals = (await common.rpc.getAthleteSegments(athleteId, {active: true}))
            ?.filter(x => x.segmentId === segment.segmentId &&
                          x.eventSubgroupId === segment.eventSubgroupId);
        if (locals && locals.length) {
            locals.sort((a, b) => Math.abs(a.endEventDistance - segment.endEventDistance) -
                                  Math.abs(b.endEventDistance - segment.endEventDistance));
            const local = locals[0];
            if (Math.abs(local.endEventDistance - segment.endEventDistance) < 100) {
                if (local.active) {
                    results = results.filter(x => x.athleteId !== athleteId);
                    continue;
                }
                const localEndTS = local.startServerTime + local.stats.elapsedTime * 1000;
                candidates.sort((a, b) => Math.abs(a.ts - localEndTS) - Math.abs(b.ts - localEndTS));
                const nearest = candidates[0];
                if (Math.abs(nearest.ts - localEndTS) < 20_000) {
                    results = results.filter(x => x.athleteId !== athleteId || x === nearest);
                } else {
                    // In some instances the segment results API misses entries.
                    console.error("Unexpected incongruity in local segment data", nearest.ts - localEndTS,
                                  nearest, local);
                    results = results.filter(x => x.athleteId !== athleteId);
                }
                continue;
            }
        }
        // Tier 3: LoFi guess using time proximity [UGLY]..
        candidates.sort((a, b) => Math.abs(a.ts - segmentEndTS) - Math.abs(b.ts - segmentEndTS));
        const nearest = candidates[0];
        const gap = Math.abs(nearest.ts - segmentEndTS);
        if (gap < 240_000) {
            if (gap > 90_000) {
                console.warn("Very low confidence result entry:", gap, nearest);
                nearest.lowConfidence = true;
            }
            results = results.filter(x => x.athleteId !== athleteId || x === nearest);
        } else {
            results = results.filter(x => x.athleteId !== athleteId);
        }
    }
    for (const x of results) {
        x.eventSubgroup = sg;
    }
    return {results, type: isFinished ? 'event' : 'event-tentative'};
}


async function updateSegmentResults(segment) {
    if (segment.eventSubgroupId) {
        const ret = await getEventSegmentResults(segment);
        if (ret) {
            segmentResults = ret.results;
            segmentResultsType = ret.type;
        } else {
            console.warn("No segment results for:", segment.name, segment.segmentId);
            segmentResults = segmentResultsType = null;
        }
    } else {
        const segmentEndTS = segment.startServerTime + segment.stats.elapsedTime * 1000;
        const filter = {
            to: segmentEndTS + 600_000,
            limit: Math.max(10, Math.min(100, settings.segmentResultsLimit || 10)),
        };
        if (settings.segmentResultsPeriod === 'day') {
            filter.from = segmentEndTS - 86400_000;
        } else {
            filter.from = segmentEndTS - 3600_000;
        }
        segmentResults = await common.rpc.getSegmentResults(segment.segmentId, filter);
        segmentResultsType = 'recent';
    }
    if (segmentResults) {
        segmentResults.sort((a, b) => a.elapsed - b.elapsed);
        console.debug('Segment results:', segmentResults);
    }
    return await renderSegments();
}


function renderSegments() {
    const selected = selectionSource === 'segments' ? segmentSlices.indexOf(selectionEntry) : undefined;
    return renderSurgicalTemplate('section.segments-holder', templates.segmentsList, {
        streams,
        segmentSlices,
        selected,
        results: segmentResults,
        type: segmentResultsType,
        period: settings.segmentResultsPeriod || 'hour',
        limit: settings.segmentResultsLimit || 10,
    });
}


async function updatePeaksTemplate() {
    const source = settings.peakEffortSource || 'power';
    const formatter = peakFormatters[source];
    const peaks = athleteData?.stats?.[source]?.peaks;
    if (peaks) {
        for (const [_period, x] of Object.entries(peaks)) {
            if (x.time == null) {
                continue;
            }
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
    await renderSurgicalTemplate('.peak-efforts', templates.peakEfforts, {
        source,
        peaks,
        formatter,
        sport,
        selected: selectionSource === 'peaks' ? selectionEntry.period : null,
    });
}


async function updateLoop() {
    let offline;
    do {
        try {
            await updateAll();
            if (offline) {
                console.info("Connection to Sauce restored");
                offline = false;
            }
        } catch(e) {
            if (e instanceof TypeError && e.message.match(/fetch/)) {
                if (!offline) {
                    console.warn("Connection to Sauce unavailable");
                    offline = true;
                }
            } else {
                console.error("Update problem:", e);
            }
        }
        await common.sleep(refreshInterval);
    }
    while (refreshInterval);
}


function replaceObject(target, source) {
    // Maintain identity of target object but replace contents with source (shallow)
    Object.assign(target, source);
    for (const x of Object.keys(target)) {
        if (!Object.hasOwn(source, x)) {
            delete target[x];
        }
    }
    return target;
}


async function updateAllData({reset}={}) {
    const [newAthleteData, newStreams, newLaps, newSegments, newEvents] = await Promise.all([
        common.rpc.getAthleteData(athleteIdent),
        common.rpc.getAthleteStreams(athleteIdent, {startTime: lastStreamsTime}),
        common.rpc.getAthleteLaps(athleteIdent, {endTime: lapSlices._offt, active: true}),
        common.rpc.getAthleteSegments(athleteIdent, {endTime: segmentSlices._offt, active: true}),
        common.rpc.getAthleteEvents(athleteIdent, {endTime: eventSlices._offt, active: true}),
    ]);
    const changed = {
        reset,
        athleteData: athleteData?.created !== newAthleteData?.created,
        sport: sport !== newAthleteData?.state?.sport,
    };
    if (changed.athleteData && lastStreamsTime) {
        console.debug("Data reset detected");
        resetData();
        deselectAllSources();
        setSelection();
        return await updateAllData({reset: true});
    }
    athleteData = newAthleteData;
    sport = newAthleteData?.state?.sport;
    if (changed.sport) {
        console.debug("Setting sport to:", sport);
    }
    if (newLaps?.length) {
        changed.laps = true;
        for (const x of newLaps) {
            const existingIdx = lapSlices.findIndex(xx => xx.id === x.id);
            if (existingIdx !== -1) {
                replaceObject(lapSlices[existingIdx], x);
            } else {
                console.debug("New lap found:", lapSlices.length, x.id);
                lapSlices.push(x);
            }
        }
        lapSlices._offt = Math.max(...lapSlices.filter(x => !x.active).map(x => x.end));
    }
    if (athleteData) {
        changed.athlete = JSON.stringify({...athlete, updated: null}) !==
                          JSON.stringify({...athleteData.athlete, updated: null});
        if (changed.athlete) {
            athlete = athleteData.athlete;
            console.debug("Athlete updated:", athlete.fullname);
        }
        if (athleteData.courseId !== courseId) {
            changed.course = true;
            courseId = athleteData.courseId;
            geoOffset = 0;
            for (let i = lapSlices.length - 2; i >= 0; i--) {
                if (lapSlices[i].courseId !== courseId) {
                    geoOffset = lapSlices[i + 1].startIndex;
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
        changed.streams = true;
        for (const [k, stream] of Object.entries(newStreams)) {
            if (!streams[k]) {
                streams[k] = [];
            }
            for (const x of stream) {
                streams[k].push(x);
            }
        }
        lastStreamsTime = newStreams.time.at(-1) + 1e-6;
    }
    if (newSegments?.length) {
        changed.segments = true;
        for (const x of newSegments) {
            const existingIdx = segmentSlices.findIndex(xx => xx.id === x.id);
            if (existingIdx !== -1) {
                replaceObject(segmentSlices[existingIdx], x);
            } else {
                console.debug("New segment found:", x.segment.name, x.id);
                segmentSlices.push(x);
            }
        }
        segmentSlices._offt = Math.max(...segmentSlices.filter(x => !x.active).map(x => x.end));
    }
    if (newEvents?.length) {
        changed.events = true;
        for (const x of newEvents) {
            x.eventSubgroup = await common.getEventSubgroup(x.eventSubgroupId);
            if (x.active) {
                x.place = athleteData.eventPosition;
                x.participants = athleteData.eventParticipants;
            } else {
                const results = await common.rpc.getEventSubgroupResults(x.eventSubgroupId);
                console.warn("slow/expensive fetch...", results);
                const ourResult = results.find(x => x.profileId === athleteData.athleteId);
                if (ourResult) {
                    x.place = ourResult.rank;
                }
            }
            const existingIdx = eventSlices.findIndex(xx => xx.id === x.id);
            if (existingIdx !== -1) {
                replaceObject(eventSlices[existingIdx], x);
            } else {
                console.debug("New event found, subgroup:", x.eventSubgroup?.name || x.eventSubgroupId);
                eventSlices.push(x);
            }
        }
        eventSlices._offt = Math.max(...eventSlices.filter(x => !x.active).map(x => x.end));
    }
    return changed;
}


async function updateAll() {
    if (!common.isVisible()) {
        return;
    }
    const changed = await updateAllData();
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
        updatePeaksTemplate();  // bg okay
    }
    if (changed.segments || changed.reset) {
        if (selectionSource === 'segments') {
            const selected = segmentSlices.indexOf(selectionEntry);
            if (selected < 0) {
                selectionSource = selectionEntry = null;
                setSelection();
            } else {
                setSelection(selectionEntry.startIndex, selectionEntry.endIndex);
            }
        }
        renderSegments();  // bg okay
    }
    if (changed.laps || changed.reset) {
        let selected;
        if (selectionSource === 'laps') {
            selected = lapSlices.indexOf(selectionEntry);
            if (selected < 0) {
                selectionSource = selectionEntry = null;
                setSelection();
            } else {
                setSelection(selectionEntry.startIndex, selectionEntry.endIndex);
            }
        }
        renderSurgicalTemplate('section.laps-holder', templates.lapsList, {
            streams,
            lapSlices,
            selected,
        });  // bg okay
    }
    if (changed.events || changed.reset) {
        let selected;
        if (selectionSource === 'events') {
            selected = eventSlices.indexOf(selectionEntry);
            if (selected < 0) {
                selectionSource = selectionEntry = null;
                setSelection();
            } else {
                setSelection(selectionEntry.startIndex, selectionEntry.endIndex);
            }
        }
        renderSurgicalTemplate('section.events-holder', templates.eventsList, {
            streams,
            eventSlices,
            selected,
        });  // bg okay
    }
    renderSurgicalTemplate('.activity-summary', templates.activitySummary);  // bg okay
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
