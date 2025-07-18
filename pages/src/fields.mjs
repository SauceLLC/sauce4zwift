import * as locale from '../../shared/sauce/locale.mjs';
import * as common from './common.mjs';

const H = locale.human;

/*
 * Field spec...
 *
 * id: 'immutable-permanent-ident' // Never change this.  It is used for state between software updates
 * group: 'grouping-ident'         // Fields sharing a group are shown together
 * longName: <string|function>     // Used when horizontal compliance is relaxed
 * shortName: <string|function>    // Used when horizontal compliance is strict
 * tooltip: <string|function>      // Tooltip for field
 * label: <string|function>        // Optional contextual label (used in some large data fields)
 * get: athleteData => <any>       // Override the argument for `format`
 * format: (x, {suffix}) => `...`  // The actual display value;  Handle {suffix: false} for highest compat.
 * suffix: <string|function>       // Just the units/suffix for this field, i.e. 'km/h' (only large fields)
 *
 * unit: [DEPRECATED]              // Legacy property for `suffix`
 * key: [DEPRECATED]               // Legacy property for `shortName`
 * value: [DEPRECATED]`            // Legacy property for `format`
 */


function getSport(ad) {
    return (ad && ad.state && ad.state.sport) || 'cycling';
}


function isRealNumber(v) {
    return !(v == null || v === Infinity || v === -Infinity || isNaN(v));
}


function fmtPace(v, ad) {
    const sport = getSport(ad);
    return H.pace(v, {sport, precision: 1});
}


export function speedUnit(ad) {
    const sport = getSport(ad);
    return H.pace(ad?.state?.speed, {sport, suffixOnly: true});
}


export function speedLabel(ad) {
    const sport = getSport(ad);
    return sport === 'running' ? 'Pace' : 'Speed';
}


export function shortDuration(x) {
    return H.duration(x, {short: true});
}


export function fmtDur(v) {
    return H.timer(v, {long: true});
}


export function fmtWkg(p, athlete) {
    if (!isRealNumber(p) || !athlete || !athlete.ftp) {
        return '-';
    }
    return H.number(p / athlete.weight, {precision: 1, fixed: true});
}


export function fmtPct(p, options={}) {
    return H.number(p * 100, {suffix: '%', html: true, ...options});
}


export function fmtLap(v) {
    if (!isRealNumber(v)) {
        return '-';
    }
    return H.number(v);
}


export function fmtStackedSparkline(data) {
    const tooltips = [];
    let total = 0;
    for (let i = 0; i < data.length; i++) {
        const value = data[i].value;
        if (value != null && !isNaN(value)) {
            total += value;
            if (data[i].format) {
                tooltips.push(`${data[i].label}: ${data[i].format(value)}`);
            }
        }
    }
    return [
        `<div class="field-sparkline"
              style="display: flex; height: 0.7em; border-radius: 0.18rem; overflow: hidden; width: 4em; margin: 0.2rem;"
              title="${tooltips.join('\n')}">`,
        data.map(x => {
            const size = Math.round((x.value / total) * 100);
            return `<div class="sparkline-bar"
                         style="flex: ${size} 0 0; background-color: ${x.color};"></div>`;
        }).join(''),
        `</div>`
    ].join('');
}


const _events = new Map();
function getEventSubgroup(id) {
    if (!id) {
        return null;
    }
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


const _routes = new Map();
function getRoute(id) {
    if (!id) {
        return null;
    }
    if (!_routes.has(id)) {
        _routes.set(id, null);
        common.rpc.getRoute(id).then(x => _routes.set(id, x || null));
    }
    return _routes.get(id);
}


function getEventSubgroupProperty(id, prop) {
    const sg = getEventSubgroup(id);
    return sg && sg[prop];
}


const tpAttr = () => common.stripHTML(common.attributions.tp);


export const fieldGroupNames = {
    time: 'Time',
    athlete: 'Athlete',
    power: 'Power',
    speed: 'Speed',
    draft: 'Draft',
    cadence: 'Cadence',
    hr: 'Heart Rate',
    course: 'Course',
};


export function makePeakPowerFields(period, lap, extra) {
    const duration = shortDuration(period);
    const lapLabel = {
        '-1': '(lap)',
        '-2': '(last lap)',
    }[lap];
    const shortName = lap ? `Peak ${duration}<small> ${lapLabel}</small>` : `Peak ${duration}`;

    function getValue(data) {
        const stats = data.stats && (lap === -1 ? data?.lap : lap === -2 ? data?.lastLap : data.stats);
        const o = stats && stats.power.peaks[period];
        return o && o.avg;
    }

    function label(data) {
        const l = [`peak ${duration}`, lapLabel].filter(x => x);
        if (!data || !data.stats) {
            return l;
        }
        const stats = data.stats && (lap === -1 ? data?.lap : lap === -2 ? data?.lastLap : data.stats);
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
        id: `pwr-peak-${period}`,
        group: 'power',
        longName: `Peak Power (${duration})`,
        format: x => H.number(getValue(x)),
        label,
        shortName,
        suffix: 'w',
        ...extra,
    }, {
        id: `pwr-peak-${period}-wkg`,
        group: 'power',
        longName: `Peak W/kg (${duration})`,
        format: x => fmtWkg(getValue(x), x.athlete),
        label,
        shortName,
        suffix: 'w/kg',
        ...extra,
    }];
}


