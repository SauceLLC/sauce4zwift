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
 * miniName: <string|function>     // Used when horizontal space is the smallest (i.e. table headers)
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


const tpAttr = common.stripHTML(common.attributions.tp);

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
              style="display: flex;
                     height: 0.7em;
                     border-radius: 0.18rem;
                     overflow: hidden;
                     width: 4em;
                     margin: 0.2rem;"
              title="${tooltips.join('\n')}">`,
        data.map(x => {
            const size = total ? Math.round((x.value / total) * 100) : 1;
            return `<div class="sparkline-bar" style="flex: ${size} 0 0;
                                background-color: ${x.color};"></div>`;
        }).join(''),
        `</div>`
    ].join('');
}


export function makePeakPowerFields(period, lap, extra) {
    const duration = shortDuration(period);
    const longDuration = H.duration(period);
    const lapLabel = {
        '-1': '(lap)',
        '-2': '(last lap)',
    }[lap];

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

    const idExtra = lap ? `-lap${lap}` : '';
    const shortName = lap ?
        `Peak ${duration} ${lap === -1 ? '<ms small>timer</ms>' : lapLabel}` :
        `Peak ${duration}`;
    return [{
        id: `pwr-peak-${period}${idExtra}`,
        group: 'power',
        shortName,
        longName: `Peak Power - ${longDuration}` + (lap ? ` ${lapLabel}` : ''),
        format: x => H.number(getValue(x)),
        label,
        suffix: 'w',
        ...extra,
    }, {
        id: `pwr-peak-${period}${idExtra}-wkg`,
        group: 'power',
        shortName,
        longName: `Peak W/kg - ${longDuration}` + (lap ? ` ${lapLabel}` : ''),
        format: x => fmtWkg(getValue(x), x.athlete),
        label,
        suffix: 'w/kg',
        ...extra,
    }];
}


