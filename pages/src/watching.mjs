import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as color from './color.mjs';

common.settingsStore.setDefault({
    lockedFields: false,
    alwaysShowButtons: false,
    solidBackground: false,
    backgroundColor: '#00ff00',
    screens: [{
        id: 'default-screen-1',
        sections: [{
            type: 'large-data-fields',
            id: 'default-large-data-fields',
            groups: [{
                id: 'default-power',
                type: 'power',
            }],
        }, {
            type: 'data-fields',
            id: 'default-data-fields',
            groups: [{
                type: 'hr',
                id: 'default-hr',
            }],
        }, {
            type: 'split-data-fields',
            id: 'default-split-data-fields',
            groups: [{
                type: 'cadence',
                id: 'default-cadence',
            }, {
                type: 'draft',
                id: 'default-draft',
            }],
        }],
    }],
});

const doc = document.documentElement;
const L = sauce.locale;
const H = L.human;
const defaultLineChartLen = Math.ceil(window.innerWidth / 2);
const chartRefs = new Set();
let imperial = !!common.settingsStore.get('/imperialUnits');
L.setImperial(imperial);
let eventMetric;
let eventSubgroup;
let sport = 'cycling';

const sectionSpecs = {
    'large-data-fields': {
        title: 'Data Fields (large)',
        baseType: 'data-fields',
        groups: 1,
    },
    'data-fields': {
        title: 'Data Fields',
        baseType: 'data-fields',
        groups: 1,
    },
    'split-data-fields': {
        title: 'Split Data Fields',
        baseType: 'data-fields',
        groups: 2,
    },
    'single-data-field': {
        title: 'Single Data Field',
        baseType: 'single-data-field',
        groups: 1,
    },
    'line-chart': {
        title: 'Line Chart',
        baseType: 'chart',
        alwaysRender: true,
        defaultSettings: {
            powerEn: true,
            hrEn: true,
            speedEn: true,
            cadenceEn: false,
            draft: false,
            wbalEn: false,
            markMax: 'power',
        },
    },
    'time-in-zones': {
        title: 'Time in Zones',
        baseType: 'time-in-zones',
        defaultSettings: {
            style: 'vert-bars',
            type: 'power',
        },
    },
};

