import * as locale from '../../shared/sauce/locale.mjs';
import * as common from './common.mjs';

const H = locale.human;


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


const tpAttr = common.stripHTML(common.attributions.tp);


export const fields = [{
    id: 'time-active',
    longName: 'Active Time',
    value: x => fmtDur(x.stats && x.stats.activeTime || 0),
    key: 'Active',
    tooltip: 'Sauce based active time',
}, {
    id: 'time-elapsed',
    longName: 'Elapsed Time',
    value: x => fmtDur(x.stats && x.stats.elapsedTime || 0),
    key: 'Elapsed',
    tooltip: 'Sauce based elapsed time',
}, {
    id: 'time-session',
    longName: 'Session Time',
    value: x => fmtDur(x.state && x.state.time || 0),
    key: 'Time',
    tooltip: 'Time as reported by the current Zwift session',
}, {
    id: 'time-lap',
    value: x => fmtDur((x.lap || x.stats) && (x.lap || x.stats).activeTime || 0),
    key: 'Time<small>(lap)</small>',
}, {
    id: 'clock',
    longName: 'Clock',
    value: x => new Date().toLocaleTimeString(),
    key: '',
}, {
    id: 'fullname',
    value: x => x.athlete && x.athlete.sanitizedFullname || '-',
    key: x => (x && x.athlete) ? '' : 'Athlete Name',
}, {
    id: 'flastname',
    value: x => x.athlete && x.athlete.fLast || '-',
    key: x => (x && x.athlete) ? '' : 'Athlete F.Last',
}, {
    id: 'team',
    value: x => x.athlete && common.teamBadge(x.athlete.team) || '-',
    key: x => (x && x.athlete && x.athlete.team) ? '' : 'Team',
}, {
    id: 'level',
    value: x => H.number(x.athlete && x.athlete.level),
    key: 'Level',
}, {
    id: 'rideons',
    value: x => H.number(x.state && x.state.rideons),
    key: 'Ride Ons',
}, {
    id: 'energy',
    value: x => H.number(x.state && x.state.kj),
    key: 'Energy',
    unit: 'kJ',
}, {
    id: 'wbal',
    value: x => (x.wBal != null && x.athlete && x.athlete.wPrime) ?
        common.fmtBattery(x.wBal / x.athlete.wPrime) +
            H.number(x.wBal / 1000, {precision: 1}) : '-',
    key: 'W\'bal',
    unit: 'kJ',
}, {
    id: 'tss',
    value: x => H.number(x.stats && x.stats.power.tss),
    key: 'TSS<abbr>®</abbr>',
    tooltip: tpAttr,
}, {
    id: 'weight',
    value: x => H.weightClass(x.athlete && x.athlete.weight, {html: true}),
    key: 'Weight',
    unit: () => locale.isImperial() ? 'lbs' : 'kg',
}, {
    id: 'ftp',
    value: x => H.number(x.athlete && x.athlete.ftp),
    key: 'FTP',
    unit: 'w'
}, {
    id: 'spd-cur',
    value: x => fmtPace(x.state && x.state.speed, x),
    key: speedLabel,
    unit: speedUnit,
}, {
    id: 'spd-smooth-60',
    value: x => fmtPace(x.stats && x.stats.speed.smooth[60], x),
    key: x => `${speedLabel(x)}<small>(${shortDuration(60)})</small>`,
    unit: speedUnit,
}, {
    id: 'spd-avg',
    value: x => fmtPace(x.stats && x.stats.speed.avg, x),
    key: x => `${speedLabel(x)}<small>(avg)</small>`,
    unit: speedUnit,
}, {
    id: 'spd-lap',
    value: x => fmtPace(x.lap && x.lap.speed.avg, x),
    key: x => `${speedLabel(x)}<small>(lap)</small>`,
    unit: speedUnit,
}, {
    id: 'hr-cur',
    value: x => H.number(x.state && x.state.heartrate),
    key: 'HR',
    unit: 'bpm',
}, {
    id: 'hr-smooth-60',
    value: x => H.number(x.stats && x.stats.hr.smooth[60]),
    key: `HR<small>(${shortDuration(60)})</small>`,
    unit: 'bpm',
}, {
    id: 'hr-avg',
    value: x => H.number(x.stats && x.stats.hr.avg),
    key: 'HR<small>(avg)</small>',
    unit: 'bpm',
}, {
    id: 'hr-lap',
    value: x => H.number(x.lap && x.lap.hr.avg),
    key: 'HR<small>(lap)</small>',
    unit: 'bpm',
}, {
    id: 'pwr-cur',
    value: x => H.number(x.state && x.state.power),
    key: `Power`,
    unit: 'w',
}, {
    id: 'pwr-cur-wkg',
    value: x => fmtWkg(x.state && x.state.power, x.athlete),
    key: `W/kg`,
}, {
    id: 'pwr-smooth-5',
    value: x => H.number(x.stats && x.stats.power.smooth[5]),
    key: `Power<small>(${shortDuration(5)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-smooth-5-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.smooth[5], x.athlete),
    key: `W/kg<small>(${shortDuration(5)})</small>`,
}, {
    id: 'pwr-smooth-15',
    value: x => H.number(x.stats && x.stats.power.smooth[15]),
    key: `Power<small>(${shortDuration(15)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-smooth-15-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.smooth[15], x.athlete),
    key: `W/kg<small>(${shortDuration(15)})</small>`,
}, {
    id: 'pwr-smooth-60',
    value: x => H.number(x.stats && x.stats.power.smooth[60]),
    key: `Power<small>(${shortDuration(60)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-smooth-60-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.smooth[60], x.athlete),
    key: `W/kg<small>(${shortDuration(60)})</small>`,
}, {
    id: 'pwr-smooth-300',
    value: x => H.number(x.stats && x.stats.power.smooth[300]),
    key: `Power<small>(${shortDuration(300)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-smooth-300-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.smooth[300], x.athlete),
    key: `W/kg<small>(${shortDuration(300)})</small>`,
}, {
    id: 'pwr-smooth-1200',
    value: x => H.number(x.stats && x.stats.power.smooth[1200]),
    key: `Power<small>(${shortDuration(1200)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-smooth-1200-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.smooth[1200], x.athlete),
    key: `W/kg<small>(${shortDuration(1200)})</small>`,
}, {
    id: 'pwr-peak-5',
    value: x => H.number(x.stats && x.stats.power.peaks[5].avg),
    key: `Peak Power<small>(${shortDuration(5)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-peak-5-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.peaks[5].avg, x.athlete),
    key: `Peak W/kg<small>(${shortDuration(5)})</small>`,
}, {
    id: 'pwr-peak-15',
    value: x => H.number(x.stats && x.stats.power.peaks[15].avg),
    key: `Peak Power<small>(${shortDuration(15)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-peak-15-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.peaks[15].avg, x.athlete),
    key: `Peak W/kg<small>(${shortDuration(15)})</small>`,
}, {
    id: 'pwr-peak-60',
    value: x => H.number(x.stats && x.stats.power.peaks[60].avg),
    key: `Peak Power<small>(${shortDuration(60)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-peak-60-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.peaks[60].avg, x.athlete),
    key: `Peak W/kg<small>(${shortDuration(60)})</small>`,
}, {
    id: 'pwr-peak-300',
    value: x => H.number(x.stats && x.stats.power.peaks[300].avg),
    key: `Peak Power<small>(${shortDuration(300)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-peak-300-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.peaks[300].avg, x.athlete),
    key: `Peak W/kg<small>(${shortDuration(300)})</small>`,
}, {
    id: 'pwr-peak-1200',
    value: x => H.number(x.stats && x.stats.power.peaks[1200].avg),
    key: `Peak Power<small>(${shortDuration(1200)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-peak-1200-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.peaks[1200].avg, x.athlete),
    key: `Peak W/kg<small>(${shortDuration(1200)})</small>`,
}, {
    id: 'pwr-avg',
    value: x => H.number(x.stats && x.stats.power.avg),
    key: 'Power<small>(avg)</small>',
    unit: 'w',
}, {
    id: 'pwr-avg-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.avg, x.athlete),
    key: 'W/kg<small>(avg)</small>',
}, {
    id: 'pwr-lap',
    value: x => H.number(x.lap && x.lap.power.avg),
    key: 'Power<small>(lap)</small>',
    unit: 'w',
}, {
    id: 'pwr-lap-wkg',
    value: x => fmtWkg(x.lap && x.lap.power.avg, x.athlete),
    key: 'W/kg<small>(lap)</small>',
}, {
    id: 'pwr-np',
    value: x => H.number(x.stats && x.stats.power.np),
    key: 'NP<abbr>®</abbr>',
    tooltip: tpAttr,
}, {
    id: 'pwr-if',
    value: x => fmtPct((x.stats && x.stats.power.np || 0) / (x.athlete && x.athlete.ftp)),
    key: 'IF<abbr>®</abbr>',
    tooltip: tpAttr,
}, {
    id: 'pwr-vi',
    value: x => H.number(x.stats && x.stats.power.np / x.stats.power.avg, {precision: 2, fixed: true}),
    key: 'VI',
}, {
    id: 'pwr-max',
    value: x => H.number(x.stats && x.stats.power.max),
    key: 'Power<small>(max)</small>',
    unit: 'w',
}, {
    id: 'draft-cur',
    value: x => H.power(x.state && x.state.draft),
    key: 'Draft',
    unit: x => H.power(x && x.state && x.state.draft, {suffixOnly: true}),
}, {
    id: 'draft-avg',
    value: x => H.power(x.stats && x.stats.draft.avg),
    key: 'Draft<small>(avg)</small>',
    unit: x => H.power(x && x.stats && x.stats.draft.avg, {suffixOnly: true}),
}, {
    id: 'draft-lap',
    value: x => H.power(x.lap && x.lap.draft.avg),
    key: 'Draft<small>(lap)</small>',
    unit: x => H.power(x && x.lap && x.lap.draft.avg, {suffixOnly: true}),
}, {
    id: 'draft-energy',
    value: x => H.number(x.state && x.stats?.draft?.kj),
    key: 'Draft<small>(energy)</small>',
    unit: 'kJ',
}, {
    id: 'cad-cur',
    value: x => H.number(x.state && x.state.cadence),
    key: 'Cadence',
    unit: x => getSport(x) === 'running' ? 'spm' : 'rpm',
}, {
    id: 'cad-avg',
    value: x => H.number(x.stats && x.stats.cadence.avg),
    key: 'Cadence<small>(avg)</small>',
    unit: x => getSport(x) === 'running' ? 'spm' : 'rpm',
}, {
    id: 'cad-lap',
    value: x => H.number(x.lap && x.lap.cadence.avg),
    key: 'Cadence<small>(lap)</small>',
    unit: x => getSport(x) === 'running' ? 'spm' : 'rpm',
}, {
    id: 'ev-place',
    value: x => x.eventPosition ?
        `${H.place(x.eventPosition, {suffix: true, html: true})}<small> / ${x.eventParticipants}</small>` :
        '-',
    key: 'Place',
}, {
    id: 'ev-fin',
    value: x => x.remainingMetric ? x.remainingMetric === 'distance' ?
        H.distance(x.remaining) : fmtDur(x.remaining) : '-',
    key: 'Finish',
    unit: x => (x && x.remainingMetric) === 'distance' ?
        H.distance(x.remaining, {suffixOnly: true}) : '',
}, {
    id: 'ev-dst',
    value: x => x.state ? (x.remainingMetric === 'distance' ?
        `${H.distance(x.state.eventDistance, {suffix: true, html: true})}<small> / ` +
        `${H.distance(x.state.eventDistance + x.remaining, {suffix: true, html: true})}</small>` :
        H.distance(x.state.eventDistance, {suffix: true, html: true})) : '-',
    key: x => (x && x.remainingMetric === 'distance') ?
        'Dist<small>(event)</small>' : 'Dist<small>(session)</small>',
}, {
    id: 'dst',
    value: x => H.distance(x.state && x.state.distance),
    key: 'Dist',
    unit: x => H.distance(x && x.state && x.state.distance, {suffixOnly: true}),
}, {
    id: 'game-laps',
    value: x => fmtLap(x.state && x.state.laps + 1),
    tooltip: 'Zwift route lap number',
    key: 'Lap<small>(zwift)</small>',
}, {
    id: 'sauce-laps',
    value: x => fmtLap(x.lapCount),
    tooltip: 'Sauce stats lap number',
    key: 'Lap<small>(sauce)</small>',
}, {
    id: 'progress',
    value: x => fmtPct(x.state && x.state.progress || 0),
    key: 'Progress',
},{
    id: 'ev-name',
    value: x => {
        const name = getEventSubgroupProperty(x.state?.eventSubgroupId, 'name');
        return name ? `${name} <ms>event</ms>` : '-';
    },
    key: x => (x?.state?.eventSubgroupId) ? '' : 'Event',
    tooltip: 'Event',
}, {
    id: 'rt-name',
    value: x => {
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
    key: x => (x?.state?.eventSubgroupId || x?.state?.routeId) ? '' : 'Route',
    tooltip: 'Route',
}, {
    id: 'el-gain',
    value: x => H.elevation(x.state && x.state.climbing),
    key: 'Climbed',
    unit: x => H.elevation(x && x.state && x.state.climbing, {suffixOnly: true}),
}, {
    id: 'el-altitude',
    value: x => H.elevation(x.state && x.state.altitude),
    key: 'Altitude',
    unit: x => H.elevation(x && x.state && x.state.altitude, {suffixOnly: true}),
}, {
    id: 'grade',
    value: x => fmtPct(x.state && x.state.grade, {precision: 1, fixed: true}),
    key: 'Grade',
}];
