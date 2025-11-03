import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as color from './color.mjs';
import * as elevationMod from './elevation.mjs';
import * as charts from './charts.mjs';
import * as fieldsMod from './fields.mjs';

common.enableSentry();

const q = new URLSearchParams(window.location.search);
const customIdent = q.get('id');
const athleteIdent = customIdent || 'watching';

const defaultScreens = [{
    id: 'default-screen-1',
    sections: [{
        type: 'large-data-fields',
        id: 'default-top-fields',
        groups: [{
            id: 'default',
            type: 'power',
            defaultFields: ['pwr-cur', 'pwr-avg', 'pwr-max']
        }],
    }, {
        type: 'data-fields',
        id: 'default-middle-fields',
        groups: [{
            type: 'hr',
            id: 'default-hr',
            defaultFields: ['hr-cur', 'hr-avg', 'hr-max']
        }],
    }, {
        type: 'split-data-fields',
        id: 'default-bottom-fields',
        groups: [customIdent ? {
            type: 'time',
            id: 'default-time',
            defaultFields: ['time-gap', 'time-session']
        } : {
            type: 'cadence',
            id: 'default-left',
            defaultFields: ['cad-cur', 'cad-avg']
        }, {
            type: 'draft',
            id: 'default-right',
            defaultFields: ['draft-cur', 'draft-avg']
        }],
    }],
}, {
    id: 'default-screen-2',
    sections: [{
        type: 'large-data-fields',
        id: 'default-top-fields',
        groups: [{
            id: 'default',
            type: 'power',
            defaultFields: ['pwr-cur', 'pwr-lap-avg', 'pwr-lap-max']
        }],
    }, {
        type: 'data-fields',
        id: 'default-middle-fields',
        groups: [{
            type: 'hr',
            id: 'default',
            defaultFields: ['hr-cur', 'hr-lap-avg', 'hr-lap-max']
        }],
    }, {
        type: 'split-data-fields',
        id: 'default-bottom-fields',
        groups: [customIdent ? {
            type: 'time',
            id: 'default-time',
            defaultFields: ['time-gap', 'time-session']
        } : {
            type: 'cadence',
            id: 'default-left',
            defaultFields: ['cad-cur', 'cad-lap-avg']
        }, {
            type: 'draft',
            id: 'default-right',
            defaultFields: ['draft-cur', 'draft-lap-avg']
        }],
    }],
}, {
    id: 'default-screen-3',
    sections: [{
        type: 'split-data-fields',
        id: 'default-top-fields',
        settings: {
            hideTitle: true,
        },
        groups: [{
            type: 'power',
            id: 'default-left',
            defaultFields: ['pwr-np', 'pwr-tss']
        }, {
            type: 'power',
            id: 'default-right',
            defaultFields: ['pwr-wbal', 'pwr-energy']
        }],
    }, {
        type: 'split-data-fields',
        id: 'default-middle-fields',
        settings: {
            hideTitle: true,
        },
        groups: [{
            type: 'power',
            id: 'default-left',
            defaultFields: ['power-peak-5', 'power-peak-15']
        }, {
            type: 'power',
            id: 'default-right',
            defaultFields: ['power-peak-60', 'power-peak-300']
        }],
    }, {
        type: 'line-chart',
        id: 'default-bottom-chart',
    }],
}];


common.settingsStore.setDefault({
    lockedFields: false,
    alwaysShowButtons: false,
    solidBackground: false,
    backgroundColor: '#00ff00',
    horizMode: false,
    wkgPrecision: 1,
    screens: defaultScreens,
});

const doc = document.documentElement;
const L = sauce.locale;
const H = L.human;
const chartRefs = new Set();
let eventMetric;
let eventSubgroup;
let sport = 'cycling';
let powerZones;
let athleteFTP;

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
        baseType: 'data-fields',
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
        baseType: 'chart',
        defaultSettings: {
            style: 'vert-bars',
            type: 'power',
        },
    },
    'elevation-profile': {
        title: 'Elevation Profile',
        baseType: 'chart',
        defaultSettings: {
            preferRoute: true,
        },
    },
};