const groupSpecs = {
    power: {
        title: 'Power',
        backgroundImage: 'url(../images/fa/bolt-duotone.svg)',
        fields: [{
            id: 'pwr-cur',
            value: x => H.number(x.state && x.state.power),
            key: 'Current',
            unit: 'w',
        }, {
            id: 'pwr-avg',
            value: x => H.number(x.stats && x.stats.power.avg),
            label: 'avg',
            key: 'Avg',
            unit: 'w',
        }, {
            id: 'pwr-max',
            value: x => H.number(x.stats && x.stats.power.max),
            label: 'max',
            key: 'Max',
            unit: 'w',
        }, {
            id: 'pwr-cur-wkg',
            value: x => humanWkg(x.state && x.state.power, x.athlete),
            key: 'Current',
            unit: 'w/kg',
        }, {
            id: 'pwr-np',
            value: x => H.number(x.stats && x.stats.power.np),
            label: 'np',
            key: 'NP',
        }, {
            id: 'pwr-tss',
            value: x => H.number(x.stats && x.stats.power.tss),
            label: 'tss',
            key: 'TSS',
        },
            ...makeSmoothPowerFields(5),
            ...makeSmoothPowerFields(15),
            ...makeSmoothPowerFields(60),
            ...makeSmoothPowerFields(300),
            ...makeSmoothPowerFields(1200),
            ...makePeakPowerFields(5),
            ...makePeakPowerFields(15),
            ...makePeakPowerFields(60),
            ...makePeakPowerFields(300),
            ...makePeakPowerFields(1200),
        {
            id: 'pwr-lap-avg',
            value: x => H.number(curLap(x) && curLap(x).power.avg),
            label: 'lap',
            key: 'Lap',
            unit: 'w',
        }, {
            id: 'pwr-lap-wkg',
            value: x => humanWkg(curLap(x) && curLap(x).power.avg, x.athlete),
            label: 'lap',
            key: 'Lap',
            unit: 'w/kg',
        }, {
            id: 'pwr-lap-max',
            value: x => H.number(curLap(x) && curLap(x).power.max),
            label: ['max', '(lap)'],
            key: 'Max<tiny>(lap)</tiny>',
            unit: 'w',
        }, {
            id: 'pwr-lap-max-wkg',
            value: x => humanWkg(curLap(x) && curLap(x).power.max, x.athlete),
            label: ['max', '(lap)'],
            key: 'Max<tiny>(lap)</tiny>',
            unit: 'w/kg',
        }, {
            id: 'pwr-lap-np',
            value: x => H.number(curLap(x) && curLap(x).power.np),
            label: ['np', '(lap)'],
            key: 'NP<tiny>(lap)</tiny>',
        },
            ...makePeakPowerFields(5, -1),
            ...makePeakPowerFields(15, -1),
            ...makePeakPowerFields(60, -1),
            ...makePeakPowerFields(300, -1),
            ...makePeakPowerFields(1200, -1),
        {
            id: 'pwr-last-avg',
            value: x => H.number(lastLap(x) && lastLap(x).power.avg || null),
            label: 'last lap',
            key: 'Last Lap',
            unit: 'w',
        }, {
            id: 'pwr-last-avg-wkg',
            value: x => humanWkg(lastLap(x) && lastLap(x).power.avg, x.athlete),
            label: 'last lap',
            key: 'Last Lap',
            unit: 'w/kg',
        }, {
            id: 'pwr-last-max',
            value: x => H.number(lastLap(x) && lastLap(x).power.max || null),
            label: ['max', '(last lap)'],
            key: 'Max<tiny>(last lap)</tiny>',
            unit: 'w',
        }, {
            id: 'pwr-last-max-wkg',
            value: x => humanWkg(lastLap(x) && lastLap(x).power.max, x.athlete),
            label: ['max', '(last lap)'],
            key: 'Max<tiny>(last lap)</tiny>',
            unit: 'w/kg',
        }, {
            id: 'pwr-last-np',
            value: x => H.number(lastLap(x) && lastLap(x).power.np || null),
            label: ['np', '(last lap)'],
            key: 'NP<tiny>(last lap)</tiny>',
        },
            ...makePeakPowerFields(5, -2),
            ...makePeakPowerFields(15, -2),
            ...makePeakPowerFields(60, -2),
            ...makePeakPowerFields(300, -2),
            ...makePeakPowerFields(1200, -2),
        {
            id: 'pwr-vi',
            value: x => H.number(x.stats && x.stats.power.np && x.stats.power.np / x.stats.power.avg,
                {precision: 2, fixed: true}),
            label: 'vi',
            key: 'VI',
        }, {
            id: 'pwr-wbal',
            value: x => H.number(x.stats && (x.stats.power.wBal / 1000), {precision: 1, fixed: true}),
            label: 'w\'bal',
            key: 'W\'bal',
            unit: 'kJ',
        }],
    },
    hr: {
        title: 'Heart Rate',
        backgroundImage: 'url(../images/fa/heartbeat-duotone.svg)',
        fields: [{
            id: 'hr-cur',
            value: x => H.number(x.state && x.state.heartrate || null),
            key: 'Current',
            unit: 'bpm',
        }, {
            id: 'hr-avg',
            value: x => H.number(x.stats && x.stats.hr.avg || null),
            label: 'avg',
            key: 'Avg',
            unit: 'bpm',
        }, {
            id: 'hr-max',
            value: x => H.number(x.stats && x.stats.hr.max || null),
            label: 'max',
            key: 'Max',
            unit: 'bpm',
        },
            makeSmoothHRField(60),
            makeSmoothHRField(300),
            makeSmoothHRField(1200),
        {
            id: 'hr-lap-avg',
            value: x => H.number(curLap(x) && curLap(x).hr.avg || null),
            label: 'lap',
            key: 'Lap',
            unit: 'bpm',
        }, {
            id: 'hr-lap-max',
            value: x => H.number(curLap(x) && curLap(x).hr.max || null),
            label: ['max', '(lap)'],
            key: 'Max<tiny>(lap)</tiny>',
            unit: 'bpm',
        }, {
            id: 'hr-last-avg',
            value: x => H.number(lastLap(x) && lastLap(x).hr.avg || null),
            label: 'last lap',
            key: 'Last Lap',
            unit: 'bpm',
        }, {
            id: 'hr-last-max',
            value: x => H.number(lastLap(x) && lastLap(x).hr.max || null),
            label: ['max', '(last lap)'],
            key: 'Max<tiny>(last lap)</tiny>',
            unit: 'bpm',
        }],
    },
    cadence: {
        title: 'Cadence',
        backgroundImage: 'url(../images/fa/solar-system-duotone.svg)',
        fields: [{
            id: 'cad-cur',
            value: x => H.number(x.state && x.state.cadence),
            key: 'Current',
            unit: cadenceUnit,
        }, {
            id: 'cad-avg',
            value: x => H.number(x.stats && x.stats.cadence.avg || null),
            label: 'avg',
            key: 'Avg',
            unit: cadenceUnit,
        }, {
            id: 'cad-max',
            value: x => H.number(x.stats && x.stats.cadence.max || null),
            label: 'max',
            key: 'Max',
            unit: cadenceUnit,
        }, {
            id: 'cad-lap-avg',
            value: x => H.number(curLap(x) && curLap(x).cadence.avg || null),
            label: 'lap',
            key: 'Lap',
            unit: cadenceUnit,
        }, {
            id: 'cad-lap-max',
            value: x => H.number(curLap(x) && curLap(x).cadence.max || null),
            label: ['max', '(lap)'],
            key: 'Max<tiny>(lap)</tiny>',
            unit: cadenceUnit,
        }, {
            id: 'cad-last-avg',
            value: x => H.number(lastLap(x) && lastLap(x).cadence.avg || null),
            label: 'last lap',
            key: 'Last Lap',
            unit: cadenceUnit,
        }, {
            id: 'cad-last-max',
            value: x => H.number(lastLap(x) && lastLap(x).cadence.max || null),
            label: ['max', '(last lap)'],
            key: 'Max<tiny>(last lap)</tiny>',
            unit: cadenceUnit,
        }],
    },
    draft: {
        title: 'Draft',
        backgroundImage: 'url(../images/fa/wind-duotone.svg)',
        fields: [{
            id: 'draft-cur',
            value: x => H.number(x.state && x.state.draft),
            key: 'Current',
            unit: '%',
        }, {
            id: 'draft-avg',
            value: x => H.number(x.stats && x.stats.draft.avg),
            label: 'avg',
            key: 'Avg',
            unit: '%',
        }, {
            id: 'draft-max',
            value: x => H.number(x.stats && x.stats.draft.max),
            label: 'max',
            key: 'Max',
            unit: '%',
        }, {
            id: 'draft-lap-avg',
            value: x => H.number(curLap(x) && curLap(x).draft.avg),
            label: 'lap',
            key: 'Lap',
            unit: '%',
        }, {
            id: 'draft-lap-max',
            value: x => H.number(curLap(x) && curLap(x).draft.max),
            label: ['max', '(lap)'],
            key: 'Max<tiny>(lap)</tiny>',
            unit: '%',
        }, {
            id: 'draft-last-avg',
            value: x => H.number(lastLap(x) && lastLap(x).draft.avg || null),
            label: 'last lap',
            key: 'Last Lap',
            unit: '%',
        }, {
            id: 'draft-last-max',
            value: x => H.number(lastLap(x) && lastLap(x).draft.max || null),
            label: ['max', '(last lap)'],
            key: 'Max<tiny>(last lap)</tiny>',
            unit: '%',
        }],
    },
    event: {
        title: x => eventSubgroup && eventSubgroup.name || 'Event',
        backgroundImage: 'url(../images/fa/flag-checkered-duotone.svg)',
        fields: [{
            id: 'ev-place',
            value: x => H.number(x.eventPosition),
            key: 'Place',
            unit: x => H.place(x.eventPosition, {suffixOnly: true})
        }, {
            id: 'ev-finish',
            value: x => eventMetric ? eventMetric === 'distance' ? fmtDistValue(x.remaining) : fmtDur(x.remaining) : '-',
            label: 'finish',
            key: 'Finish',
            unit: x => eventMetric === 'distance' ? fmtDistUnit(x && x.state && x.state.eventDistance) : '',
        }, {
            id: 'ev-dst',
            value: x => eventMetric === 'distance' ?
                fmtDistValue(x.state && x.state.eventDistance) : fmtDur(x.state && x.state.time),
            label: () => eventMetric === 'distance' ? 'dist' : 'time',
            key: x => eventMetric === 'distance' ? 'Dist' : 'Time',
            unit: x => eventMetric === 'distance' ? fmtDistUnit(x && x.state && x.state.eventDistance) : '',
        }]
    },
    pace: {
        title: speedLabel,
        backgroundImage: 'url(../images/fa/tachometer-duotone.svg)',
        fields: [{
            id: 'pace-cur',
            value: x => fmtPace(x.state && x.state.speed),
            key: 'Current',
            unit: speedUnit,
        }, {
            id: 'pace-avg',
            value: x => fmtPace(x.stats && x.stats.speed.avg),
            label: 'avg',
            key: 'Avg',
            unit: speedUnit,
        }, {
            id: 'pace-max',
            value: x => fmtPace(x.stats && x.stats.speed.max),
            label: 'max',
            key: 'Max',
            unit: speedUnit,
        }, {
            id: 'pace-lap-avg',
            value: x => fmtPace(curLap(x) && curLap(x).speed.avg),
            label: 'lap',
            key: 'Lap',
            unit: speedUnit,
        }, {
            id: 'pace-lap-max',
            value: x => fmtPace(curLap(x) && curLap(x).speed.max),
            label: ['max', '(lap)'],
            key: 'Max<tiny>(lap)</tiny>',
            unit: speedUnit,
        }, {
            id: 'pace-last-avg',
            value: x => fmtPace(lastLap(x) && lastLap(x).speed.avg),
            label: 'last lap',
            key: 'Last Lap',
            unit: speedUnit,
        }, {
            id: 'pace-last-max',
            value: x => fmtPace(lastLap(x) && lastLap(x).speed.max),
            label: ['max', '(last lap)'],
            key: 'Max<tiny>(last lap)</tiny>',
            unit: speedUnit,
        }],
    },
};

