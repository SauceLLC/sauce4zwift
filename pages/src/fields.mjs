import * as locale from '../../shared/sauce/locale.mjs';
import * as common from './common.mjs';

const H = locale.human;
let eventMetric;
let sport = 'cycling';


function unit(x) {
    return `<abbr class="unit">${x}</abbr>`;
}


export function setSport(s) {
    sport = s;
}


export function setEventMetric(m) {
    eventMetric = m;
}


export function isRealNumber(v) {
    return !(v == null || v === Infinity || v === -Infinity || isNaN(v));
}


export function fmtPace(x) {
    return H.pace(x, {sport, precision: 1});
}


export function speedUnit() {
    return sport === 'running' ? locale.isImperial() ? '/mi' : '/km' : locale.isImperial() ? 'mph' : 'kph';
}


export function speedLabel() {
    return sport === 'running' ? 'Pace' : 'Speed';
}


export function shortDuration(x) {
    return H.duration(x, {short: true});
}


export function fmtDist(v) {
    if (!isRealNumber(v)) {
        return '-';
    } else if (Math.abs(v) < 1000) {
        const suffix = unit(locale.isImperial() ? 'ft' : 'm');
        return H.number(locale.isImperial() ? v / locale.metersPerFoot : v) + suffix;
    } else {
        return H.distance(v, {precision: 1, suffix: true, html: true});
    }
}


export function fmtElevation(v) {
    if (!isRealNumber(v)) {
        return '-';
    }
    const suffix = unit(locale.isImperial() ? 'ft' : 'm');
    return H.number(locale.isImperial() ? v / locale.metersPerFoot : v) + suffix;
}


export function fmtDur(v) {
    if (!isRealNumber(v)) {
        return '-';
    }
    return H.timer(v, {long: true});
}


export function fmtWkg(p, athlete) {
    if (!isRealNumber(p) || !athlete || !athlete.ftp) {
        return '-';
    }
    return H.number(p / athlete.weight, {precision: 1, fixed: true});
}


export function fmtPct(p, options={}) {
    if (!isRealNumber(p)) {
        return '-';
    }
    return H.number(p * 100, options) + unit('%');
}