export const groupSpecs = {
    time: {
        title: 'Time',
        fields: fieldsMod.fields.filter(x => x.group === 'time'),
    },
    power: {
        title: 'Power',
        backgroundImage: 'url(../images/fa/bolt-duotone.svg)',
        fields: [{
            id: 'pwr-cur',
            longName: 'Current Power',
            format: x => H.number(x.state && x.state.power),
            shortName: 'Current',
            suffix: 'w',
        }, {
            id: 'pwr-cur-wkg',
            longName: 'Current W/kg',
            format: x => humanWkg(x.state && x.state.power, x.athlete),
            shortName: 'Current',
            suffix: 'w/kg',
        }, {
            id: 'pwr-avg',
            longName: 'Avg Power',
            format: x => H.number(x.stats && x.stats.power.avg),
            label: 'avg',
            shortName: 'Avg',
            suffix: 'w',
        }, {
            id: 'pwr-avg-wkg',
            longName: 'Avg W/kg',
            format: x => humanWkg(x.state && x.stats.power.avg, x.athlete),
            label: 'avg',
            shortName: 'Avg',
            suffix: 'w/kg',
        }, {
            id: 'pwr-np',
            format: x => H.number(x.stats && x.stats.power.np),
            label: 'np',
            shortName: 'NP®',
            tooltip: common.stripHTML(common.attributions.tp),
        }, {
            id: 'pwr-max',
            longName: 'Max Power',
            format: x => H.number(x.stats && x.stats.power.max),
            label: 'max',
            shortName: 'Max',
            suffix: 'w',
        }, {
            id: 'pwr-max-wkg',
            longName: 'Max W/kg',
            format: x => humanWkg(x.state && x.stats.power.max, x.athlete),
            label: 'max',
            shortName: 'Max',
            suffix: 'w/kg',
        }, {
            id: 'pwr-tss',
            format: x => H.number(x.stats && x.stats.power.tss),
            label: 'tss',
            shortName: 'TSS®',
            tooltip: common.stripHTML(common.attributions.tp),
        }, {
            id: 'pwr-vi',
            format: x => H.number(x.stats && x.stats.power.np && x.stats.power.np / x.stats.power.avg,
                                  {precision: 2, fixed: true}),
            label: 'vi',
            shortName: 'VI',
        }, {
            id: 'pwr-wbal',
            format: x => H.number(x.wBal / 1000, {precision: 1, fixed: true}),
            label: 'w\'bal',
            shortName: 'W\'bal',
            suffix: 'kJ',
        }, {
            id: 'pwr-energy',
            format: x => H.number(x.state?.kj),
            shortName: 'Energy',
            suffix: 'kJ',
        },
        ...fieldsMod.fields.filter(x => [
            'power-avg-solo', 'power-avg-follow', 'power-avg-work',
            'energy-solo', 'energy-follow', 'energy-work'
        ].includes(x.id)).map(x => ({...x, group: 'Pack Dynamics'})),
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
        //
        // Current lap...
        //
        {
            id: 'pwr-lap-avg',
            group: 'Lap',
            longName: 'Avg Power',
            format: x => H.number(curLap(x) && curLap(x).power.avg),
            label: 'lap',
            shortName: 'Lap',
            suffix: 'w',
        }, {
            id: 'pwr-lap-wkg',
            group: 'Lap',
            longName: 'Avg W/kg',
            format: x => humanWkg(curLap(x) && curLap(x).power.avg, x.athlete),
            label: 'lap',
            shortName: 'Lap',
            suffix: 'w/kg',
        }, {
            id: 'pwr-lap-np',
            group: 'Lap',
            longName: 'NP®',
            format: x => H.number(curLap(x) && curLap(x).power.np),
            label: ['np', '(lap)'],
            shortName: 'NP®<tiny>(lap)</tiny>',
            tooltip: common.stripHTML(common.attributions.tp),
        }, {
            id: 'pwr-lap-max',
            group: 'Lap',
            longName: 'Max Power',
            format: x => H.number(curLap(x) && curLap(x).power.max),
            label: ['max', '(lap)'],
            shortName: 'Max<tiny>(lap)</tiny>',
            suffix: 'w',
        }, {
            id: 'pwr-lap-max-wkg',
            group: 'Lap',
            longName: 'Max W/kg',
            format: x => humanWkg(curLap(x) && curLap(x).power.max, x.athlete),
            label: ['max', '(lap)'],
            shortName: 'Max<tiny>(lap)</tiny>',
            suffix: 'w/kg',
        },
        ...fieldsMod.fields.filter(x => [
            'power-avg-solo-lap', 'power-avg-follow-lap', 'power-avg-work-lap',
            'energy-solo-lap', 'energy-follow-lap', 'energy-work-lap'
        ].includes(x.id)).map(x => ({...x, group: 'Pack Dynamics (lap)'})),
        ...makePeakPowerFields(5, -1, {group: 'Lap'}),
        ...makePeakPowerFields(15, -1, {group: 'Lap'}),
        ...makePeakPowerFields(60, -1, {group: 'Lap'}),
        ...makePeakPowerFields(300, -1, {group: 'Lap'}),
        ...makePeakPowerFields(1200, -1, {group: 'Lap'}),
        //
        // Last lap...
        //
        {
            id: 'pwr-last-avg',
            group: 'Last Lap',
            longName: 'Avg Power',
            format: x => H.number(lastLap(x) && lastLap(x).power.avg || null),
            label: 'last lap',
            shortName: 'Last Lap',
            suffix: 'w',
        }, {
            id: 'pwr-last-avg-wkg',
            group: 'Last Lap',
            longName: 'Avg W/kg',
            format: x => humanWkg(lastLap(x) && lastLap(x).power.avg, x.athlete),
            label: 'last lap',
            shortName: 'Last Lap',
            suffix: 'w/kg',
        }, {
            id: 'pwr-last-np',
            group: 'Last Lap',
            longName: 'NP®',
            format: x => H.number(lastLap(x) && lastLap(x).power.np || null),
            label: ['np', '(last lap)'],
            shortName: 'NP®<tiny>(last lap)</tiny>',
            tooltip: common.stripHTML(common.attributions.tp),
        }, {
            id: 'pwr-last-max',
            group: 'Last Lap',
            longName: 'Max Power',
            format: x => H.number(lastLap(x) && lastLap(x).power.max || null),
            label: ['max', '(last lap)'],
            shortName: 'Max<tiny>(last lap)</tiny>',
            suffix: 'w',
        }, {
            id: 'pwr-last-max-wkg',
            group: 'Last Lap',
            longName: 'Max W/kg',
            format: x => humanWkg(lastLap(x) && lastLap(x).power.max, x.athlete),
            label: ['max', '(last lap)'],
            shortName: 'Max<tiny>(last lap)</tiny>',
            suffix: 'w/kg',
        },
        ...makePeakPowerFields(5, -2, {group: 'Last Lap'}),
        ...makePeakPowerFields(15, -2, {group: 'Last Lap'}),
        ...makePeakPowerFields(60, -2, {group: 'Last Lap'}),
        ...makePeakPowerFields(300, -2, {group: 'Last Lap'}),
        ...makePeakPowerFields(1200, -2, {group: 'Last Lap'}),
        ],
    },
    hr: {
        title: 'Heart Rate',
        backgroundImage: 'url(../images/fa/heartbeat-duotone.svg)',
        fields: [{
            id: 'hr-cur',
            format: x => H.number(x.state && x.state.heartrate || null),
            shortName: 'Current',
            suffix: 'bpm',
        }, {
            id: 'hr-avg',
            format: x => H.number(x.stats && x.stats.hr.avg || null),
            label: 'avg',
            shortName: 'Avg',
            suffix: 'bpm',
        }, {
            id: 'hr-max',
            format: x => H.number(x.stats && x.stats.hr.max || null),
            label: 'max',
            shortName: 'Max',
            suffix: 'bpm',
        },
        makeSmoothHRField(60),
        makeSmoothHRField(300),
        makeSmoothHRField(1200),
        {
            id: 'hr-lap-avg',
            format: x => H.number(curLap(x) && curLap(x).hr.avg || null),
            label: 'lap',
            shortName: 'Lap',
            suffix: 'bpm',
        }, {
            id: 'hr-lap-max',
            format: x => H.number(curLap(x) && curLap(x).hr.max || null),
            label: ['max', '(lap)'],
            shortName: 'Max<tiny>(lap)</tiny>',
            suffix: 'bpm',
        }, {
            id: 'hr-last-avg',
            format: x => H.number(lastLap(x) && lastLap(x).hr.avg || null),
            label: 'last lap',
            shortName: 'Last Lap',
            suffix: 'bpm',
        }, {
            id: 'hr-last-max',
            format: x => H.number(lastLap(x) && lastLap(x).hr.max || null),
            label: ['max', '(last lap)'],
            shortName: 'Max<tiny>(last lap)</tiny>',
            suffix: 'bpm',
        }],
    },
    cadence: {
        title: 'Cadence',
        backgroundImage: 'url(../images/fa/solar-system-duotone.svg)',
        fields: [{
            id: 'cad-cur',
            format: x => H.number(x.state && x.state.cadence),
            shortName: 'Current',
            suffix: cadenceUnit,
        }, {
            id: 'cad-avg',
            format: x => H.number(x.stats && x.stats.cadence.avg || null),
            label: 'avg',
            shortName: 'Avg',
            suffix: cadenceUnit,
        }, {
            id: 'cad-max',
            format: x => H.number(x.stats && x.stats.cadence.max || null),
            label: 'max',
            shortName: 'Max',
            suffix: cadenceUnit,
        }, {
            id: 'cad-lap-avg',
            format: x => H.number(curLap(x) && curLap(x).cadence.avg || null),
            label: 'lap',
            shortName: 'Lap',
            suffix: cadenceUnit,
        }, {
            id: 'cad-lap-max',
            format: x => H.number(curLap(x) && curLap(x).cadence.max || null),
            label: ['max', '(lap)'],
            shortName: 'Max<tiny>(lap)</tiny>',
            suffix: cadenceUnit,
        }, {
            id: 'cad-last-avg',
            format: x => H.number(lastLap(x) && lastLap(x).cadence.avg || null),
            label: 'last lap',
            shortName: 'Last Lap',
            suffix: cadenceUnit,
        }, {
            id: 'cad-last-max',
            format: x => H.number(lastLap(x) && lastLap(x).cadence.max || null),
            label: ['max', '(last lap)'],
            shortName: 'Max<tiny>(last lap)</tiny>',
            suffix: cadenceUnit,
        }],
    },
    draft: {
        title: 'Draft',
        backgroundImage: 'url(../images/fa/wind-duotone.svg)',
        fields: [{
            id: 'draft-cur',
            format: x => H.number(x.state && x.state.draft),
            shortName: 'Current',
            suffix: 'w',
        }, {
            id: 'draft-avg',
            format: x => H.number(x.stats && x.stats.draft.avg),
            label: 'avg',
            shortName: 'Avg',
            suffix: 'w',
        }, {
            id: 'draft-max',
            format: x => H.number(x.stats && x.stats.draft.max),
            label: 'max',
            shortName: 'Max',
            suffix: 'w',
        }, {
            id: 'draft-lap-avg',
            format: x => H.number(curLap(x) && curLap(x).draft.avg),
            label: 'lap',
            shortName: 'Lap',
            suffix: 'w',
        }, {
            id: 'draft-lap-max',
            format: x => H.number(curLap(x) && curLap(x).draft.max),
            label: ['max', '(lap)'],
            shortName: 'Max<tiny>(lap)</tiny>',
            suffix: 'w',
        }, {
            id: 'draft-last-avg',
            format: x => H.number(lastLap(x) && lastLap(x).draft.avg || null),
            label: 'last lap',
            shortName: 'Last Lap',
            suffix: 'w',
        }, {
            id: 'draft-last-max',
            format: x => H.number(lastLap(x) && lastLap(x).draft.max || null),
            label: ['max', '(last lap)'],
            shortName: 'Max<tiny>(last lap)</tiny>',
            suffix: 'w',
        }, {
            id: 'draft-energy',
            format: x => H.number(x.stats?.draft?.kj),
            shortName: 'Energy',
            suffix: 'kJ',
        }],
    },
    event: {
        title: x => eventSubgroup?.name || 'Event',
        backgroundImage: 'url(../images/fa/flag-checkered-duotone.svg)',
        fields: [{
            id: 'ev-place',
            format: x => H.number(x.eventPosition),
            shortName: 'Place',
            suffix: x => H.place(x.eventPosition, {suffixOnly: true})
        }, {
            id: 'ev-finish',
            format: x => eventMetric ?
                eventMetric === 'distance' ?
                    fmtDistValue(Math.max(0, x.remaining)) : fmtDur(x.remaining) :
                '-',
            label: 'finish',
            shortName: 'Finish',
            suffix: x => eventMetric === 'distance' ? fmtDistUnit(x && x.remaining) : '',
        }, {
            id: 'ev-dst',
            format: x => fmtDistValue(x.remainingMetric === 'distance' ?
                x.remainingEnd - x.remaining :
                x.state?.eventDistance),
            label: x => x?.state?.eventSubgroupId ? 'ev dist' :
                x?.state?.routeId ?
                    'rt dist' :
                    'dist',
            shortName: x => x?.state?.eventSubgroupId ? 'Ev Dist' :
                x?.state?.routeId ?
                    'RT Dist' :
                    'Dist',
            suffix: x => fmtDistUnit(x?.remainingMetric === 'distance' ?
                x.remainingEnd - x.remaining :
                x?.state?.eventDistance),
        }, {
            id: 'ev-time',
            format: x => fmtDur(x?.state?.time),
            label: 'time',
            shortName: 'Time',
        }]
    },
    pace: {
        title: speedLabel,
        backgroundImage: 'url(../images/fa/tachometer-duotone.svg)',
        fields: [{
            id: 'pace-cur',
            format: x => fmtPace(x.state && x.state.speed),
            shortName: 'Current',
            suffix: speedUnit,
        }, {
            id: 'pace-avg',
            format: x => fmtPace(x.stats && x.stats.speed.avg),
            label: 'avg',
            shortName: 'Avg',
            suffix: speedUnit,
        }, {
            id: 'pace-max',
            format: x => fmtPace(x.stats && x.stats.speed.max),
            label: 'max',
            shortName: 'Max',
            suffix: speedUnit,
        }, {
            id: 'pace-lap-avg',
            format: x => fmtPace(curLap(x) && curLap(x).speed.avg),
            label: 'lap',
            shortName: 'Lap',
            suffix: speedUnit,
        }, {
            id: 'pace-lap-max',
            format: x => fmtPace(curLap(x) && curLap(x).speed.max),
            label: ['max', '(lap)'],
            shortName: 'Max<tiny>(lap)</tiny>',
            suffix: speedUnit,
        }, {
            id: 'pace-last-avg',
            format: x => fmtPace(lastLap(x) && lastLap(x).speed.avg),
            label: 'last lap',
            shortName: 'Last Lap',
            suffix: speedUnit,
        }, {
            id: 'pace-last-max',
            format: x => fmtPace(lastLap(x) && lastLap(x).speed.max),
            label: ['max', '(last lap)'],
            shortName: 'Max<tiny>(last lap)</tiny>',
            suffix: speedUnit,
        }],
    },
    other: {
        title: 'Other',
        fields: [{
            id: 'other-distance',
            format: x => fmtDistValue(x.state && x.state.distance),
            shortName: 'Distance',
            suffix: x => fmtDistUnit(x.state && x.state.distance),
        }, {
            id: 'other-grade',
            format: x => H.number(x.state && x.state.grade * 100, {precision: 1, fixed: true}),
            shortName: 'Grade',
            suffix: '%',
        }]
    },

};