const lineChartFields = [{
    id: 'power',
    name: 'Power',
    color: '#46f',
    domain: [0, 700],
    rangeAlpha: [0.4, 1],
    points: [],
    get: x => x.state.power || 0,
    fmt: x => H.power(x, {seperator: ' ', suffix: true}),
}, {
    id: 'hr',
    name: 'HR',
    color: '#e22',
    domain: [70, 190],
    rangeAlpha: [0.1, 0.7],
    points: [],
    get: x => x.state.heartrate || 0,
    fmt: x => H.number(x) + ' bpm',
}, {
    id: 'speed',
    name: speedLabel,
    color: '#4e3',
    domain: [0, 100],
    rangeAlpha: [0.1, 0.8],
    points: [],
    get: x => x.state.speed || 0,
    fmt: x => fmtPace(x, {seperator: ' ', suffix: true}),
}, {
    id: 'cadence',
    name: 'Cadence',
    color: '#ee3',
    domain: [0, 140],
    rangeAlpha: [0.1, 0.8],
    points: [],
    get: x => x.state.cadence || 0,
    fmt: x => H.number(x) + (sport === 'running' ? ' spm' : ' rpm'),
}, {
    id: 'draft',
    name: 'Draft',
    color: '#e88853',
    domain: [0, 300],
    rangeAlpha: [0.1, 0.9],
    points: [],
    get: x => x.state.draft || 0,
    fmt: x => H.number(x, {suffix: ' %'}),
}, {
    id: 'wbal',
    name: 'W\'bal',
    color: '#4ee',
    domain: [0, 22000],
    rangeAlpha: [0.1, 0.8],
    points: [],
    get: x => x.stats.power.wBal || 0,
    fmt: x => H.number(x / 1000) + ' kJ',
    markMin: true,
}];


function curLap(x) {
    return x && (x.lap || x.stats);
}


function lastLap(x) {
    return x && x.lastLap;
}


function unit(x) {
    return `<abbr class="unit">${x}</abbr>`;
}


function cadenceUnit() {
    return sport === 'running' ? 'spm' : 'rpm';
}


async function getTpl(name) {
    return await sauce.template.getTemplate(`templates/${name}.html.tpl`);
}


function speedLabel() {
    return sport === 'running' ? 'Pace' : 'Speed';
}


function speedUnit() {
    return sport === 'running' ?
        imperial ? '/mi' : '/km' :
        imperial ? 'mph' : 'kph';
}


function fmtPace(x, options) {
    return H.pace(x, {precision: 1, sport, ...options});
}


function shortDuration(x) {
    return H.duration(x, {short: true});
}


function humanWkg(v, athlete) {
    if (v == null || v === false) {
        return '-';
    }
    return H.number(v / (athlete && athlete.weight), {precision: 1, fixed: 1});
}