export function fmtLap(v) {
    if (!isRealNumber(v)) {
        return '-';
    }
    return H.number(v + 1);
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


function getEventSubgroupProperty(id, prop) {
    const sg = getEventSubgroup(id);
    return sg && sg[prop];
}


export const fields = [{
    id: 'time-elapsed',
    value: x => fmtDur(x.stats && x.stats.elapsedTime || 0),
    key: 'Elapsed',
}, {
    id: 'time-session',
    value: x => fmtDur(x.state && x.state.time || 0),
    key: 'Time',
}, {
    id: 'time-lap',
    value: x => fmtDur((x.lap || x.stats) && (x.lap || x.stats).elapsedTime || 0),
    key: 'Time <small>(lap)</small>',
}, {
    id: 'clock',
    value: x => new Date().toLocaleTimeString(),
    key: '',
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
    value: x => (x.stats && x.stats.power.wBal != null && x.athlete && x.athlete.wPrime) ?
        common.fmtBattery(x.stats.power.wBal / x.athlete.wPrime) +
            H.number(x.stats.power.wBal / 1000, {precision: 1}) : '-',
    key: 'W\'bal',
    unit: 'kJ',
}, {
    id: 'tss',
    value: x => H.number(x.stats && x.stats.power.tss),
    key: 'TSS',
}, {
    id: 'weight',
    value: x => H.weightClass(x.athlete && x.athlete.weight),
    key: 'Weight',
    unit: () => locale.isImperial() ? 'lbs' : 'kg',
}, {
    id: 'ftp',
    value: x => H.number(x.athlete && x.athlete.ftp),
    key: 'FTP',
    unit: 'w'
}, {
    id: 'spd-cur',
    value: x => fmtPace(x.state && x.state.speed),
    key: speedLabel,
    unit: speedUnit,
}, {
    id: 'spd-smooth-60',
    value: x => fmtPace(x.stats && x.stats.speed.smooth[60]),
    key: () => `${speedLabel()} <small>(${shortDuration(60)})</small>`,
    unit: speedUnit,
}, {
    id: 'spd-avg',
    value: x => fmtPace(x.stats && x.stats.speed.avg),
    key: () => `${speedLabel()} <small>(avg)</small>`,
    unit: speedUnit,
}, {
    id: 'spd-lap',
    value: x => fmtPace(x.lap && x.lap.speed.avg),
    key: () => `${speedLabel()} <small>(lap)</small>`,
    unit: speedUnit,
}, {
    id: 'hr-cur',
    value: x => H.number(x.state && x.state.heartrate),
    key: 'HR',
    unit: 'bpm',
}, {
    id: 'hr-smooth-60',
    value: x => H.number(x.stats && x.stats.hr.smooth[60]),
    key: `HR <small>(${shortDuration(60)})</small>`,
    unit: 'bpm',
}, {
    id: 'hr-avg',
    value: x => H.number(x.stats && x.stats.hr.avg),
    key: 'HR <small>(avg)</small>',
    unit: 'bpm',
}, {
    id: 'hr-lap',
    value: x => H.number(x.lap && x.lap.hr.avg),
    key: 'HR <small>(lap)</small>',
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
    key: `Power <small>(${shortDuration(5)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-smooth-5-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.smooth[5], x.athlete),
    key: `W/kg <small>(${shortDuration(5)})</small>`,
}, {
    id: 'pwr-smooth-15',
    value: x => H.number(x.stats && x.stats.power.smooth[15]),
    key: `Power <small>(${shortDuration(15)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-smooth-15-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.smooth[15], x.athlete),
    key: `W/kg <small>(${shortDuration(15)})</small>`,
}, {
    id: 'pwr-smooth-60',
    value: x => H.number(x.stats && x.stats.power.smooth[60]),
    key: `Power <small>(${shortDuration(60)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-smooth-60-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.smooth[60], x.athlete),
    key: `W/kg <small>(${shortDuration(60)})</small>`,
}, {
    id: 'pwr-smooth-300',
    value: x => H.number(x.stats && x.stats.power.smooth[300]),
    key: `Power <small>(${shortDuration(300)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-smooth-300-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.smooth[300], x.athlete),
    key: `W/kg <small>(${shortDuration(300)})</small>`,
}, {
    id: 'pwr-smooth-1200',
    value: x => H.number(x.stats && x.stats.power.smooth[1200]),
    key: `Power <small>(${shortDuration(1200)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-smooth-1200-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.smooth[1200], x.athlete),
    key: `W/kg <small>(${shortDuration(1200)})</small>`,
}, {
    id: 'pwr-peak-5',
    value: x => H.number(x.stats && x.stats.power.peaks[5].avg),
    key: `Peak Power <small>(${shortDuration(5)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-peak-5-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.peaks[5].avg, x.athlete),
    key: `Peak W/kg <small>(${shortDuration(5)})</small>`,
}, {
    id: 'pwr-peak-15',
    value: x => H.number(x.stats && x.stats.power.peaks[15].avg),
    key: `Peak Power <small>(${shortDuration(15)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-peak-15-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.peaks[15].avg, x.athlete),
    key: `Peak W/kg <small>(${shortDuration(15)})</small>`,
}, {
    id: 'pwr-peak-60',
    value: x => H.number(x.stats && x.stats.power.peaks[60].avg),
    key: `Peak Power <small>(${shortDuration(60)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-peak-60-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.peaks[60].avg, x.athlete),
    key: `Peak W/kg <small>(${shortDuration(60)})</small>`,
}, {
    id: 'pwr-peak-300',
    value: x => H.number(x.stats && x.stats.power.peaks[300].avg),
    key: `Peak Power <small>(${shortDuration(300)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-peak-300-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.peaks[300].avg, x.athlete),
    key: `Peak W/kg <small>(${shortDuration(300)})</small>`,
}, {
    id: 'pwr-peak-1200',
    value: x => H.number(x.stats && x.stats.power.peaks[1200].avg),
    key: `Peak Power <small>(${shortDuration(1200)})</small>`,
    unit: 'w',
}, {
    id: 'pwr-peak-1200-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.peaks[1200].avg, x.athlete),
    key: `Peak W/kg <small>(${shortDuration(1200)})</small>`,
}, {
    id: 'pwr-avg',
    value: x => H.number(x.stats && x.stats.power.avg),
    key: 'Power <small>(avg)</small>',
    unit: 'w',
}, {
    id: 'pwr-avg-wkg',
    value: x => fmtWkg(x.stats && x.stats.power.avg, x.athlete),
    key: 'W/kg <small>(avg)</small>',
}, {
    id: 'pwr-lap',
    value: x => H.number(x.lap && x.lap.power.avg),
    key: 'Power <small>(lap)</small>',
    unit: 'w',
}, {
    id: 'pwr-lap-wkg',
    value: x => fmtWkg(x.lap && x.lap.power.avg, x.athlete),
    key: 'W/kg <small>(lap)</small>',
}, {
    id: 'pwr-np',
    value: x => H.number(x.stats && x.stats.power.np),
    key: 'NP',
}, {
    id: 'pwr-if',
    value: x => fmtPct((x.stats && x.stats.power.np || 0) / (x.athlete && x.athlete.ftp)),
    key: 'IF',
}, {
    id: 'pwr-vi',
    value: x => H.number(x.stats && x.stats.power.np / x.stats.power.avg, {precision: 2, fixed: true}),
    key: 'VI',
}, {
    id: 'pwr-max',
    value: x => H.number(x.stats && x.stats.power.max),
    key: 'Power <small>(max)</small>',
    unit: 'w',
}, {
    id: 'draft-cur',
    value: x => fmtPct(x.state && x.state.draft / 100),
    key: 'Draft',
}, {
    id: 'draft-avg',
    value: x => fmtPct(x.stats && x.stats.draft.avg / 100),
    key: 'Draft <small>(avg)</small>',
}, {
    id: 'draft-lap',
    value: x => fmtPct(x.lap && x.lap.draft.avg / 100),
    key: 'Draft <small>(lap)</small>',
}, {
    id: 'cad-cur',
    value: x => H.number(x.state && x.state.cadence),
    key: 'Cadence',
    unit: () => sport === 'running' ? 'spm' : 'rpm',
}, {
    id: 'cad-avg',
    value: x => H.number(x.stats && x.stats.cadence.avg),
    key: 'Cadence <small>(avg)</small>',
    unit: () => sport === 'running' ? 'spm' : 'rpm',
}, {
    id: 'cad-lap',
    value: x => H.number(x.lap && x.lap.cadence.avg),
    key: 'Cadence <small>(lap)</small>',
    unit: () => sport === 'running' ? 'spm' : 'rpm',
}, {
    id: 'ev-place',
    value: x => x.eventPosition ? `${H.place(x.eventPosition, {html: true})}/<small>${x.eventParticipants}</small>`: '-',
    key: 'Place',
}, {
    id: 'ev-fin',
    value: x => eventMetric ? eventMetric === 'distance' ? fmtDist(x.remaining) : fmtDur(x.remaining) : '-',
    key: 'Finish',
}, {
    id: 'ev-dst',
    tooltip: () => 'far spray',
    value: x => x.state ? (eventMetric === 'distance' ?
        `${fmtDist(x.state.eventDistance)}/${fmtDist(x.state.eventDistance + x.remaining)}` :
        fmtDist(x.state.eventDistance)) : '-',
    key: () => eventMetric ? 'Dist <small>(event)</small>' : 'Dist <small>(session)</small>',
}, {
    id: 'dst',
    value: x => fmtDist(x.state && x.state.distance),
    key: 'Dist',
}, {
    id: 'game-laps',
    value: x => fmtLap(x.state && x.state.laps || null),
    tooltip: 'Zwift route lap number',
    key: 'Lap <small>(zwift)</small>',
}, {
    id: 'sauce-laps',
    value: x => fmtLap(x.lapCount - 1),
    tooltip: 'Sauce stats lap number',
    key: 'Lap <small>(sauce)</small>',
}, {
    id: 'progress',
    value: x => fmtPct(x.state && x.state.progress || 0),
    key: 'Route',
},{
    id: 'ev-name',
    value: x => getEventSubgroupProperty(x.state.eventSubgroupId, 'name') || '-',
    key: x => (x && x.state && x.state.eventSubgroupId) ? '' : 'Event',
}, {
    id: 'rt-name',
    value: x => {
        const sg = getEventSubgroup(x.state.eventSubgroupId, 'laps');
        return sg ? ((sg.laps && sg.laps > 1) ? `${sg.laps} x ` : '') + sg.route.name : '-';
    },
    key: x => (x && x.state && x.state.eventSubgroupId) ? '' : 'Route',
}, {
    id: 'el-gain',
    value: x => fmtElevation(x.state && x.state.climbing),
    key: 'Climbed',
}, {
    id: 'el-altitude',
    value: x => fmtElevation(x.state && x.state.altitude),
    key: 'Altitude',
}, {
    id: 'grade',
    value: x => fmtPct(x.state && x.state.grade, {precision: 1, fixed: true}),
    key: 'Grade',
}];