const lineChartFields = ['power', 'hr', 'speed', 'cadence', 'draft', 'wbal'];

function curLap(x) {
    return x && x.lap;
}


function lastLap(x) {
    return x && x.lastLap;
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
        common.imperialUnits ? '/mi' : '/km' :
        common.imperialUnits ? 'mph' : 'kph';
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
    const {wkgPrecision=1} = common.settingsStore.get();
    return H.number(v / (athlete && athlete.weight), {precision: wkgPrecision, fixed: true});
}


function fmtDistValue(v) {
    return H.distance(v);
}


function fmtDistUnit(v) {
    return H.distance(v, {suffixOnly: true});
}


function fmtDur(v, options) {
    if (v == null || v === Infinity || v === -Infinity || isNaN(v)) {
        return '-';
    }
    return H.timer(v, {long: true, ...options});
}


function makePeakPowerFields(period, lap, extra) {
    const duration = shortDuration(period);
    const lapLabel = {
        '-1': '(lap)',
        '-2': '(last lap)',
    }[lap];
    const shortName = lap ? `Peak ${duration}<tiny>${lapLabel}</tiny>` : `Peak ${duration}`;

    function getValue(data) {
        const stats = data.stats && (lap === -1 ? curLap(data) : lap === -2 ? lastLap(data) : data.stats);
        const o = stats && stats.power.peaks[period];
        return o && o.avg;
    }

    function label(data) {
        const l = [`peak ${duration}`, lapLabel].filter(x => x);
        if (!data || !data.stats) {
            return l;
        }
        const stats = data.stats && (lap === -1 ? curLap(data) : lap === -2 ? lastLap(data) : data.stats);
        const o = stats && stats.power.peaks[period];
        if (!(o && o.ts)) {
            return l;
        }
        const ago = (Date.now() - o.ts) / 1000;
        const agoText = `${shortDuration(ago)} ago`;
        if (l.length === 1) {
            l.push(agoText);
        } else {
            l[1] += ' | ' + agoText;
        }
        return l;
    }

    return [{
        id: `power-peak-${period}`,
        longName: `Peak Power (${duration})`,
        format: x => H.number(getValue(x)),
        label,
        shortName,
        suffix: 'w',
        ...extra,
    }, {
        id: `power-peak-${period}-wkg`,
        longName: `Peak W/kg (${duration})`,
        format: x => humanWkg(getValue(x), x.athlete),
        label,
        shortName,
        suffix: 'w/kg',
        ...extra,
    }];
}