function _fmtDist(v) {
    if (v == null || v === Infinity || v === -Infinity || isNaN(v)) {
        return ['-', ''];
    } else if (Math.abs(v) < 1000) {
        const suffix = unit(imperial ? 'ft' : 'm');
        return [H.number(imperial ? v / L.metersPerFoot : v), suffix];
    } else {
        return H.distance(v, {precision: 1, suffix: true}).split(/([a-z]+)/i);
    }
}


/*function fmtDist(v) {
    const [val, u] = _fmtDist(v);
    return `${val}${unit(u)}`;
}*/


function fmtDistValue(v) {
    return _fmtDist(v)[0];
}


function fmtDistUnit(v) {
    return _fmtDist(v)[1];
}


function fmtDur(v, options) {
    if (v == null || v === Infinity || v === -Infinity || isNaN(v)) {
        return '-';
    }
    return H.timer(v, options);
}


function makePeakPowerFields(period, lap) {
    const duration = shortDuration(period);
    const lapLabel = {
        '-1': '(lap)',
        '-2': '(last lap)',
    }[lap];
    const key = lap ? `Peak ${duration}<tiny>${lapLabel}</tiny>` : `Peak ${duration}`;

    function getValue(x) {
        const data = x.stats && (lap === -1 ? curLap(x) : lap === -2 ? lastLap(x) : x.stats);
        const o = data && data.power.peaks[period];
        return o && o.avg;
    }

    function label(x) {
        const label = [`peak ${duration}`, lapLabel].filter(x => x);
        if (!x || !x.stats) {
            return label;
        }
        const data = x.stats && (lap === -1 ? curLap(x) : lap === -2 ? lastLap(x) : x.stats);
        const o = data && data.power.peaks[period];
        if (!(o && o.ts)) {
            return label;
        }
        const ago = (Date.now() - o.ts) / 1000;
        const agoText = `${shortDuration(ago)} ago`;
        if (label.length === 1) {
            label.push(agoText);
        } else {
            label[1] += ' | ' + agoText;
        }
        return label;
    }

    return [{
        id: `power-peak-${period}`,
        value: x => H.number(getValue(x)),
        label,
        key,
        unit: 'w'
    }, {
        id: `power-peak-${period}-wkg`,
        value: x => humanWkg(getValue(x), x.athlete),
        label,
        key,
        unit: 'w/kg'
    }];
}


function makeSmoothPowerFields(period) {
    const duration = shortDuration(period);
    const label = duration;
    const key = duration;
    return [{
        id: `power-smooth-${period}`,
        value: x => H.number(x.stats && x.stats.power.smooth[period]),
        label,
        key,
        unit: 'w',
    }, {
        id: `power-smooth-${period}-wkg`,
        value: x => humanWkg(x.stats && x.stats.power.smooth[period], x.athlete),
        label,
        key,
        unit: 'w/kg',
    }];
}


function makeSmoothHRField(period) {
    const duration = shortDuration(period);
    return {
        id: `hr-smooth-${period}`,
        value: x => H.number(x.stats && x.stats.hr.smooth[period]),
        label: duration,
        key: duration,
        unit: 'bpm',
    };
}


const _events = new Map();
function getEventSubgroup(id) {
    if (!_events.has(id)) {
        _events.set(id, null);
        common.rpc.getEventSubgroup(id).then(x => {
            if (x) {
                _events.set(id, x);
            } else {
                // leave it null but allow retry later
                setTimeout(() => _events.delete(id), 30000);
            }
        });
    }
    return _events.get(id);
}


let _echartsLoading;
async function importEcharts() {
    if (!_echartsLoading) {
        _echartsLoading = Promise.all([
            import('../deps/src/echarts.mjs'),
            import('./echarts-sauce-theme.mjs'),
        ]).then(([ec, theme]) => {
            ec.registerTheme('sauce', theme.getTheme('dynamic'));
            addEventListener('resize', resizeCharts);
            return ec;
        });
    }
    return await _echartsLoading;
}


async function createLineChart(el, sectionId, settings) {
    const echarts = await importEcharts();
    const charts = await import('./charts.mjs');
    const fields = lineChartFields.filter(x => settings[x.id + 'En']);
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
    const dataPoints = settings.dataPoints || defaultLineChartLen;
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
            className: 'ec-tooltip',
            trigger: 'axis',
            axisPointer: {label: {formatter: () => ''}}
        },
        xAxis: [{
            show: false,
            data: Array.from(new Array(dataPoints)).map((x, i) => i),
        }],
        yAxis: fields.map(f => ({
            show: false,
            min: x => Math.min(f.domain[0], x.min),
            max: x => Math.max(f.domain[1], x.max),
        })),
        series: fields.map((f, i) => ({
            ...seriesCommon,
            id: f.id,
            name: typeof f.name === 'function' ? f.name() : f.name,
            z: fields.length - i + 1,
            yAxisIndex: i,
            tooltip: {valueFormatter: f.fmt},
            lineStyle: {color: f.color},
        })),
    };
    lineChart.setOption(options);
    lineChart._sauceLegend = new charts.SauceLegend({
        el: el.nextElementSibling,
        chart: lineChart,
        hiddenStorageKey: `watching-hidden-graph-p${sectionId}`,
    });
    chartRefs.add(new WeakRef(lineChart));
    return lineChart;
}