export function makeSmoothPowerFields(period, extra) {
    const duration = shortDuration(period);
    const label = duration;
    return [{
        id: `pwr-smooth-${period}`,
        group: 'power',
        longName: `Smoothed Power (${duration})`,
        format: x => H.number(x.stats && x.stats.power.smooth[period]),
        label,
        shortName: `Power<small> (${duration})</small>`,
        suffix: 'w',
        ...extra,
    }, {
        id: `pwr-smooth-${period}-wkg`,
        group: 'power',
        longName: `Smoothed W/kg (${duration})`,
        format: x => fmtWkg(x.stats && x.stats.power.smooth[period], x.athlete),
        label,
        shortName: `W/kg<small> (${duration})</small>`,
        suffix: 'w/kg',
        ...extra,
    }];
}


function courseDurationFormat(t, options) {
    const roundTo = t < 60 ? 5 : 60;
    return H.duration(Math.round(t / roundTo) * roundTo, options);
}


export const fields = [{
    group: 'time',
    id: 'time-active',
    longName: 'Active Time',
    format: x => fmtDur(x.stats && x.stats.activeTime || 0),
    shortName: 'Active',
    tooltip: 'Sauce based active time',
}, {
    group: 'time',
    id: 'time-elapsed',
    longName: 'Elapsed Time',
    format: x => fmtDur(x.stats && x.stats.elapsedTime || 0),
    shortName: 'Elapsed',
    tooltip: 'Sauce based elapsed time',
}, {
    group: 'time',
    id: 'time-session',
    longName: 'Session Time',
    format: x => fmtDur(x.state && x.state.time || 0),
    shortName: 'Time',
    tooltip: 'Time as reported by the current Zwift session',
}, {
    group: 'time',
    id: 'time-lap',
    format: x => fmtDur((x.lap || x.stats) && (x.lap || x.stats).activeTime || 0),
    shortName: 'Time<small> (lap)</small>',

}, {
    group: 'time',
    id: 'time-solo',
    longName: 'Solo Time',
    get: x => x.stats?.soloTime || 0,
    format: fmtDur,
    shortName: 'Solo',
    tooltip: 'Time observed riding alone',
}, {
    group: 'time',
    id: 'time-solo-lap',
    longName: 'Solo Time (lap)',
    get: x => x.lap?.soloTime || 0,
    format: fmtDur,
    shortName: 'Solo <ms>timer</ms>',
    tooltip: 'Time observed riding alone (lap)',
}, {
    group: 'time',
    id: 'time-sit',
    longName: 'Sitting Time',
    get: x => x.stats?.sitTime || 0,
    format: fmtDur,
    shortName: 'Sitting',
    tooltip: 'Time observed sitting/following in a group',
}, {
    group: 'time',
    id: 'time-sit-lap',
    longName: 'Sitting Time (lap)',
    get: x => x.lap?.sitTime || 0,
    format: fmtDur,
    shortName: 'Sitting <ms>timer</ms>',
    tooltip: 'Time observed sitting/following in a group (lap)',
}, {
    group: 'time',
    id: 'time-work',
    longName: 'Working Time',
    get: x => x.stats?.workTime || 0,
    format: fmtDur,
    shortName: 'Working',
    tooltip: 'Time observed working/pulling in a group',
}, {
    group: 'time',
    id: 'time-work-lap',
    longName: 'Working Time (lap)',
    get: x => x.lap?.workTime || 0,
    format: fmtDur,
    shortName: 'Working <ms>timer</ms>',
    tooltip: 'Time observed working/pulling in a group (lap)',
}, {
    group: 'time',
    id: 'time-coffee',
    longName: 'Coffee Time',
    get: x => x.stats?.coffeeTime || 0,
    format: fmtDur,
    shortName: 'Coffee',
    tooltip: 'Time observed taking a Coffee break',
}, {
    group: 'time',
    id: 'time-coffee-lap',
    longName: 'Coffee Time (lap)',
    get: x => x.lap?.coffeeTime || 0,
    format: fmtDur,
    shortName: 'Coffee <ms>timer</ms>',
    tooltip: 'Time observed taking a Coffee break (lap)',
}, {
    group: 'time',
    id: 'time-dist-sparkline',
    longName: 'Time Distribution Graph',
    shortName: 'TDG',
    format: x => x.stats ? fmtStackedSparkline([
        {color: '#65a354', label: 'Sitting', value: x.stats.sitTime, format: courseDurationFormat},
        {color: '#d1c209', label: 'Solo', value: x.stats.soloTime, format: courseDurationFormat},
        {color: '#ca3805', label: 'Working', value: x.stats.workTime, format: courseDurationFormat},
    ]) : fmtStackedSparkline([{color: '#777', label: 'Inactive', value: 1}]),
    tooltip: 'Time Distribution Graph\n\nHow much time has been spent sitting-in vs solo vs working',
    label: 'TGD',
}, {
    group: 'time',
    id: 'time-dist-sparkline-lap',
    longName: 'Time Distribution Graph (lap)',
    shortName: 'TDG <ms>timer</ms>',
    format: x => x.stats ? fmtStackedSparkline([
        {color: '#65a354', label: 'Sitting', value: x.lap.sitTime, format: courseDurationFormat},
        {color: '#d1c209', label: 'Solo', value: x.lap.soloTime, format: courseDurationFormat},
        {color: '#ca3805', label: 'Working', value: x.lap.workTime, format: courseDurationFormat}
    ]) : fmtStackedSparkline([{color: '#777', label: 'Inactive', value: 1}]),
    tooltip: 'Time Distribution Graph\n\nHow much time has been spent sitting-in vs solo vs working (lap)',
}, {
    group: 'time',
    id: 'clock',
    longName: 'Clock',
    format: x => new Date().toLocaleTimeString(),
    shortName: '',
}, {
    group: 'athlete',
    id: 'fullname',
    format: x => x.athlete && x.athlete.sanitizedFullname || '-',
    shortName: x => (x && x.athlete) ? '' : 'Athlete Name',
}, {
    group: 'athlete',
    id: 'flastname',
    format: x => x.athlete && x.athlete.fLast || '-',
    shortName: x => (x && x.athlete) ? '' : 'Athlete F.Last',
}, {
    group: 'athlete',
    id: 'team',
    format: x => x.athlete && common.teamBadge(x.athlete.team) || '-',
    shortName: x => (x && x.athlete && x.athlete.team) ? '' : 'Team',
}, {
    group: 'athlete',
    id: 'level',
    format: x => H.number(x.athlete && x.athlete.level),
    shortName: 'Level',
}, {
    group: 'athlete',
    id: 'rideons',
    format: x => H.number(x.state && x.state.rideons),
    shortName: 'Ride Ons',
}, {
    group: 'power',
    id: 'energy',
    format: x => H.number(x.state && x.state.kj),
    shortName: 'Energy',
    suffix: 'kJ',
}, {
    group: 'power',
    id: 'wbal',
    format: x => (x.wBal != null && x.athlete && x.athlete.wPrime) ?
        common.fmtBattery(x.wBal / x.athlete.wPrime) +
            H.number(x.wBal / 1000, {precision: 1}) : '-',
    shortName: 'W\'bal',
    suffix: 'kJ',
}, {
    group: 'power',
    id: 'tss',
    format: x => H.number(x.stats && x.stats.power.tss),
    shortName: 'TSS<abbr>®</abbr>',
    tooltip: tpAttr,
}, {
    group: 'athlete',
    id: 'weight',
    format: x => H.weightClass(x.athlete && x.athlete.weight, {html: true}),
    shortName: 'Weight',
    suffix: () => locale.isImperial() ? 'lbs' : 'kg',
}, {
    group: 'athlete',
    id: 'ftp',
    format: x => H.number(x.athlete && x.athlete.ftp),
    shortName: 'FTP',
    suffix: 'w'
}, {
    group: 'speed',
    id: 'spd-cur',
    format: x => fmtPace(x.state && x.state.speed, x),
    shortName: speedLabel,
    suffix: speedUnit,
}, {
    group: 'speed',
    id: 'spd-smooth-60',
    longName: `Smoothed ${speedLabel()} (${shortDuration(60)})`,
    format: x => fmtPace(x.stats && x.stats.speed.smooth[60], x),
    shortName: x => `${speedLabel(x)}<small> (${shortDuration(60)})</small>`,
    suffix: speedUnit,
}, {
    group: 'speed',
    id: 'spd-avg',
    format: x => fmtPace(x.stats && x.stats.speed.avg, x),
    shortName: x => `${speedLabel(x)}<small> (avg)</small>`,
    suffix: speedUnit,
}, {
    group: 'speed',
    id: 'spd-lap',
    format: x => fmtPace(x.lap && x.lap.speed.avg, x),
    shortName: x => `${speedLabel(x)}<small> (lap)</small>`,
    suffix: speedUnit,
}, {
    group: 'hr',
    id: 'hr-cur',
    format: x => H.number(x.state && x.state.heartrate),
    shortName: 'HR',
    suffix: 'bpm',
}, {
    group: 'hr',
    id: 'hr-smooth-60',
    longName: `Smoothed HR (${shortDuration(60)})`,
    format: x => H.number(x.stats && x.stats.hr.smooth[60]),
    shortName: `HR<small> (${shortDuration(60)})</small>`,
    suffix: 'bpm',
}, {
    group: 'hr',
    id: 'hr-avg',
    format: x => H.number(x.stats && x.stats.hr.avg),
    shortName: 'HR<small> (avg)</small>',
    suffix: 'bpm',
}, {
    group: 'hr',
    id: 'hr-lap',
    format: x => H.number(x.lap && x.lap.hr.avg),
    shortName: 'HR<small> (lap)</small>',
    suffix: 'bpm',
}, {
    group: 'power',
    id: 'pwr-cur',
    format: x => H.number(x.state && x.state.power),
    shortName: `Power`,
    suffix: 'w',
}, {
    group: 'power',
    id: 'pwr-cur-wkg',
    format: x => fmtWkg(x.state && x.state.power, x.athlete),
    shortName: `W/kg`,
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
    group: 'power',
    id: 'pwr-avg',
    format: x => H.number(x.stats && x.stats.power.avg),
    shortName: 'Power<small> (avg)</small>',
    suffix: 'w',
}, {
    group: 'power',
    id: 'pwr-avg-wkg',
    format: x => fmtWkg(x.stats && x.stats.power.avg, x.athlete),
    shortName: 'W/kg<small> (avg)</small>',
}, {
    group: 'power',
    id: 'pwr-lap',
    format: x => H.number(x.lap && x.lap.power.avg),
    shortName: 'Power<small> (lap)</small>',
    suffix: 'w',
}, {
    group: 'power',
    id: 'pwr-lap-wkg',
    format: x => fmtWkg(x.lap && x.lap.power.avg, x.athlete),
    shortName: 'W/kg<small> (lap)</small>',
}, {
    group: 'power',
    id: 'pwr-np',
    format: x => H.number(x.stats && x.stats.power.np),
    shortName: 'NP<abbr>®</abbr>',
    tooltip: tpAttr,
}, {
    group: 'power',
    id: 'pwr-if',
    format: x => fmtPct((x.stats && x.stats.power.np || 0) / (x.athlete && x.athlete.ftp)),
    shortName: 'IF<abbr>®</abbr>',
    tooltip: tpAttr,
}, {
    group: 'power',
    id: 'pwr-vi',
    format: x => H.number(x.stats && x.stats.power.np / x.stats.power.avg, {precision: 2, fixed: true}),
    shortName: 'VI',
}, {
    group: 'power',
    id: 'pwr-max',
    format: x => H.number(x.stats && x.stats.power.max),
    shortName: 'Power<small> (max)</small>',
    suffix: 'w',
}, {
    group: 'draft',
    id: 'draft-cur',
    format: x => H.power(x.state && x.state.draft),
    shortName: 'Draft',
    suffix: x => H.power(x && x.state && x.state.draft, {suffixOnly: true}),
}, {
    group: 'draft',
    id: 'draft-avg',
    format: x => H.power(x.stats && x.stats.draft.avg),
    shortName: 'Draft<small> (avg)</small>',
    suffix: x => H.power(x && x.stats && x.stats.draft.avg, {suffixOnly: true}),
}, {
    group: 'draft',
    id: 'draft-lap',
    format: x => H.power(x.lap && x.lap.draft.avg),
    shortName: 'Draft<small> (lap)</small>',
    suffix: x => H.power(x && x.lap && x.lap.draft.avg, {suffixOnly: true}),
}, {
    group: 'draft',
    id: 'draft-energy',
    format: x => H.number(x.state && x.stats?.draft?.kj),
    shortName: 'Draft<small> (energy)</small>',
    suffix: 'kJ',
}, {
    group: 'cadence',
    id: 'cad-cur',
    format: x => H.number(x.state && x.state.cadence),
    shortName: 'Cadence',
    suffix: x => getSport(x) === 'running' ? 'spm' : 'rpm',
}, {
    group: 'cadence',
    id: 'cad-avg',
    format: x => H.number(x.stats && x.stats.cadence.avg),
    shortName: 'Cadence<small> (avg)</small>',
    suffix: x => getSport(x) === 'running' ? 'spm' : 'rpm',
}, {
    group: 'cadence',
    id: 'cad-lap',
    format: x => H.number(x.lap && x.lap.cadence.avg),
    shortName: 'Cadence<small> (lap)</small>',
    suffix: x => getSport(x) === 'running' ? 'spm' : 'rpm',
}, {
    group: 'course',
    id: 'ev-place',
    format: x => x.eventPosition ?
        `${H.place(x.eventPosition, {suffix: true, html: true})}<small> / ${x.eventParticipants}</small>` :
        '-',
    shortName: 'Place',
}, {
    group: 'course',
    id: 'ev-fin',
    format: x => x.remainingMetric ? x.remainingMetric === 'distance' ?
        H.distance(x.remaining) : fmtDur(x.remaining) : '-',
    shortName: 'Finish',
    suffix: x => (x && x.remainingMetric) === 'distance' ?
        H.distance(x.remaining, {suffixOnly: true}) : '',
}, {
    group: 'course',
    id: 'ev-dst',
    format: x => x.state ? (x.remainingMetric === 'distance' ?
        `${H.distance(x.state.eventDistance, {suffix: true, html: true})}<small> / ` +
        `${H.distance(x.state.eventDistance + x.remaining, {suffix: true, html: true})}</small>` :
        H.distance(x.state.eventDistance, {suffix: true, html: true})) : '-',
    shortName: x => (x && x.remainingMetric === 'distance') ?
        'Dist<small> (event)</small>' : 'Dist<small> (session)</small>',
}, {
    group: 'course',
    id: 'dst',
    format: x => H.distance(x.state && x.state.distance),
    shortName: 'Dist',
    suffix: x => H.distance(x && x.state && x.state.distance, {suffixOnly: true}),
}, {
    group: 'course',
    id: 'game-laps',
    format: x => fmtLap(x.state && x.state.laps + 1),
    tooltip: 'Zwift route lap number',
    shortName: 'Lap<small> (zwift)</small>',
}, {
    group: 'course',
    id: 'sauce-laps',
    format: x => fmtLap(x.lapCount),
    tooltip: 'Sauce stats lap number',
    shortName: 'Lap<small> (sauce)</small>',
}, {
    group: 'course',
    id: 'progress',
    format: x => fmtPct(x.state && x.state.progress || 0),
    shortName: 'Progress',
},{
    group: 'course',
    id: 'ev-name',
    format: x => {
        const name = getEventSubgroupProperty(x.state?.eventSubgroupId, 'name');
        return name ? `${name} <ms>event</ms>` : '-';
    },
    shortName: x => (x?.state?.eventSubgroupId) ? '' : 'Event',
    tooltip: 'Event',
}, {
    group: 'course',
    id: 'rt-name',
    format: x => {
        const sg = getEventSubgroup(x.state?.eventSubgroupId);
        const icon = ' <ms>route</ms>';
        const route = getRoute(sg ? sg.routeId : x.state?.routeId);
        if (route) {
            if (sg) {
                return ((sg.laps && sg.laps > 1) ? `${sg.laps} x ` : '') + route.name + icon;
            } else {
                return route.name + icon;
            }
        } else {
            return '-';
        }
    },
    shortName: x => (x?.state?.eventSubgroupId || x?.state?.routeId) ? '' : 'Route',
    tooltip: 'Route',
}, {
    group: 'course',
    id: 'el-gain',
    format: x => H.elevation(x.state && x.state.climbing),
    shortName: 'Climbed',
    suffix: x => H.elevation(x && x.state && x.state.climbing, {suffixOnly: true}),
}, {
    group: 'course',
    id: 'el-altitude',
    format: x => H.elevation(x.state && x.state.altitude),
    shortName: 'Altitude',
    suffix: x => H.elevation(x && x.state && x.state.altitude, {suffixOnly: true}),
}, {
    group: 'course',
    id: 'grade',
    format: x => fmtPct(x.state && x.state.grade, {precision: 1, fixed: true}),
    shortName: 'Grade',
}];