function makeSmoothPowerFields(period, extra) {
    const duration = shortDuration(period);
    const label = duration;
    const shortName = duration;
    return [{
        id: `power-smooth-${period}`,
        longName: `Smoothed Power (${duration})`,
        format: x => H.number(x.stats && x.stats.power.smooth[period]),
        label,
        shortName,
        suffix: 'w',
        ...extra,
    }, {
        id: `power-smooth-${period}-wkg`,
        longName: `Smoothed W/kg (${duration})`,
        format: x => humanWkg(x.stats && x.stats.power.smooth[period], x.athlete),
        label,
        shortName,
        suffix: 'w/kg',
        ...extra,
    }];
}


function makeSmoothHRField(period, extra) {
    const duration = shortDuration(period);
    return {
        id: `hr-smooth-${period}`,
        longName: `Smoothed (${duration})`,
        format: x => H.number(x.stats && x.stats.hr.smooth[period]),
        label: duration,
        shortName: duration,
        suffix: 'bpm',
        ...extra,
    };
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


async function createLineChart(el, sectionId, settings, renderer) {
    const echarts = await importEcharts();
    const chart = echarts.init(el, 'sauce', {renderer: 'svg'});
    const fields = lineChartFields.filter(x => settings[x + 'En']).map(x => charts.streamFields[x]);
    const chartEl = chart.getDom();
    let streamsCache;
    let dataPointsLen = 0;
    let lastSport;
    let lastCreated;
    let athleteId;
    let loading;
    const clippyHackId = charts.getMagicZonesClippyHackId();

    chart.setOption({
        animation: false,
        color: fields.map(f => f.color),
        visualMap: charts.getStreamFieldVisualMaps(fields),
        legend: {show: false},
        tooltip: {
            className: 'ec-tooltip',
            trigger: 'axis',
            axisPointer: {label: {formatter: () => ''}}
        },
        xAxis: [{
            show: false, data: []
            //type: 'time', XXX
        }],
        yAxis: fields.map(f => ({
            show: false,
            id: f.id,
            min: x => Math.min(f.domain[0], x.min),
            max: x => Math.max(f.domain[1], x.max),
        })),
        series: fields.map((f, i) => ({
            type: 'line',
            animation: false,  // looks better and saves gobs of CPU
            showSymbol: false,
            emphasis: {disabled: true},
            areaStyle: {}, // fill
            id: f.id,
            name: typeof f.name === 'function' ? f.name() : f.name,
            z: fields.length - i + 1,
            yAxisIndex: i,
            tooltip: {valueFormatter: f.fmt},
            lineStyle: {color: f.color},
        })),
    });

    chart._sauceLegend = new charts.SauceLegend({
        el: el.nextElementSibling,
        chart,
        hiddenStorageKey: `watching-hidden-graph-p${sectionId}`,
    });

    const _resize = chart.resize;
    chart.resize = function() {
        const width = el.clientWidth;
        if (width) {
            const em = Number(getComputedStyle(el).fontSize.slice(0, -2));
            dataPointsLen = settings.dataPoints || Math.ceil(width);
            if (streamsCache && streamsCache.time.length < dataPointsLen) {
                const nulls = Array.from(sauce.data.range(dataPointsLen - streamsCache.time.length))
                    .map(x => null);
                for (const x of Object.values(streamsCache)) {
                    x.unshift(...nulls);
                }
            }
            chart.setOption({
                grid: {
                    top: 1 * em,
                    left: 0.5 * em,
                    right: 0.5 * em,
                    bottom: 0.1 * em,
                },
            });
            chart.renderStreams();
        }
        return _resize.apply(this, arguments);
    };

    chart.renderStreams = () => {
        if (!streamsCache) {
            return;
        }
        const maxCacheSize = Math.max(2000, dataPointsLen * 2);
        if (streamsCache.time.length > maxCacheSize + 100) {
            for (const x of Object.values(streamsCache)) {
                x.splice(0, x.length - maxCacheSize);
            }
        }
        const hasPowerZones = powerZones && athleteFTP && fields.find(x => x.id === 'power') &&
            !chart._sauceLegend.hidden.has('power');
        chart.setOption({
            xAxis: [{data: streamsCache.time.slice(-dataPointsLen)}],
            series: fields.map(field => {
                const points = streamsCache[field.id].slice(-dataPointsLen);
                return {
                    data: points,
                    name: typeof field.name === 'function' ? field.name() : field.name,
                    areaStyle: field.id === 'power' && hasPowerZones ? {color: 'magic-zones'} : {},
                    markLine: settings.markMax === field.id ? {
                        symbol: 'none',
                        data: [{
                            name: field.markMin ? 'Min' : 'Max',
                            xAxis: points.indexOf(sauce.data[field.markMin ? 'min' : 'max'](points)),
                            label: {
                                formatter: x => {
                                    const nbsp ='\u00A0';
                                    return [
                                        ''.padStart(Math.max(0, 10 - x.value), nbsp),
                                        nbsp, nbsp, // for unit offset
                                        field.fmt(points[x.value]),
                                        ''.padEnd(Math.max(0, x.value - (dataPointsLen - 1) + 10), nbsp)
                                    ].join('');
                                },
                            },
                            emphasis: {disabled: true},
                        }],
                    } : undefined,
                };
            }),
        });
    };

    chart.on('rendered', () => charts.magicZonesAfterRender({
        chart,
        hackId: clippyHackId,
        seriesId: 'power',
        zones: powerZones,
        ftp: athleteFTP,
        zLevel: 5,
    }));
    common.subscribe(`streams/${athleteIdent}`, streams => {
        if (!streamsCache) {
            return; // early start, wait for renderer callback to fetch full streams
        }
        streamsCache.time.push(...streams.time);
        for (const x of fields) {
            streamsCache[x.id].push(...streams[x.id]);
        }
        if (common.isVisible() && (!chartEl.checkVisibility || chartEl.checkVisibility())) {
            chart.renderStreams();
        }
    });
    renderer.addCallback(async data => {
        if (loading || !data?.athleteId) {
            return;
        }
        if (lastSport !== sport) {
            lastSport = sport;
            charts.setSport(sport);
            chart._sauceLegend.render();
        }
        if (data.athleteId !== athleteId || lastCreated !== data.created) {
            console.info("Loading streams for:", data.athleteId);
            loading = true;
            athleteId = data.athleteId;
            lastCreated = data.created;
            let streams = {};
            try {
                streams = await common.rpc.getAthleteStreams(athleteId);
            } finally {
                loading = false;
            }
            streamsCache = {};
            for (const x of fields) {
                streamsCache[x.id] = streams[x.id];
            }
            streamsCache.time = streams.time;
            chart.resize();
        }
    });

    chart.resize();
    chartRefs.add(new WeakRef(chart));
    return chart;
}


async function createTimeInZonesVertBars(el, sectionId, settings, renderer) {
    const echarts = await importEcharts();
    const chart = echarts.init(el, 'sauce', {renderer: 'svg'});
    chart.setOption({
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
                showMinLabel: false,
            }
        },
        series: [{
            type: 'bar',
            barWidth: '90%',
            tooltip: {valueFormatter: x => fmtDur(x)},
        }],
    });
    const _resize = chart.resize;
    chart.resize = function() {
        const em = Number(getComputedStyle(el).fontSize.slice(0, -2));
        chart.setOption({
            grid: {
                top: 0.5 * em,
                left: 2.4 * em,
                right: 0.5 * em,
                bottom: 1 * em,
            },
            xAxis: {
                axisLabel: {
                    margin: 0.3 * em,
                }
            }
        });
        return _resize.apply(this, arguments);
    };
    chart.resize();
    chartRefs.add(new WeakRef(chart));
    let colors;
    let athleteId;
    let lastRender = 0;
    renderer.addCallback(data => {
        const now = Date.now();
        if (!data || !data.stats || !data.athlete || !data.athlete.ftp || now - lastRender < 900) {
            return;
        }
        lastRender = now;
        const extraOptions = {};
        if (data.athleteId !== athleteId) {
            athleteId = data.athleteId;
            colors = powerZoneColors(powerZones, c => ({
                c,
                g: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
                    {offset: 0, color: c.toString({legacy: true})},
                    {offset: 1, color: c.alpha(0.5).toString({legacy: true})}
                ])
            }));
            Object.assign(extraOptions, {xAxis: {data: powerZones.map(x => x.zone)}});
        }
        chart.setOption({
            ...extraOptions,
            series: [{
                data: data.timeInPowerZones.map(x => ({
                    value: x.time,
                    itemStyle: {color: colors[x.zone].g},
                })),
            }],
        });
    });
}