function bindLineChart(lineChart, renderer, settings) {
    const fields = lineChartFields.filter(x => settings[x.id + 'En']);
    const dataPoints = settings.dataPoints || defaultLineChartLen;
    let dataCount = 0;
    let lastRender = 0;
    let oldSport;
    renderer.addCallback(data => {
        const now = Date.now();
        if (now - lastRender < 900) {
            return;
        }
        lastRender = now;
        if (data && data.state) {
            for (const x of fields) {
                x.points.push(x.get(data));
                while (x.points.length > dataPoints) {
                    x.points.shift();
                }
            }
        }
        lineChart.setOption({
            xAxis: [{
                data: [...sauce.data.range(dataPoints)].map(i =>
                    (dataCount > dataPoints ? dataCount - dataPoints : 0) + i),
            }],
            series: fields.map(field => ({
                data: field.points,
                name: typeof field.name === 'function' ? field.name() : field.name,
                markLine: settings.markMax === field.id ? {
                    symbol: 'none',
                    data: [{
                        name: field.markMin ? 'Min' : 'Max',
                        xAxis: field.points.indexOf(sauce.data[field.markMin ? 'min' : 'max'](field.points)),
                        label: {
                            formatter: x => {
                                const nbsp ='\u00A0';
                                return [
                                    ''.padStart(Math.max(0, 5 - x.value), nbsp),
                                    nbsp, nbsp, // for unit offset
                                    field.fmt(field.points[x.value]),
                                    ''.padEnd(Math.max(0, x.value - (dataPoints - 1) + 5), nbsp)
                                ].join('');
                            },
                        },
                        emphasis: {disabled: true},
                    }],
                } : undefined,
            })),
        });
        if (oldSport !== sport) {
            oldSport = sport;
            lineChart._sauceLegend.render();
        }
    });
}


async function createTimeInZonesVertBars(el, sectionId, settings, renderer) {
    el.classList.add('vert-bars');
    const echarts = await importEcharts();
    const chart = echarts.init(el, 'sauce', {renderer: 'svg'});
    chart.setOption({
        grid: {top: '5%', left: '5%', right: '4', bottom: '3%', containLabel: true},
        tooltip: {
            className: 'ec-tooltip',
            trigger: 'axis',
            axisPointer: {
                type: 'shadow',
            }
        },
        xAxis: {type: 'category'},
        yAxis: {
            type: 'value',
            min: 0,
            splitNumber: 2,
            minInterval: 60,
            axisLabel: {
                formatter: fmtDur,
                rotate: 50
            }
        },
        series: [{
            type: 'bar',
            barWidth: '90%',
            tooltip: {valueFormatter: x => fmtDur(x, {long: true})},
        }],
    });
    chartRefs.add(new WeakRef(chart));
    let colors;
    let athleteId;
    let lastRender = 0;
    renderer.addCallback(data => {
        const now = Date.now();
        if (!data || !data.stats || !data.powerZones || now - lastRender < 900) {
            return;
        }
        lastRender = now;
        const extraOptions = {};
        if (data.athleteId !== athleteId) {
            athleteId = data.athleteId;
            colors = powerZoneColors(data.powerZones, x =>
                new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    {offset: 0, color: x.toString()},
                    {offset: 1, color: x.alpha(0.8).toString()}
                ]));
            Object.assign(extraOptions, {xAxis: {data: data.powerZones.map(x => x.zone)}});
        }
        chart.setOption({
            ...extraOptions,
            series: [{
                data: data.stats.power.timeInZones.map(x => ({
                    value: x.time,
                    itemStyle: {color: colors[x.zone]},
                })),
            }],
        });
    });
}


async function createTimeInZonesHorizBar(el, sectionId, settings, renderer) {
    el.classList.add('horiz-bar');
    const echarts = await importEcharts();
    const chart = echarts.init(el, 'sauce', {renderer: 'svg'});
    chart.setOption({
        grid: {top: '5%', left: '0', right: '0', bottom: '3%', containLabel: false},
        tooltip: {
            position: 'inside',
            className: 'ec-tooltip',
        },
        xAxis: {
            show: false,
            type: 'value',
            max: 'dataMax',
        },
        yAxis: {
            show: false,
            type: 'category',
        },
    });
    chartRefs.add(new WeakRef(chart));
    let colors;
    let normZones;
    let athleteId;
    let lastRender = 0;
    renderer.addCallback(data => {
        const now = Date.now();
        if (!data || !data.stats || !data.powerZones || now - lastRender < 900) {
            return;
        }
        lastRender = now;
        if (data.athleteId !== athleteId) {
            athleteId = data.athleteId;
            colors = powerZoneColors(data.powerZones, x =>
                new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                    {offset: 0, color: x.toString()},
                    {offset: 1, color: x.alpha(0.8).toString()}
                ]));
            normZones = new Set(data.powerZones.filter(x => !x.overlap).map(x => x.zone));
        }
        const zones = data.stats.power.timeInZones.filter(x => normZones.has(x.zone));
        chart.setOption({
            series: zones.map(x => ({
                type: 'bar',
                stack: 'zones',
                tooltip: {
                    valueFormatter: x => fmtDur(x, {long: true})
                },
                data: [{
                    value: x.time,
                    name: x.zone,
                    itemStyle: {color: colors[x.zone]},
                }],
            })),
        });
    });
}


async function createTimeInZonesHorizBarMinimal(el, sectionId, settings, renderer) {
    el.classList.add('horiz-bar-minimal');
    let colors;
    let normZones;
    let athleteId;
    let lastRender = 0;
    renderer.addCallback(data => {
        const now = Date.now();
        if (!data || !data.stats || !data.powerZones || now - lastRender < 900) {
            return;
        }
        lastRender = now;
        if (data.athleteId !== athleteId) {
            athleteId = data.athleteId;
            colors = powerZoneColors(data.powerZones);
            normZones = new Set(data.powerZones.filter(x => !x.overlap).map(x => x.zone));
            el.innerHTML = '';
            for (const x of data.stats.power.timeInZones.filter(x => normZones.has(x.zone))) {
                const c = colors[x.zone];
                el.innerHTML += `<div class="zone" data-zone="${x.zone}" style="` +
                    `--theme-zone-color-hue: ${Math.round(c.h * 360)}deg; ` +
                    `--theme-zone-color-sat: ${Math.round(c.s * 100)}%; ` +
                    `--theme-zone-color-light: ${Math.round(c.l * 100)}%; ` +
                    `"></div>`;
            }
        }
        const zones = data.stats.power.timeInZones.filter(x => normZones.has(x.zone));
        const totalTime = zones.reduce((agg, x) => agg + x.time, 0);
        for (const x of zones) {
            el.querySelector(`[data-zone="${x.zone}"]`).style.flexGrow = x.time / totalTime;
        }
    });
}