export function makeSmoothPowerFields(period, extra) {
    const duration = shortDuration(period);
    const longDuration = H.duration(period);
    const label = duration;
    return [{
        id: `pwr-smooth-${period}`,
        group: 'power',
        longName: `Smoothed Power - ${longDuration}`,
        format: x => H.number(x.stats && x.stats.power.smooth[period]),
        label,
        shortName: `Power<small> (${duration})</small>`,
        suffix: 'w',
        ...extra,
    }, {
        id: `pwr-smooth-${period}-wkg`,
        group: 'power',
        longName: `Smoothed W/kg - ${longDuration}`,
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


export const timeFields = [{
    id: 'time-active',
    longName: 'Active Time',
    shortName: 'Active',
    format: x => fmtDur(x.stats && x.stats.activeTime || 0),
    tooltip: 'Sauce based active time',
}, {
    id: 'time-elapsed',
    longName: 'Elapsed Time',
    shortName: 'Elapsed',
    miniName: 'Elpsd',
    format: x => fmtDur(x.stats && x.stats.elapsedTime || 0),
    tooltip: 'Sauce based elapsed time',
}, {
    id: 'time-session',
    longName: 'Session Time',
    shortName: 'Time',
    format: x => fmtDur(x.state && x.state.time || 0),
    tooltip: 'Time as reported by the current Zwift session',
}, {
    id: 'time-gap',
    longName: 'Gap Time',
    shortName: 'Gap',
    format: x => fmtDur(x.gap),
    label: 'gap',
}, {
    id: 'time-gap-distance',
    longName: 'Gap Distance',
    shortName: 'Gap',
    format: x => H.distance(x.gapDistance),
    label: 'gap',
    suffix: x => H.distance(0, {suffixOnly: true})
}, {
    id: 'clock',
    longName: 'Clock',
    format: x => new Date().toLocaleTimeString(),
    shortName: '',
}, {
    id: 'time-coffee',
    longName: 'Coffee Time',
    get: x => x.stats?.coffeeTime || 0,
    format: fmtDur,
    shortName: 'Coffee',
    miniName: '<ms>coffee</ms>',
    label: 'coffee',
    tooltip: 'Time observed taking a Coffee break',
}, {
    id: 'time-solo',
    longName: 'Solo Time',
    get: x => x.stats?.soloTime || 0,
    format: fmtDur,
    shortName: 'Solo',
    miniName: '<ms>self_improvement</ms>',
    label: 'solo',
    tooltip: 'Time observed riding alone',
}, {
    id: 'time-follow',
    longName: 'Following Time',
    get: x => x.stats?.followTime || 0,
    format: fmtDur,
    shortName: 'Following',
    label: 'following',
    miniName: '<ms>group_remove</ms>',
    tooltip: 'Time observed sitting-in/following in a group',
}, {
    id: 'time-work',
    longName: 'Working Time',
    get: x => x.stats?.workTime || 0,
    format: fmtDur,
    shortName: 'Working',
    miniName: '<ms>group_add</ms>',
    label: 'working',
    tooltip: 'Time observed working/pulling in a group',
}, {
    id: 'time-pack-graph',
    longName: 'Pack Time Graph',
    shortName: 'Pack',
    label: 'pack time',
    format: x => x.stats ? fmtStackedSparkline([
        {color: '#65a354', label: 'Following', value: x.stats.followTime || 0, format: courseDurationFormat},
        {color: '#d1c209', label: 'Solo', value: x.stats.soloTime || 0, format: courseDurationFormat},
        {color: '#ca3805', label: 'Working', value: x.stats.workTime || 0, format: courseDurationFormat},
    ]) : fmtStackedSparkline([{color: '#777', label: 'Inactive', value: 1}]),
    tooltip: 'Pack Time Graph\n\nHow much time has been spent sitting-in vs solo vs working',
}, {
    id: 'time-lap',
    format: x => fmtDur(x.lap?.activeTime || 0),
    longName: 'Time (lap)',
    shortName: 'Lap',
    label: 'lap',
}, {
    id: 'time-coffee-lap',
    longName: 'Coffee Time (lap)',
    get: x => x.lap?.coffeeTime || 0,
    format: fmtDur,
    shortName: 'Coffee <ms small>timer</ms>',
    miniName: '<ms>coffee</ms> <ms>timer</ms>',
    label: ['coffee', '(lap)'],
    tooltip: 'Time observed taking a Coffee break (lap)',
}, {
    id: 'time-solo-lap',
    longName: 'Solo Time (lap)',
    get: x => x.lap?.soloTime || 0,
    format: fmtDur,
    shortName: 'Solo <ms small>timer</ms>',
    miniName: '<ms>self_improvement</ms> <ms small>timer</ms>',
    label: ['solo', '(lap)'],
    tooltip: 'Time observed riding alone (lap)',
}, {
    id: 'time-follow-lap',
    longName: 'Following Time (lap)',
    get: x => x.lap?.followTime || 0,
    format: fmtDur,
    shortName: 'Following <ms small>timer</ms>',
    miniName: '<ms>group_remove</ms> <ms small>timer</ms>',
    label: ['following', '(lap)'],
    tooltip: 'Time observed sitting-in/following in a group (lap)',
}, {
    id: 'time-work-lap',
    longName: 'Working Time (lap)',
    get: x => x.lap?.workTime || 0,
    format: fmtDur,
    shortName: 'Working <ms small>timer</ms>',
    miniName: '<ms>group_add</ms> <ms small>timer</ms>',
    label: ['working', '(lap)'],
    tooltip: 'Time observed working/pulling in a group (lap)',
}, {
    id: 'time-pack-graph-lap',
    longName: 'Pack Time Graph (lap)',
    shortName: 'Pack <ms small>timer</ms>',
    format: x => x.lap ? fmtStackedSparkline([
        {color: '#65a354', label: 'Following', value: x.lap.followTime || 0, format: courseDurationFormat},
        {color: '#d1c209', label: 'Solo', value: x.lap.soloTime || 0, format: courseDurationFormat},
        {color: '#ca3805', label: 'Working', value: x.lap.workTime || 0, format: courseDurationFormat}
    ]) : fmtStackedSparkline([{color: '#777', label: 'Inactive', value: 1}]),
    label: ['pack time', '(lap)'],
    tooltip: 'Pack Time Graph\n\nHow much time has been spent sitting-in vs solo vs working (lap)',
}];
timeFields.forEach(x => x.group = 'time');


export const athleteFields = [{
    id: 'fullname',
    format: x => x.athlete && x.athlete.sanitizedFullname || '-',
    shortName: x => (x && x.athlete) ? '' : 'Athlete Name',
}, {
    id: 'flastname',
    format: x => x.athlete && x.athlete.fLast || '-',
    shortName: x => (x && x.athlete) ? '' : 'Athlete F.Last',
}, {
    id: 'team',
    format: x => x.athlete && common.teamBadge(x.athlete.team) || '-',
    shortName: x => (x && x.athlete && x.athlete.team) ? '' : 'Team',
}, {
    id: 'level',
    format: x => H.number(x.athlete && x.athlete.level),
    shortName: 'Level',
}, {
    id: 'rideons',
    format: x => H.number(x.state && x.state.rideons),
    shortName: 'Ride Ons',
}, {
    id: 'weight',
    format: x => H.weightClass(x.athlete && x.athlete.weight, {html: true}),
    shortName: 'Weight',
    suffix: () => locale.isImperial() ? 'lbs' : 'kg',
}, {
    id: 'ftp',
    format: x => H.number(x.athlete && x.athlete.ftp),
    shortName: 'FTP',
    suffix: 'w'
}];
athleteFields.forEach(x => x.group = 'athlete');


export const speedFields = [{
    id: 'spd-cur',
    format: x => fmtPace(x.state && x.state.speed, x),
    shortName: speedLabel,
    suffix: speedUnit,
}, {
    id: 'spd-smooth-60',
    longName: `Smoothed ${speedLabel()} (${shortDuration(60)})`,
    format: x => fmtPace(x.stats && x.stats.speed.smooth[60], x),
    shortName: x => `${speedLabel(x)}<small> (${shortDuration(60)})</small>`,
    suffix: speedUnit,
}, {
    id: 'spd-avg',
    format: x => fmtPace(x.stats && x.stats.speed.avg, x),
    shortName: x => `${speedLabel(x)}<small> (avg)</small>`,
    suffix: speedUnit,
}, {
    id: 'spd-lap',
    format: x => fmtPace(x.lap && x.lap.speed.avg, x),
    longName: x => `${speedLabel(x)} (lap)`,
    shortName: x => `${speedLabel(x)} <ms small>timer</ms>`,
    suffix: speedUnit,
}];
speedFields.forEach(x => x.group = 'speed');


export const hrFields = [{
    id: 'hr-cur',
    format: x => H.number(x.state && x.state.heartrate),
    shortName: 'HR',
    suffix: 'bpm',
}, {
    id: 'hr-smooth-60',
    longName: `Smoothed HR (${shortDuration(60)})`,
    format: x => H.number(x.stats && x.stats.hr.smooth[60]),
    shortName: `HR<small> (${shortDuration(60)})</small>`,
    suffix: 'bpm',
}, {
    id: 'hr-avg',
    format: x => H.number(x.stats && x.stats.hr.avg),
    shortName: 'HR<small> (avg)</small>',
    suffix: 'bpm',
}, {
    id: 'hr-lap',
    format: x => H.number(x.lap && x.lap.hr.avg),
    longName: 'HR (lap)',
    shortName: 'HR <ms small>timer</ms>',
    suffix: 'bpm',
}];
hrFields.forEach(x => x.group = 'hr');


export const powerFields = [{
    id: 'pwr-cur',
    format: x => H.number(x.state && x.state.power),
    shortName: `Power`,
    longName: `Current Power`,
    suffix: 'w',
}, {
    id: 'pwr-cur-wkg',
    format: x => fmtWkg(x.state && x.state.power, x.athlete),
    shortName: `W/kg`,
    longName: `Current W/kg`,
}, {
    id: 'pwr-avg',
    format: x => H.number(x.stats && x.stats.power.avg),
    shortName: 'Power<small> (avg)</small>',
    longName: 'Average Power',
    suffix: 'w',
}, {
    id: 'pwr-avg-wkg',
    format: x => fmtWkg(x.stats && x.stats.power.avg, x.athlete),
    shortName: 'W/kg<small> (avg)</small>',
    longName: 'Average W/kg',
},
...makeSmoothPowerFields(5),
...makeSmoothPowerFields(15),
...makeSmoothPowerFields(60),
...makeSmoothPowerFields(300),
...makeSmoothPowerFields(1200),
{
    id: 'energy',
    format: x => H.number(x.state && x.state.kj),
    shortName: 'Energy',
    suffix: 'kJ',
}, {
    id: 'energy-solo',
    longName: 'Solo Energy',
    get: x => x.stats?.soloKj || 0,
    format: H.number,
    suffix: 'kJ',
    shortName: 'Solo',
    miniName: '<ms>self_improvement</ms>',
    label: 'solo',
    tooltip: 'Energy total while riding alone',
}, {
    id: 'energy-follow',
    longName: 'Following Energy',
    get: x => x.stats?.followKj || 0,
    format: H.number,
    suffix: 'kJ',
    shortName: 'Following',
    miniName: '<ms>group_remove</ms>',
    label: 'following',
    tooltip: 'Energy total while sitting-in/following in a group',
}, {
    id: 'energy-work',
    longName: 'Working Energy',
    get: x => x.stats?.workKj || 0,
    format: H.number,
    suffix: 'kJ',
    shortName: 'Working',
    miniName: '<ms>group_add</ms>',
    label: 'working',
    tooltip: 'Energy total while working/pulling in a group',
}, {
    id: 'power-avg-solo',
    longName: 'Solo Average Power',
    get: x => (x.stats?.soloKj / x.stats?.soloTime * 1000) || 0,
    format: H.power,
    suffix: 'w',
    shortName: 'Solo',
    miniName: '<ms>self_improvement</ms>',
    label: 'solo',
    tooltip: 'Average power while riding alone',
}, {
    id: 'power-avg-follow',
    longName: 'Following Average Power',
    get: x => (x.stats?.followKj / x.stats?.followTime * 1000) || 0,
    format: H.power,
    suffix: 'w',
    shortName: 'Following',
    miniName: '<ms>group_remove</ms>',
    label: 'following',
    tooltip: 'Average power while sitting-in/following in a group',
}, {
    id: 'power-avg-work',
    longName: 'Working Average Power',
    get: x => (x.stats?.workKj / x.stats?.workTime * 1000) || 0,
    format: H.power,
    suffix: 'w',
    shortName: 'Working',
    miniName: '<ms>group_add</ms>',
    label: 'working',
    tooltip: 'Average power while working/pulling in a group',
}, {
    id: 'wbal',
    format: x => (x.wBal != null && x.athlete && x.athlete.wPrime) ?
        common.fmtBattery(x.wBal / x.athlete.wPrime) +
            H.number(x.wBal / 1000, {precision: 1}) : '-',
    shortName: 'W\'bal',
    suffix: 'kJ',
}, {
    id: 'tss',
    format: x => H.number(x.stats && x.stats.power.tss),
    shortName: 'TSS<abbr>®</abbr>',
    tooltip: tpAttr,
}, {
    id: 'pwr-np',
    format: x => H.number(x.stats && x.stats.power.np),
    shortName: 'NP<abbr>®</abbr>',
    tooltip: tpAttr,
}, {
    id: 'pwr-if',
    format: x => fmtPct((x.stats && x.stats.power.np || 0) / (x.athlete && x.athlete.ftp)),
    shortName: 'IF<abbr>®</abbr>',
    tooltip: tpAttr,
}, {
    id: 'pwr-vi',
    format: x => H.number(x.stats && x.stats.power.np / x.stats.power.avg, {precision: 2, fixed: true}),
    shortName: 'VI',
}, {
    id: 'pwr-max',
    format: x => H.number(x.stats && x.stats.power.max),
    shortName: 'Power<small> (max)</small>',
    suffix: 'w',
},
...makePeakPowerFields(5),
...makePeakPowerFields(15),
...makePeakPowerFields(60),
...makePeakPowerFields(300),
...makePeakPowerFields(1200),
{
    id: 'pwr-lap',
    format: x => H.number(x.lap && x.lap.power.avg),
    shortName: 'Power <ms small>timer</ms>',
    longName: 'Average Power (lap)',
    suffix: 'w',
}, {
    id: 'pwr-lap-wkg',
    format: x => fmtWkg(x.lap && x.lap.power.avg, x.athlete),
    shortName: 'W/kg <ms small>timer</ms>',
    longName: 'Average W/kg (lap)',
}, {
    id: 'energy-solo-lap',
    longName: 'Solo Energy (lap)',
    get: x => x.lap?.soloKj || 0,
    format: H.number,
    suffix: 'kJ',
    shortName: 'Solo <ms small>timer</ms>',
    miniName: '<ms>self_improvement</ms> <ms small>timer</ms>',
    label: ['solo', '(lap)'],
    tooltip: 'Energy total while riding alone (lap)',
}, {
    id: 'energy-follow-lap',
    longName: 'Following Energy (lap)',
    get: x => x.lap?.followKj || 0,
    format: H.number,
    suffix: 'kJ',
    shortName: 'Following <ms small>timer</ms>',
    miniName: '<ms>group_remove</ms> <ms small>timer</ms>',
    label: ['following', '(lap)'],
    tooltip: 'Energy total while sitting-in/following in a group (lap)',
}, {
    id: 'energy-work-lap',
    longName: 'Working Energy (lap)',
    get: x => x.lap?.workKj || 0,
    format: H.number,
    suffix: 'kJ',
    shortName: 'Working <ms small>timer</ms>',
    miniName: '<ms>group_add</ms> <ms small>timer</ms>',
    label: ['working', '(lap)'],
    tooltip: 'Energy total while working/pulling in a group (lap)',
}, {
    id: 'power-avg-solo-lap',
    longName: 'Solo Average Power (lap)',
    get: x => (x.lap?.soloKj / x.lap?.soloTime * 1000) || 0,
    format: H.power,
    suffix: 'w',
    shortName: 'Solo <ms small>timer</ms>',
    miniName: '<ms>self_improvement</ms> <ms small>timer</ms>',
    label: ['solo', '(lap)'],
    tooltip: 'Average power while riding alone (lap)',
}, {
    id: 'power-avg-follow-lap',
    longName: 'Following Average Power (lap)',
    get: x => (x.lap?.followKj / x.lap?.followTime * 1000) || 0,
    format: H.power,
    suffix: 'w',
    shortName: 'Following <ms small>timer</ms>',
    miniName: '<ms>group_remove</ms> <ms small>timer</ms>',
    label: ['following', '(lap)'],
    tooltip: 'Average power while sitting-in/following in a group (lap)',
}, {
    id: 'power-avg-work-lap',
    longName: 'Working Average Power (lap)',
    get: x => (x.lap?.workKj / x.lap?.workTime * 1000) || 0,
    format: H.power,
    suffix: 'w',
    shortName: 'Working <ms small>timer</ms>',
    miniName: '<ms>group_add</ms> <ms small>timer</ms>',
    label: ['working', '(lap)'],
    tooltip: 'Average power while working/pulling in a group (lap)',
},
...makePeakPowerFields(5, -1),
...makePeakPowerFields(15, -1),
...makePeakPowerFields(60, -1),
...makePeakPowerFields(300, -1),
...makePeakPowerFields(1200, -1)
];
powerFields.forEach(x => x.group = 'power');


export const draftFields = [{
    id: 'draft-cur',
    format: x => H.power(x.state && x.state.draft),
    shortName: 'Draft',
    suffix: x => H.power(x && x.state && x.state.draft, {suffixOnly: true}),
}, {
    id: 'draft-avg',
    format: x => H.power(x.stats && x.stats.draft.avg),
    shortName: 'Draft<small> (avg)</small>',
    suffix: x => H.power(x && x.stats && x.stats.draft.avg, {suffixOnly: true}),
}, {
    id: 'draft-lap',
    format: x => H.power(x.lap && x.lap.draft.avg),
    shortName: 'Draft <ms small>timer</ms>',
    suffix: x => H.power(x && x.lap && x.lap.draft.avg, {suffixOnly: true}),
}, {
    id: 'draft-energy',
    format: x => H.number(x.state && x.stats?.draft?.kj),
    shortName: 'Draft<small> (energy)</small>',
    suffix: 'kJ',
}];
draftFields.forEach(x => x.group = 'draft');


export const cadenceFields = [{
    id: 'cad-cur',
    format: x => H.number(x.state && x.state.cadence),
    shortName: 'Cadence',
    suffix: x => getSport(x) === 'running' ? 'spm' : 'rpm',
}, {
    id: 'cad-avg',
    format: x => H.number(x.stats && x.stats.cadence.avg),
    shortName: 'Cadence<small> (avg)</small>',
    suffix: x => getSport(x) === 'running' ? 'spm' : 'rpm',
}, {
    id: 'cad-lap',
    format: x => H.number(x.lap && x.lap.cadence.avg),
    shortName: 'Cadence <ms small>timer</ms>',
    suffix: x => getSport(x) === 'running' ? 'spm' : 'rpm',
}];
cadenceFields.forEach(x => x.group = 'cadence');


export const courseFields = [{
    id: 'ev-place',
    format: x => x.eventPosition ?
        `${H.place(x.eventPosition, {suffix: true, html: true})}<small> / ${x.eventParticipants}</small>` :
        '-',
    shortName: 'Place',
}, {
    id: 'ev-fin',
    format: x => x.remainingMetric === 'distance' ?
        H.distance(Math.max(0, x.remaining)) :
        x.remainingMetric === 'time' ?
            fmtDur(x.remaining) :
            '-',
    tooltip: 'Remaining Event or Route time/distance',
    longName: 'Event/Route Finish',
    shortName: 'Finish',
    suffix: x => (x && x.remainingMetric) === 'distance' ?
        H.distance(x.remaining, {suffixOnly: true}) : '',
}, {
    id: 'ev-dst', // legacy id, is essentially ev-progress now
    format: x => x.state ?
        x.remainingMetric === 'distance' ?
            `${H.distance(x.remainingEnd - x.remaining, {suffix: true, html: true})}<small> / ` +
                `${H.distance(x.remainingEnd, {suffix: true, html: true})}</small>` :
            x.remainingMetric === 'time' ?
                `${fmtDur(x.remainingEnd - x.remaining)}<small> / ${fmtDur(x.remainingEnd)}</small>` :
                H.distance(x.state.eventDistance, {suffix: true, html: true}) :
        '-',
    tooltip: 'Event, Route or Session progress',
    longName: x => x?.remainingType === 'event' ?
        'Event Progress' :
        x?.remainingType === 'route' ?
            'Route Progress' :
            x ?
                'Progress' :
                'Event/Route Progress',
    shortName: x => x?.remainingType === 'event' ?
        'Event <ms>sports_score</ms>' :
        x?.remainingType === 'route' ?
            'Route <ms>sports_score</ms>' :
            x ?
                'Dist' :
                '<ms>sports_score</ms>'
}, {
    id: 'dst',
    format: x => H.distance(x.state && x.state.distance),
    shortName: 'Dist',
    suffix: x => H.distance(x && x.state && x.state.distance, {suffixOnly: true}),
}, {
    id: 'game-laps',
    format: x => fmtLap(x.state && x.state.laps + 1),
    tooltip: 'Zwift route lap number',
    shortName: 'Lap<small> (zwift)</small>',
}, {
    id: 'sauce-laps',
    format: x => fmtLap(x.lapCount),
    tooltip: 'Sauce stats lap number',
    shortName: 'Lap<small> (sauce)</small>',
}, {
    id: 'progress',
    format: x => fmtPct(x.state && x.state.progress || 0),
    shortName: 'Progress',
},{
    id: 'ev-name',
    format: x => {
        const sg = common.getEventSubgroup(x.state?.eventSubgroupId);
        return (sg && !(sg instanceof Promise) && sg.name) ? `${sg.name} <ms>event</ms>` : '-';
    },
    shortName: x => (x?.state?.eventSubgroupId) ? '' : 'Event',
    tooltip: 'Event',
}, {
    id: 'rt-name',
    format: x => {
        const sg = common.getEventSubgroup(x.state?.eventSubgroupId);
        const routeId = sg?.routeId || x.state?.routeId;
        const route = routeId && common.getRoute(routeId);
        if (route && !(route instanceof Promise)) {
            const icon = ' <ms>route</ms>';
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
    id: 'el-gain',
    format: x => H.elevation(x.state && x.state.climbing),
    shortName: 'Climbed',
    suffix: x => H.elevation(x && x.state && x.state.climbing, {suffixOnly: true}),
}, {
    id: 'el-altitude',
    format: x => H.elevation(x.state && x.state.altitude),
    longName: 'Altitude',
    shortName: 'Alt',
    suffix: x => H.elevation(x && x.state && x.state.altitude, {suffixOnly: true}),
}, {
    id: 'grade',
    get: x => x.state?.grade,
    format: x => fmtPct(x, {precision: 1, fixed: true, html: true}),
    longName: 'Grade',
    shortName: '',
    suffix: x => x.state?.grade < 0 ? '<ms>downhill_skiing</ms>' : '<ms>altitude</ms>',
    tooltip: 'Grade of terrain in percent of rise'
}];
courseFields.forEach(x => x.group = 'course');


export const fields = [].concat(
    timeFields,
    powerFields,
    athleteFields,
    speedFields,
    draftFields,
    cadenceFields,
    hrFields,
    courseFields,
);