function createTimeInZonesHorizBar(el, sectionId, settings, renderer) {
    const colors = powerZoneColors(powerZones);
    const normZones = new Set(powerZones.filter(x => !x.overlap).map(x => x.zone));
    el.innerHTML = '';
    for (const x of normZones) {
        const c = colors[x];
        el.innerHTML += `<div class="zone" data-zone="${x}" style="` +
            `--theme-zone-color-hue: ${Math.round(c.h * 360)}deg; ` +
            `--theme-zone-color-sat: ${Math.round(c.s * 100)}%; ` +
            `--theme-zone-color-light: ${Math.round(c.l * 100)}%; ` +
            `--theme-zone-color-shade-dir: ${c.l > 0.65 ? -1 : 1}; ` +
            `"><span>${x}</span><span class="extra"></span></div>`;
    }
    let lastRender = 0;
    renderer.addCallback(data => {
        const now = Date.now();
        if (!data || !data.stats || !data.athlete || !data.athlete.ftp || now - lastRender < 900) {
            return;
        }
        lastRender = now;
        const zones = data.timeInPowerZones.filter(x => normZones.has(x.zone));
        const totalTime = zones.reduce((agg, x) => agg + x.time, 0);
        for (const x of zones) {
            const zoneEl = el.querySelector(`[data-zone="${x.zone}"]`);
            zoneEl.style.flexGrow = Math.round(100 * x.time / totalTime);
            zoneEl.querySelector('.extra').textContent = H.duration(
                x.time, {short: true, separator: ' '});
        }
    });
}