async function createTimeInZonesPie(el, sectionId, settings, renderer) {
    el.classList.add('pie');
    const echarts = await importEcharts();
    const chart = echarts.init(el, 'sauce', {renderer: 'svg'});
    chart.setOption({
        //grid: {top: '5%', left: '7%', right: '3%', bottom: '3%', containLabel: true},
        tooltip: {
            position: (pos, params, dom, {x, width}, {viewSize}) => {
                const centerX = x + width / 2;
                return centerX < viewSize[0] / 2 ? 'left' : 'right';
            },
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
                valueFormatter: x => fmtDur(x, {long: true})
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
    let athleteId;
    let lastRender = 0;
    let normZones;
    renderer.addCallback(data => {
        const now = Date.now();
        if (!data || !data.stats || !data.powerZones || now - lastRender < 900) {
            return;
        }
        lastRender = now;
        if (data.athleteId !== athleteId) {
            athleteId = data.athleteId;
            colors = powerZoneColors(data.powerZones, x => 
                new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    {offset: 0, color: x.toString()},
                    {offset: 1, color: x.alpha(0.8).toString()}
                ]));
            normZones = new Set(data.powerZones.filter(x => !x.overlap).map(x => x.zone));
        }
        chart.setOption({
            series: [{
                data: data.stats.power.timeInZones.filter(x => normZones.has(x.zone)).map(x => ({
                    value: x.time,
                    name: x.zone,
                    itemStyle: {color: colors[x.zone]},
                })),
            }],
        });
        window.chart = chart;
    });
    let highlighted = 0;
    setInterval(() => {
        if (!normZones || el.querySelector(':hover')) {
            return;
        }
        chart.dispatchAction({type: 'downplay', seriesIndex: 0, dataIndex: highlighted});
        highlighted = (highlighted + 1) % normZones.size;
        chart.dispatchAction({type: 'highlight', seriesIndex: 0, dataIndex: highlighted});
        chart.dispatchAction({type: 'showTip', seriesIndex: 0, dataIndex: highlighted});
    }, 4000);
}


function powerZoneColors(zones, fn) {
    const colors = {};
    for (const [k, v] of Object.entries(common.getPowerZoneColors(zones))) {
        const c = color.parse(v);
        colors[k] = fn ? fn(c) : c;
    }
    return colors;
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


function setBackground() {
    const {solidBackground, backgroundColor} = common.settingsStore.get();
    doc.classList.toggle('solid-background', !!solidBackground);
    if (solidBackground) {
        doc.style.setProperty('--background-color', backgroundColor);
    } else {
        doc.style.removeProperty('--background-color');
    }
}


async function initScreenSettings() {
    const layoutTpl = await getTpl('watching-screen-layout');
    let sIndex = 0;
    const activeScreenEl = document.querySelector('main .active-screen');
    const sIndexEl = document.querySelector('.sIndex');
    const sLenEl = document.querySelector('.sLen');
    const prevBtn = document.querySelector('main header .button[data-action="prev"]');
    const nextBtn = document.querySelector('main header .button[data-action="next"]');
    const delBtn = document.querySelector('main header .button[data-action="delete"]');
    document.querySelector('main .add-section select[name="type"]').innerHTML = Object.entries(sectionSpecs)
        .map(([type, {title}]) => `<option value="${type}">${title}</option>`).join('\n');
    const settings = common.settingsStore.get();

    async function renderScreen() {
        sIndexEl.textContent = sIndex + 1;
        const sLen = settings.screens.length;
        sLenEl.textContent = sLen;
        const screen = settings.screens[sIndex];
        const screenEl = (await layoutTpl({
            screen,
            sIndex,
            groupSpecs,
            sectionSpecs,
            configuring: true
        })).querySelector('.screen');
        activeScreenEl.innerHTML = '';
        activeScreenEl.appendChild(screenEl);
        prevBtn.classList.toggle('disabled', sIndex === 0);
        nextBtn.classList.toggle('disabled', sIndex === sLen - 1);
        delBtn.classList.toggle('disabled', sLen === 1);
    }

    document.querySelector('main header .button-group').addEventListener('click', ev => {
        const btn = ev.target.closest('.button-group .button');
        const action = btn && btn.dataset.action;
        if (!action) {
            return;
        }
        if (action === 'add') {
            settings.screens.push({
                id: `user-section-${settings.screens.length +1}-${Date.now()}`,
                sections: []
            });
            common.settingsStore.set(null, settings);
            sIndex = settings.screens.length - 1;
            renderScreen();
        } else if (action === 'next') {
            sIndex++;
            renderScreen();
        } else if (action === 'prev') {
            sIndex--;
            renderScreen();
        } else if (action === 'delete') {
            settings.screens.splice(sIndex, 1);
            sIndex = Math.max(0, sIndex -1);
            common.settingsStore.set(null, settings);
            renderScreen();
        }
    });
    document.querySelector('main .add-section input[type="button"]').addEventListener('click', ev => {
        ev.preventDefault();
        const type = ev.currentTarget.closest('.add-section').querySelector('select[name="type"]').value;
        const screen = settings.screens[sIndex];
        const sectionSpec = sectionSpecs[type];
        screen.sections.push({
            type,
            id: `user-section-${Date.now()}`,
            groups: sectionSpec.groups ? Array.from(new Array(sectionSpec.groups)).map((_, i) => ({
                id: `user-group-${i}-${Date.now()}`,
                type: Object.keys(groupSpecs)[i] || 'power',
            })) : undefined,
            settings: {...sectionSpec.defaultSettings},
        });
        common.settingsStore.set(null, settings);
        renderScreen();
    });
    activeScreenEl.addEventListener('click', ev => {
        const btn = ev.target.closest('.screen-section .button-group .button');
        const action = btn && btn.dataset.action;
        if (!action) {
            return;
        }
        const sectionEl = btn.closest('.screen-section');
        const sectionId = sectionEl.dataset.sectionId;
        const screen = settings.screens[sIndex];
        if (action === 'edit') {
            const d = sectionEl.querySelector('dialog.edit');
            d.addEventListener('close', ev => {
                if (d.returnValue !== 'save') {
                    return;
                }
                const section = screen.sections.find(x => x.id === sectionId);
                if (!section.settings) {
                    section.settings = {...sectionSpecs[section.type].defaultSettings};
                }
                // Groups are special...
                for (const x of d.querySelectorAll('select[name="group"]')) {
                    section.groups.find(xx => xx.id === x.dataset.id).type = x.value;
                }
                // Everything else is a generic setting...
                for (const x of d.querySelectorAll('select:not([name="group"])')) {
                    let value = x.value === '' ? undefined : x.value;
                    if (value !== undefined && x.dataset.type === 'number') {
                        value = Number(value);
                    }
                    section.settings[x.name] = value;
                }
                for (const x of d.querySelectorAll('input[type="number"]')) {
                    section.settings[x.name] = x.value === '' ? undefined : Number(x.value);
                }
                for (const x of d.querySelectorAll('input[type="checkbox"]')) {
                    section.settings[x.name] = !!x.checked;
                }
                for (const x of d.querySelectorAll('input[type="text"]')) {
                    section.settings[x.name] = x.value || undefined;
                }
                common.settingsStore.set(null, settings);
                renderScreen();
            }, {once: true});
            d.showModal();
        } else if (action === 'delete') {
            screen.sections.splice(screen.sections.findIndex(x => x.id === sectionId), 1);
            common.settingsStore.set(null, settings);
            renderScreen();
        } else {
            throw new TypeError("Invalid action: " + action);
        }
    });
    await renderScreen();
}


export async function main() {
    common.initInteractionListeners();
    setBackground();
    const settings = common.settingsStore.get();
    doc.classList.toggle('always-show-buttons', !!settings.alwaysShowButtons);
    const content = document.querySelector('#content');
    const renderers = [];
    let curScreen;
    const layoutTpl = await getTpl('watching-screen-layout');
    let persistentData = settings.screens.some(x => x.sections.some(xx => sectionSpecs[xx.type].alwaysRender));
    for (const [sIndex, screen] of settings.screens.entries()) {
        const screenEl = (await layoutTpl({
            screen,
            sIndex,
            groupSpecs,
            sectionSpecs
        })).querySelector('.screen');
        if (sIndex) {
            screenEl.classList.add('hidden');
        } else {
            curScreen = screenEl;
        }
        content.appendChild(screenEl);
        const renderer = new common.Renderer(screenEl, {
            id: screen.id,
            fps: null,
            locked: settings.lockedFields,
            backgroundRender: screen.sections.some(x => sectionSpecs[x.type].alwaysRender),
        });
        for (const section of screen.sections) {
            const sectionSpec = sectionSpecs[section.type];
            const baseType = sectionSpec.baseType;
            const settings = section.settings || {...sectionSpec.defaultSettings};
            const sectionEl = screenEl.querySelector(`[data-section-id="${section.id}"]`);
            if (baseType === 'data-fields') {
                const groups = [
                    sectionEl.dataset.groupId ? sectionEl : null,
                    ...sectionEl.querySelectorAll('[data-group-id]')
                ].filter(x => x);
                for (const groupEl of groups) {
                    const mapping = [];
                    for (const [i, fieldEl] of groupEl.querySelectorAll('[data-field]').entries()) {
                        const id = fieldEl.dataset.field;
                        mapping.push({id, default: Number(fieldEl.dataset.default || i)});
                    }
                    const groupSpec = groupSpecs[groupEl.dataset.groupType];
                    renderer.addRotatingFields({
                        el: groupEl,
                        mapping,
                        fields: groupSpec.fields,
                    });
                    if (typeof groupSpec.title === 'function') {
                        const titleEl = groupEl.querySelector('.group-title');
                        renderer.addCallback(() => {
                            const title = groupSpec.title() || '';
                            if (common.softInnerHTML(titleEl, title)) {
                                titleEl.title = title;
                            }
                        });
                    }
                }
            } else if (baseType === 'single-data-field') {
                const groups = [
                    sectionEl.dataset.groupId ? sectionEl : null,
                    ...sectionEl.querySelectorAll('[data-group-id]')
                ].filter(x => x);
                for (const groupEl of groups) {
                    const mapping = [];
                    for (const [i, fieldEl] of groupEl.querySelectorAll('[data-field]').entries()) {
                        const id = fieldEl.dataset.field;
                        mapping.push({id, default: Number(fieldEl.dataset.default || i)});
                    }
                    const groupSpec = groupSpecs[groupEl.dataset.groupType];
                    renderer.addRotatingFields({
                        el: groupEl,
                        mapping,
                        fields: groupSpec.fields,
                    });
                    if (typeof groupSpec.title === 'function') {
                        const titleEl = groupEl.querySelector('.group-title');
                        renderer.addCallback(() => {
                            const title = groupSpec.title() || '';
                            if (common.softInnerHTML(titleEl, title)) {
                                titleEl.title = title;
                            }
                        });
                    }
                }
            } else if (baseType === 'chart') {
                if (section.type === 'line-chart') {
                    const lineChart = await createLineChart(
                        sectionEl.querySelector('.chart-holder.ec'),
                        sectionEl.dataset.sectionId,
                        settings);
                    bindLineChart(lineChart, renderer, settings);
                } else {
                    console.error("Invalid chart type:", section.type);
                }
            } else if (baseType === 'time-in-zones') {
                if (section.type === 'time-in-zones') {
                    const el = sectionEl.querySelector('.zones-holder');
                    const id = sectionEl.dataset.sectionId;
                    if (settings.style === 'vert-bars') {
                        await createTimeInZonesVertBars(el, id, settings, renderer);
                    } else if (settings.style === 'pie') {
                        await createTimeInZonesPie(el, id, settings, renderer);
                    } else if (settings.style === 'horiz-bar-minimal') {
                        await createTimeInZonesHorizBarMinimal(el, id, settings, renderer);
                    } else {
                        await createTimeInZonesHorizBar(el, id, settings, renderer);
                    }
                } else {
                    console.error("Invalid time-in-zones type:", section.type);
                }
            } else {
                console.error("Invalid base type:", baseType);
            }
        }
        renderers.push(renderer);
        renderer.setData({});
        renderer.render();
    }
    const bbSelector = settings.alwaysShowButtons ? '.fixed.button-bar' : '#titlebar .button-bar';
    const prevBtn = document.querySelector(`${bbSelector} .button.prev-screen`);
    const nextBtn = document.querySelector(`${bbSelector} .button.next-screen`);
    prevBtn.classList.add('disabled');
    if (settings.screens.length === 1) {
        nextBtn.classList.add('disabled');
    }
    prevBtn.addEventListener('click', ev => {
        if (!curScreen.previousElementSibling) {
            return;
        }
        curScreen.classList.add('hidden');
        curScreen = curScreen.previousElementSibling;
        curScreen.classList.remove('hidden');
        nextBtn.classList.remove('disabled');
        resizeCharts();
        if (Number(curScreen.dataset.index) === 0) {
            prevBtn.classList.add('disabled');
        }
    });
    nextBtn.addEventListener('click', ev => {
        if (!curScreen.nextElementSibling) {
            return;
        }
        curScreen.classList.add('hidden');
        curScreen = curScreen.nextElementSibling;
        curScreen.classList.remove('hidden');
        prevBtn.classList.remove('disabled');
        resizeCharts();
        if (settings.screens.length === Number(curScreen.dataset.index) + 1) {
            nextBtn.classList.add('disabled');
        }
    });
    const resetBtn = document.querySelector(`${bbSelector} .button.reset`);
    resetBtn.addEventListener('click', ev => {
        common.rpc.resetStats();
    });
    const lapBtn = document.querySelector(`${bbSelector} .button.lap`);
    lapBtn.addEventListener('click', ev => {
        common.rpc.startLap();
    });
    document.addEventListener('keydown', ev => {
        if (ev.ctrlKey && ev.shiftKey) {
            if (ev.key === 'ArrowRight') {
                ev.preventDefault();
                nextBtn.click();
            } else if (ev.key === 'ArrowLeft') {
                ev.preventDefault();
                prevBtn.click();
            } else if (ev.key === 'L') {
                ev.preventDefault();
                lapBtn.click();
            } else if (ev.key === 'R') {
                ev.preventDefault();
                resetBtn.click();
            }
        }
    }, {capture: true});
    common.settingsStore.addEventListener('changed', ev => {
        const changed = ev.data.changed;
        if (changed.size === 1) {
            if (changed.has('backgroundColor')) {
                setBackground();
            } else if (changed.has('/imperialUnits')) {
                imperial = changed.get('/imperialUnits');
            } else if (!changed.has('/theme')) {
                location.reload();
            }
        } else {
            location.reload();
        }
    });
    let athleteId;
    common.subscribe('NOathlete/watching', watching => {
        const force = watching.athleteId !== athleteId;
        athleteId = watching.athleteId;
        sport = watching.state.sport || 'cycling';
        eventMetric = watching.remainingMetric;
        eventSubgroup = getEventSubgroup(watching.state.eventSubgroupId);
        for (const x of renderers) {
            x.setData(watching);
            if (x.backgroundRender || !x._contentEl.classList.contains('hidden')) {
                x.render({force});
            }
        }
    }, {persistent: persistentData});
    setInterval(() => {
        for (const x of renderers) {
            x.setData({
                athleteId: 11,
                state: {
                    power: 100 + (Math.random() * 400),
                    heartrate: 100 + Math.random() * 100,
                    speed: Math.random() * 100,
                },
                powerZones: [
                    /*{zone: 'Z1', from: 0.4, to: 0.8},
                    {zone: 'Z2', from: 0.8, to: 1},
                    {zone: 'Z3', from: 1, to: null},
                    */
                    {zone: 'Z1', from: 0, to: 0.55},
                    {zone: 'Z2', from: 0.55, to: 0.75},
                    {zone: 'Z3', from: 0.75, to: 0.90},
                    {zone: 'Z4', from: 0.90, to: 1.05},
                    {zone: 'Z5', from: 1.05, to: 1.20},
                    {zone: 'Z6', from: 1.2, to: 1.50},
                    {zone: 'Z7', from: 1.5, to: null},
                    {zone: 'SS', overlap: true, from: 0.85, to: 0.92}
                ],
                stats: {
                    power: {
                        timeInZones: [
                            {zone: 'Z1', time: 333 * Math.random()},
                            {zone: 'Z2', time: 333 * Math.random()},
                            {zone: 'Z3', time: 333 * Math.random()},
                            {zone: 'Z4', time: 333 * Math.random()},
                            {zone: 'Z5', time: 333 * Math.random()},
                            {zone: 'Z6', time: 333 * Math.random()},
                            {zone: 'Z7', time: 333 * Math.random()},
                            {zone: 'SS', time: 333 * Math.random()},
                        ]
                    }
                }
            });
            if (x.backgroundRender || !x._contentEl.classList.contains('hidden')) {
                x.render();
            }
        }
    }, 1000);
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form#general')();
    await initScreenSettings();
}