async function createTimeInZonesPie(el, sectionId, settings, renderer) {
    const echarts = await importEcharts();
    const chart = echarts.init(el, 'sauce', {renderer: 'svg'});
    chart.setOption({
        grid: {top: '1%', left: '1%', right: '1%', bottom: '1%', containLabel: true},
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
                valueFormatter: x => fmtDur(x)
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
        if (!data || !data.stats || !data.athlete || !data.athlete.ftp || now - lastRender < 900) {
            return;
        }
        lastRender = now;
        if (data.athleteId !== athleteId) {
            athleteId = data.athleteId;
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
                data: data.timeInPowerZones.filter(x => normZones.has(x.zone)).map(x => ({
                    name: x.zone,
                    value: x.time,
                    label: {color: colors[x.zone].c.l > 0.65 ? '#000b' : '#fffb'},
                    itemStyle: {color: colors[x.zone].g},
                })),
            }],
        });
    });
}


function powerZoneColors(zones, fn) {
    const colors = {};
    for (const [k, v] of Object.entries(common.getPowerZoneColors(zones))) {
        const c = color.parse(v);
        colors[k] = fn ? fn(c) : c;
    }
    return colors;
}


async function createElevationProfile(el, sectionId, settings, renderer) {
    const worldList = await common.getWorldList();
    const elProfile = new elevationMod.SauceElevationProfile({
        el,
        worldList,
        preferRoute: settings.preferRoute,
    });
    chartRefs.add(new WeakRef(elProfile.chart));
    let watchingId;
    let courseId;
    let initDone;
    common.subscribe('states', states => {
        if (initDone) {
            elProfile.renderAthleteStates(states);
        }
    });
    renderer.addCallback(async data => {
        if (!data || !data.stats || !data.athlete) {
            return;
        }
        if (data.athleteId !== watchingId || data.state.courseId !== courseId) {
            watchingId = data.athleteId;
            courseId = data.state.courseId;
            elProfile.setWatching(watchingId);
            await elProfile.setCourse(courseId);
            initDone = true;
        }
    });
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


function setStyles() {
    const settings = common.settingsStore.get();
    common.setBackground(settings);
    doc.classList.toggle('horizontal', !!settings.horizMode);
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
        activeScreenEl.replaceChildren(await layoutTpl({
            screen,
            sIndex,
            groupSpecs,
            sectionSpecs,
            configuring: true,
            settings,
        }));
        prevBtn.classList.toggle('disabled', sIndex === 0);
        nextBtn.classList.toggle('disabled', sIndex === sLen - 1);
        delBtn.classList.toggle('disabled', sLen === 1);
    }

    common.settingsStore.addEventListener('set', ev => {
        if (['hideBackgroundIcons', 'horizMode'].includes(ev.data.key)) {
            renderScreen();
        }
    });
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
            sIndex = Math.max(0, sIndex - 1);
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
            d.addEventListener('close', () => {
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
    setStyles();
    const settings = common.settingsStore.get();
    doc.classList.toggle('always-show-buttons', !!settings.alwaysShowButtons);
    const content = document.querySelector('#content');
    const renderers = [];
    let curScreen;
    let curScreenIndex = Math.max(0, Math.min(settings.screenIndex || 0, settings.screens.length - 1));
    powerZones = await common.rpc.getPowerZones(1);
    const layoutTpl = await getTpl('watching-screen-layout');
    const ad = await common.rpc.getAthleteData(athleteIdent);
    await assignAthleteGlobals(ad);
    const persistentData = settings.screens.some(x =>
        x.sections.some(xx => sectionSpecs[xx.type].alwaysRender));
    for (const [sIndex, screen] of settings.screens.entries()) {
        const hidden = sIndex !== curScreenIndex;
        const screenEl = (await layoutTpl({
            screen,
            sIndex,
            groupSpecs,
            sectionSpecs,
            athlete: customIdent && ad?.athlete ? ad.athlete : undefined,
            hidden,
            settings,
        })).firstElementChild;
        if (!hidden) {
            curScreen = screenEl;
        }
        content.append(screenEl);
        const renderer = new common.Renderer(screenEl, {
            id: screen.id,
            fps: null,
            locked: settings.lockedFields,
            backgroundRender: screen.sections.some(x => sectionSpecs[x.type].alwaysRender),
        });
        for (const section of screen.sections) {
            const sectionSpec = sectionSpecs[section.type];
            const baseType = sectionSpec.baseType;
            const sectionSettings = section.settings || {...sectionSpec.defaultSettings};
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
                        const def = fieldEl.dataset.default || i;
                        mapping.push({id, default: isNaN(def) ? def : Number(def)});
                    }
                    const groupSpec = groupSpecs[groupEl.dataset.groupType];
                    if (!groupSpec) {
                        console.error('Missing field group:', groupEl.dataset.groupType);
                    } else {
                        renderer.addRotatingFields({
                            el: groupEl,
                            mapping,
                            fields: groupSpec.fields,
                        });
                        if (typeof groupSpec.title === 'function' && !sectionSettings.customTitle &&
                            !sectionSettings.hideTitle) {
                            const titleEl = groupEl.querySelector('.group-title');
                            renderer.addCallback(() => {
                                const title = groupSpec.title() || '';
                                if (common.softInnerHTML(titleEl, title)) {
                                    titleEl.title = title;
                                }
                            });
                        }
                    }
                }
            } else if (baseType === 'chart') {
                if (section.type === 'line-chart') {
                    await createLineChart(sectionEl.querySelector('.chart-holder.ec'),
                                          sectionEl.dataset.sectionId, sectionSettings, renderer);
                } else if (section.type === 'time-in-zones') {
                    const el = sectionEl.querySelector('.zones-holder');
                    const id = sectionEl.dataset.sectionId;
                    if (sectionSettings.style === 'vert-bars') {
                        await createTimeInZonesVertBars(el, id, sectionSettings, renderer);
                    } else if (sectionSettings.style === 'pie') {
                        await createTimeInZonesPie(el, id, sectionSettings, renderer);
                    } else if (sectionSettings.style === 'horiz-bar') {
                        createTimeInZonesHorizBar(el, id, sectionSettings, renderer);
                    }
                } else if (section.type === 'elevation-profile') {
                    const el = sectionEl.querySelector('.elevation-profile-holder');
                    const id = sectionEl.dataset.sectionId;
                    createElevationProfile(el, id, sectionSettings, renderer);
                } else {
                    console.error("Invalid elevation-profile type:", section.type);
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
    prevBtn.classList.toggle('disabled', curScreenIndex === 0);
    nextBtn.classList.toggle('disabled', curScreenIndex === settings.screens.length - 1);
    const switchScreen = dir => {
        const target = dir > 0 ? curScreen.nextElementSibling : curScreen.previousElementSibling;
        if (!target) {
            return;
        }
        curScreen.classList.add('hidden');
        target.classList.remove('hidden');
        curScreen = target;
        settings.screenIndex = (curScreenIndex += dir);
        prevBtn.classList.toggle('disabled', curScreenIndex === 0);
        nextBtn.classList.toggle('disabled', curScreenIndex === settings.screens.length - 1);
        resizeCharts();
        common.settingsStore.set(null, settings);
    };
    prevBtn.addEventListener('click', () => switchScreen(-1));
    nextBtn.addEventListener('click', () => switchScreen(1));
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
    common.settingsStore.addEventListener('set', ev => {
        if (!ev.data.remote) {
            return;
        }
        const key = ev.data.key;
        if (['backgroundColor', 'solidBackground', 'backgroundAlpha', 'horizMode'].includes(key)) {
            setStyles();
            if (key === 'horizMode') {
                requestAnimationFrame(resizeCharts);
            }
        } else if (!['/theme', '/imperialUnits', 'themeOverride'].includes(key)) {
            window.location.reload();
        }
    });
    let athleteId;
    function onAthleteData(ad) {
        assignAthleteGlobals(ad);
        const force = ad.athleteId !== athleteId;
        athleteId = ad.athleteId;
        for (const x of renderers) {
            x.setData(ad);
            if (x.backgroundRender || !x._contentEl.classList.contains('hidden')) {
                x.render({force});
            }
        }
    }
    common.subscribe(`athlete/${athleteIdent}`, onAthleteData, {persistent: persistentData});
    if (ad) {
        onAthleteData(ad);
    }
}


function assignAthleteGlobals(ad) {
    sport = ad?.state.sport || 'cycling';
    eventMetric = ad?.remainingMetric;
    const sg = common.getEventSubgroup(ad?.state.eventSubgroupId);
    if (sg) {
        if (sg instanceof Promise) {
            sg.then(x => eventSubgroup = x);
        }
    } else {
        eventSubgroup = null;
    }
    athleteFTP = ad?.athlete?.ftp;
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form#general')();
    await initScreenSettings();
}
