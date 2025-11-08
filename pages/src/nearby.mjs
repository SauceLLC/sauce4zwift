import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as fieldsMod from './fields.mjs';

common.enableSentry();

const doc = document.documentElement;
const L = sauce.locale;
const H = L.human;
const fieldsKey = 'nearby-fields-v2';
let eventSite = common.storage.get('/externalEventSite', 'zwift');
let fieldStates;
let nearbyData;
let enFields;
let sortBy;
let sortByDir;
let table;
let tbody;
let theadRow;
let gameConnection;
let filters = [];
const filtersRaw = common.settingsStore.get('filtersRaw');

common.settingsStore.setDefault({
    autoscroll: true,
    refreshInterval: 2,
    overlayMode: false,
    fontScale: 1,
    solidBackground: false,
    backgroundColor: '#00ff00',
    hideHeader: false,
});

const legacySort = common.storage.get('nearby-sort-by');
if (legacySort !== undefined) {
    common.storage.delete('nearby-sort-by');
    common.storage.set('nearby-sort-by-v2', legacySort);
    if (legacySort === 'gap' || legacySort === 'gap-distance') {
        common.storage.set('nearby-sort-dir', common.storage.get('nearby-sort-dir') > 0 ? -1 : 1);
    }
}

const settings = common.settingsStore.get();
const spd = (v, entry) => H.pace(v, {precision: 0, suffix: true, html: true, sport: entry.state.sport});
const weightClass = v => H.weightClass(v, {suffix: true, html: true});
const pwr = v => H.power(v, {suffix: true, html: true});
const hr = v => H.number(v || null, {suffix: 'bpm', html: true});
const kj = (v, options) => H.number(v, {suffix: 'kJ', html: true, ...options});
const pct = (v, options) => H.number(v * 100, {suffix: '%', html: true, ...options});
const gapTime = (v, entry) => H.timer(v) + (entry.isGapEst ? '<small> (est)</small>' : '');


function fGet(fnOrValue, ...args) {
    return (typeof fnOrValue === 'function') ? fnOrValue(...args) : fnOrValue;
}


// Convert a field spec from the fields.mjs module to one compatible with the table..
function convertGenericField(id, overrides) {
    const field = fieldsMod.fields.find(x => x.id === id);
    if (!field) {
        console.error('Field id not found:', id);
        return;
    }
    return {
        id: field.id,
        label: field.longName ?? field.shortName,
        headerLabel: field.miniName ?? field.shortName ?? field.label ?? field.longName,
        get: field.get,
        fmt: field.suffix != null ?
            x => fGet(field.format, x) + `<abbr class="unit">${fGet(field.suffix, x)}</abbr>` :
            x => fGet(field.format, x), // clip args for compat with generic field's suffix 2nd arg
        tooltip: field.tooltip,
        ...overrides,
    };
}


function getSubgroupLazy(id) {
    const sg = common.getEventSubgroup(id);
    if (sg && !(sg instanceof Promise)) {
        return sg;
    }
}


function getRouteLazy(id) {
    const route = common.getRoute(id);
    if (route && !(route instanceof Promise)) {
        return route;
    }
}


function fmtDist(v) {
    return H.distance(v, {suffix: true, html: true});
}


function fmtElevation(v) {
    return H.elevation(v, {suffix: true, html: true});
}


function fmtDur(v) {
    if (v == null || v === Infinity || v === -Infinity || isNaN(v)) {
        return '-';
    }
    return H.timer(v, {long: true, html: true});
}


function fmtWkg(v) {
    if (v == null) {
        return '-';
    }
    return H.number(v, {precision: 1, fixed: true, suffix: 'w/kg', html: true});
}


function fmtName(name, entry) {
    let badge;
    const sgid = entry.state.eventSubgroupId;
    if (sgid) {
        const sg = getSubgroupLazy(sgid);
        if (sg) {
            badge = common.eventBadge(sg.subgroupLabel);
        }
    }
    return athleteLink(entry.athleteId, (badge || '') + common.sanitize(name || '-'));
}


function fmtEvent(sgid) {
    if (!sgid) {
        return '-';
    }
    const sg = getSubgroupLazy(sgid);
    if (sg) {
        return `<a href="${eventUrl(sg.eventId)}" target="_blank" external>${sg.name}</a>`;
    }
    return '...';
}


function getRoute({state, routeId}) {
    let route;
    let laps;
    if (state.eventSubgroupId) {
        const sg = getSubgroupLazy(state.eventSubgroupId);
        if (sg) {
            route = getRouteLazy(sg.routeId);
            laps = sg.laps;
        }
    } else if (state.routeId) {
        route = getRouteLazy(state.routeId);
        laps = 0;
    }
    return !route ? undefined : laps ? `${laps} x ${route.name}` : route.name;
}


function eventUrl(id) {
    const urls = {
        zwift: `https://www.zwift.com/events/view/${id}`,
        zwiftpower: `https://zwiftpower.com/events.php?zid=${id}`,
    };
    return urls[eventSite] || urls.zwift;
}


function clearSelection() {
    window.getSelection().empty();
}


function athleteLink(id, content, options={}) {
    const debug = window.location.search.includes('debug') ? '&debug' : '';
    return `<a title="${options.title || ''}" class="athlete-link ${options.class || ''}"
               href="profile.html?id=${id}&windowType=profile${debug}"
               target="profile_popup_${id}">${content || ''}</a>`;
}


function fmtAvatar(name, {athlete, athleteId}) {
    const url = athlete && athlete.avatar || 'images/fa/user-circle-solid.svg';
    return athleteLink(athleteId, `<img src="${url}"/>`, {class: 'avatar'});
}


function fmtActions(obj) {
    return [
        `<a class="link" target="watching_popup_${obj.athleteId}"
            href="watching.html?windowId=watching-link-popup&windowType=watching&id=${obj.athleteId}"
            title="Load Watching window for this athlete"><ms>grid_view</ms></a>`,
        `<a class="link" target="analysis_popup_${obj.athleteId}"
            href="analysis.html?windowId=analysis-link-popup&windowType=analysis&id=${obj.athleteId}"
            title="Load Analysis window for this athlete's session"><ms>monitoring</ms></a>`,
        `<a class="link" data-id="watch" title="Watch this athlete"><ms>video_camera_front</ms></a>`,
    ].join(' ');
}

const tpAttr = common.stripHTML(common.attributions.tp);

const fieldGroups = [{
    group: 'athlete',
    label: 'Athlete',
    fields: [
        {id: 'actions', defaultEn: false, label: 'Action Button(s)', headerLabel: ' ', fmt: fmtActions},
        {id: 'avatar', defaultEn: true, label: 'Avatar', headerLabel: '<ms>account_circle</ms>',
         get: x => x.athlete && x.athlete.sanitizedFullname, fmt: fmtAvatar},
        {id: 'female', defaultEn: false, label: 'Female', headerLabel: '<ms>female</ms>',
         get: x => x.athlete?.gender === 'female', fmt: x => x ? '<ms title="Female">female</ms>' : ''},
        {id: 'nation', defaultEn: true, label: 'Country Flag', headerLabel: '<ms>flag</ms>',
         get: x => x.athlete && x.athlete.countryCode, fmt: common.fmtFlag},
        {id: 'name', defaultEn: true, label: 'Name', get: x => x.athlete && x.athlete.sanitizedFullname,
         fmt: fmtName},
        {id: 'f-last', defaultEn: false, label: 'F. Last', get: x => x.athlete && x.athlete.fLast,
         fmt: fmtName},
        {id: 'initials', defaultEn: false, label: 'Name Initials', headerLabel: ' ',
         get: x => x.athlete && x.athlete.initials, fmt: fmtName},
        {id: 'team', defaultEn: false, label: 'Team', get: x => x.athlete && x.athlete.team,
         fmt: common.teamBadge},
        {id: 'weight-class', defaultEn: false, label: 'Weight Class', headerLabel: 'Weight',
         get: x => x.athlete && x.athlete.weight, fmt: weightClass},
        {id: 'level', defaultEn: false, label: 'Level', get: x => x.athlete && x.athlete.level,
         tooltip: 'The Zwift level of this athlete'},
        {id: 'ftp', defaultEn: false, label: 'FTP', get: x => x.athlete && x.athlete.ftp,
         fmt: x => x ? pwr(x) : '-', tooltip: 'Functional Threshold Power'},
        {id: 'cp', defaultEn: false, label: 'CP', get: x => x.athlete && x.athlete.cp,
         fmt: x => x ? pwr(x) : '-', tooltip: 'Critical Power'},
        {id: 'tss', defaultEn: false, label: 'TSS®', get: x => x.stats.power.tss, fmt: H.number,
         tooltip: tpAttr},
        {id: 'intensity-factor', defaultEn: false, label: 'Intensity Factor®', headerLabel: 'IF®',
         get: x => x.stats.power.np, fmt: (x, entry) => pct(x / (entry.athlete && entry.athlete.ftp)),
         tooltip: 'NP® / FTP: A value of 100% means NP® = FTP\n\n' + tpAttr},
        {id: 'distance', defaultEn: false, label: 'Distance', headerLabel: 'Dist',
         get: x => x.state.distance, fmt: fmtDist},
        {id: 'rideons', defaultEn: false, label: 'Ride Ons', headerLabel: '<ms>thumb_up</ms>',
         get: x => x.state.rideons, fmt: H.number},
        {id: 'kj', defaultEn: false, label: 'Energy (kJ)', headerLabel: 'kJ', get: x => x.state.kj, fmt: kj},
        {id: 'wprimebal', defaultEn: false, label: 'W\'bal', get: x => x.wBal,
         tooltip: "W' and W'bal represent time above threshold and remaining energy respectively.\n" +
         "Think of the W'bal value as the amount of energy in a battery.",
         fmt: (x, entry) => (x != null && entry.athlete && entry.athlete.wPrime) ?
             common.fmtBattery(x / entry.athlete.wPrime) + kj(x / 1000, {precision: 1, fixed: true}) : '-'},
        {id: 'power-meter', defaultEn: false, label: 'Power Meter', headerLabel: 'PM',
         get: x => x.state.powerMeter, fmt: x => x ? '<ms>check</ms>' : ''},
    ],
}, {
    group: 'event',
    label: 'Event / Road',
    fields: [
        {id: 'gap', defaultEn: true, label: 'Gap', get: x => x.gap, fmt: gapTime, reverse: true},
        {id: 'gap-distance', defaultEn: false, label: 'Gap (dist)', get: x => x.gapDistance,
         fmt: fmtDist, reverse: true},
        {id: 'grade', defaultEn: false, label: 'Grade', get: x => x.state.grade,
         fmt: x => pct(x, {precision: 1, fixed: true})},
        {id: 'altitude', defaultEn: false, label: 'Altitude', headerLabel: 'Alt', get: x => x.state.altitude,
         fmt: fmtElevation},
        {id: 'game-laps', defaultEn: false, label: 'Game Lap', headerLabel: 'Z Lap',
         get: x => x.state.laps + 1, fmt: H.number},
        {id: 'sauce-laps', defaultEn: false, label: 'Sauce Lap', headerLabel: 'S Lap',
         get: x => x.lapCount, fmt: H.number},
        {id: 'remaining', defaultEn: false, label: 'Event/Route Remaining',
         headerLabel: '<ms>sports_score</ms>', get: x => x.remaining,
         fmt: (v, entry) => entry.remainingMetric === 'distance' ? fmtDist(v) : fmtDur(v)},
        {id: 'position', defaultEn: false, label: 'Event Position', headerLabel: 'Pos',
         get: x => x.eventPosition, fmt: H.number},
        {id: 'event-distance', defaultEn: false, label: 'Event Distance', headerLabel: 'Ev Dst',
         get: x => x.state.eventDistance, fmt: fmtDist},
        {id: 'event', defaultEn: false, label: 'Event', headerLabel: '<ms>event</ms>',
         get: x => x.state.eventSubgroupId, fmt: fmtEvent},
        {id: 'route', defaultEn: false, label: 'Route', headerLabel: '<ms>route</ms>', get: getRoute},
        {id: 'progress', defaultEn: false, label: 'Route %', headerLabel: 'RT %',
         get: x => x.state.progress, fmt: pct},
        {id: 'workout-zone', defaultEn: false, label: 'Workout Zone', headerLabel: 'Zone',
         get: x => x.state.workoutZone, fmt: x => x || '-'},
        {id: 'road', defaultEn: false, label: 'Road ID', headerLabel: 'Rd ID', get: x => x.state.roadId},
        {id: 'roadcom', defaultEn: false, label: 'Road Completion', headerLabel: 'Rd %',
         get: x => x.state.roadCompletion / 1e6, fmt: pct},
    ],
}, {
    group: 'power',
    label: 'Power',
    fields: [
        {id: 'pwr-cur', defaultEn: true, label: 'Current Power', headerLabel: '<ms>bolt</ms>',
         get: x => x.state.power, fmt: pwr},
        {id: 'wkg-cur', defaultEn: true, label: 'Current Watts/kg', headerLabel: 'W/kg',
         get: x => x.state.power / x.athlete?.weight, fmt: fmtWkg},
        {id: 'pwr-5s', defaultEn: false, label: '5s average', headerLabel: '<ms>bolt</ms> (5s)',
         get: x => x.stats.power.smooth[5], fmt: pwr},
        {id: 'wkg-5s', defaultEn: false, label: '5s average (w/kg)', headerLabel: 'W/kg (5s)',
         get: x => x.stats.power.smooth[5] / x.athlete?.weight, fmt: fmtWkg},
        {id: 'pwr-15s', defaultEn: false, label: '15 sec average', headerLabel: '<ms>bolt</ms> (15s)',
         get: x => x.stats.power.smooth[15], fmt: pwr},
        {id: 'wkg-15s', defaultEn: false, label: '15 sec average (w/kg)', headerLabel: 'W/kg (15s)',
         get: x => x.stats.power.smooth[15] / x.athlete?.weight, fmt: fmtWkg},
        {id: 'pwr-60s', defaultEn: false, label: '1 min average', headerLabel: '<ms>bolt</ms> (1m)',
         get: x => x.stats.power.smooth[60], fmt: pwr},
        {id: 'wkg-60s', defaultEn: false, label: '1 min average (w/kg', headerLabel: 'W/kg (1m)',
         get: x => x.stats.power.smooth[60] / x.athlete?.weight, fmt: fmtWkg},
        {id: 'pwr-300s', defaultEn: false, label: '5 min average', headerLabel: '<ms>bolt</ms> (5m)',
         get: x => x.stats.power.smooth[300], fmt: pwr},
        {id: 'wkg-300s', defaultEn: false, label: '5 min average (w/kg)', headerLabel: 'W/kg (5m)',
         get: x => x.stats.power.smooth[300] / x.athlete?.weight, fmt: fmtWkg},
        {id: 'pwr-1200s', defaultEn: false, label: '20 min average', headerLabel: '<ms>bolt</ms> (20m)',
         get: x => x.stats.power.smooth[1200], fmt: pwr},
        {id: 'wkg-1200s', defaultEn: false, label: '20 min average (w/kg)', headerLabel: 'W/kg (20m)',
         get: x => x.stats.power.smooth[1200] / x.athlete?.weight, fmt: fmtWkg},
        {id: 'pwr-avg', defaultEn: true, label: 'Total Average', headerLabel: '<ms>bolt</ms> (avg)',
         get: x => x.stats.power.avg, fmt: pwr},
        {id: 'wkg-avg', defaultEn: false, label: 'Total W/kg Average', headerLabel: 'W/kg (avg)',
         get: x => x.stats.power.avg / x.athlete?.weight, fmt: fmtWkg},
        {id: 'pwr-np', defaultEn: true, label: 'NP®', headerLabel: 'NP®',
         get: x => x.stats.power.np, fmt: pwr, tooltip: tpAttr},
        {id: 'wkg-np', defaultEn: false, label: 'NP® (w/kg)', headerLabel: 'NP® (w/kg)',
         get: x => x.stats.power.np / x.athlete?.weight, fmt: fmtWkg, tooltip: tpAttr},
        {id: 'pwr-vi', defaultEn: true, label: 'Variability Index', headerLabel: 'VI',
         get: x => x.stats.power.np / x.stats.power.avg, fmt: x => H.number(x, {precision: 2, fixed: true}),
         tooltip: 'NP® / Average-power.  A value of 1.0 means the effort is very smooth, higher ' +
                  'values indicate the effort was more volatile.\n\n' + tpAttr},
        ...['power-avg-solo', 'power-avg-follow', 'power-avg-work',
            'energy-solo', 'energy-follow', 'energy-work'].map(x => convertGenericField(x)),
        {id: 'power-lap', defaultEn: false, label: 'Lap Average', headerLabel: '<ms>bolt</ms> (lap)',
         get: x => x.lap.power.avg, fmt: pwr},
        {id: 'wkg-lap', defaultEn: false, label: 'Lap W/kg Average', headerLabel: 'W/kg (lap)',
         get: x => x.lap.power.avg / x.athlete?.weight, fmt: fmtWkg},
        {id: 'power-last-lap', defaultEn: false, label: 'Last Lap Average',
         headerLabel: '<ms>bolt</ms> (last)', get: x => x.lastLap ? x.lastLap.power.avg : null, fmt: pwr},
        {id: 'wkg-last-lap', defaultEn: false, label: 'Last Lap W/kg Average', headerLabel: 'W/kg (last)',
         get: x => x.lastLap?.power.avg / x.athlete?.weight, fmt: fmtWkg},
        ...['power-avg-solo-lap', 'power-avg-follow-lap', 'power-avg-work-lap',
            'energy-solo-lap', 'energy-follow-lap', 'energy-work-lap'].map(x => convertGenericField(x)),
    ]
}, {
    group: 'speed',
    label: 'Speed',
    fields: [
        {id: 'spd-cur', defaultEn: true, label: 'Current Speed', headerLabel: '<ms>speed</ms>',
         get: x => x.state.speed, fmt: spd},
        {id: 'spd-60s', defaultEn: false, label: '1 min average', headerLabel: '<ms>speed</ms> (1m)',
         get: x => x.stats.speed.smooth[60], fmt: spd},
        {id: 'spd-300s', defaultEn: false, label: '5 min average', headerLabel: '<ms>speed</ms> (5m)',
         get: x => x.stats.speed.smooth[300], fmt: spd},
        {id: 'spd-1200s', defaultEn: false, label: '20 min average', headerLabel: '<ms>speed</ms> (20m)',
         get: x => x.stats.speed.smooth[1200], fmt: spd},
        {id: 'spd-avg', defaultEn: true, label: 'Total Average', headerLabel: '<ms>speed</ms> (avg)',
         get: x => x.stats.speed.avg, fmt: spd},
        {id: 'speed-lap', defaultEn: false, label: 'Lap Average', headerLabel: '<ms>speed</ms> (lap)',
         get: x => x.lap.speed.avg, fmt: spd},
        {id: 'speed-last-lap', defaultEn: false, label: 'Last Lap Average',
         headerLabel: '<ms>speed</ms> (last)', get: x => x.lastLap ? x.lastLap.speed.avg : null, fmt: spd},
    ],
}, {
    group: 'hr',
    label: 'Heart Rate',
    fields: [
        {id: 'hr-cur', defaultEn: true, label: 'Current Heart Rate', headerLabel: '<ms>ecg_heart</ms>',
         get: x => x.state.heartrate || null, fmt: hr},
        {id: 'hr-60s', defaultEn: false, label: '1 min average', headerLabel: '<ms>ecg_heart</ms> (1m)',
         get: x => x.stats.hr.smooth[60], fmt: hr},
        {id: 'hr-300s', defaultEn: false, label: '5 min average', headerLabel: '<ms>ecg_heart</ms> (5m)',
         get: x => x.stats.hr.smooth[300], fmt: hr},
        {id: 'hr-1200s', defaultEn: false, label: '20 min average', headerLabel: '<ms>ecg_heart</ms> (20m)',
         get: x => x.stats.hr.smooth[1200], fmt: hr},
        {id: 'hr-avg', defaultEn: true, label: 'Total Average', headerLabel: '<ms>ecg_heart</ms> (avg)',
         get: x => x.stats.hr.avg, fmt: hr},
        {id: 'hr-lap', defaultEn: false, label: 'Lap Average', headerLabel: '<ms>ecg_heart</ms> (lap)',
         get: x => x.lap.hr.avg, fmt: hr},
        {id: 'hr-last-lap', defaultEn: false, label: 'Last Lap Average',
         headerLabel: '<ms>ecg_heart</ms> (last)', get: x => x.lastLap ? x.lastLap.hr.avg : null, fmt: hr},
    ],
}, {
    group: 'draft',
    label: 'Draft',
    fields: [
        {id: 'draft', defaultEn: false, label: 'Current Draft', headerLabel: '<ms>air</ms>',
         get: x => x.state.draft, fmt: pwr},
        {id: 'draft-60s', defaultEn: false, label: '1 min average', headerLabel: '<ms>air</ms> (1m)',
         get: x => x.stats.draft.smooth[60], fmt: pwr},
        {id: 'draft-300s', defaultEn: false, label: '5 min average', headerLabel: '<ms>air</ms> (5m)',
         get: x => x.stats.draft.smooth[300], fmt: pwr},
        {id: 'draft-1200s', defaultEn: false, label: '20 min average', headerLabel: '<ms>air</ms> (20m)',
         get: x => x.stats.draft.smooth[1200], fmt: pwr},
        {id: 'draft-avg', defaultEn: false, label: 'Total Average', headerLabel: '<ms>air</ms> (avg)',
         get: x => x.stats.draft.avg, fmt: pwr},
        {id: 'draft-lap', defaultEn: false, label: 'Lap Average', headerLabel: '<ms>air</ms> (lap)',
         get: x => x.lap.draft.avg, fmt: pwr},
        {id: 'draft-last-lap', defaultEn: false, label: 'Last Lap Average',
         headerLabel: '<ms>air</ms> (last)', get: x => x.lastLap ? x.lastLap.draft.avg : null, fmt: pwr},
        {id: 'draft-energy', defaultEn: false, label: 'Energy Saved', headerLabel: '<ms>air</ms> (kJ)',
         get: x => x.stats.draft.kj, fmt: kj, tooltip: 'Energy saved by drafting'},
    ],
}, {
    group: 'peaks',
    label: 'Peak Performances',
    fields: [
        {id: 'pwr-max', defaultEn: true, label: 'Power Max', headerLabel: '<ms>bolt</ms> (max)',
         get: x => x.stats.power.max || null, fmt: pwr},
        {id: 'wkg-max', defaultEn: false, label: 'Watts/kg Max', headerLabel: 'W/kg (max)',
         get: x => (x.stats.power.max || null) / x.athlete?.weight, fmt: fmtWkg},
        {id: 'pwr-p5s', defaultEn: false, label: 'Power 5 sec peak',
         headerLabel: '<ms>bolt</ms> (<ms>trophy</ms> 5s)', get: x => x.stats.power.peaks[5].avg, fmt: pwr},
        {id: 'wkg-p5s', defaultEn: false, label: 'Watts/kg 5 sec peak',
         headerLabel: 'W/kg (<ms>trophy</ms> 5s)', get: x => x.stats.power.peaks[5].avg / x.athlete?.weight,
         fmt: fmtWkg},
        {id: 'pwr-p15s', defaultEn: false, label: 'Power 15 sec peak',
         headerLabel: '<ms>bolt</ms> (<ms>trophy</ms> 15s)', get: x => x.stats.power.peaks[15].avg, fmt: pwr},
        {id: 'wkg-p15s', defaultEn: false, label: 'Watts/kg 15 sec peak',
         headerLabel: 'W/kg (<ms>trophy</ms> 15s)', get: x => x.stats.power.peaks[15].avg / x.athlete?.weight,
         fmt: fmtWkg},
        {id: 'pwr-p60s', defaultEn: false, label: 'Power 1 min peak',
         headerLabel: '<ms>bolt</ms> (<ms>trophy</ms> 1m)', get: x => x.stats.power.peaks[60].avg, fmt: pwr},
        {id: 'wkg-p60s', defaultEn: false, label: 'Watts/kg 1 min peak',
         headerLabel: 'W/kg (<ms>trophy</ms> 1m)', get: x => x.stats.power.peaks[60].avg / x.athlete?.weight,
         fmt: fmtWkg},
        {id: 'pwr-p300s', defaultEn: true, label: 'Power 5 min peak',
         headerLabel: '<ms>bolt</ms> (<ms>trophy</ms> 5m)', get: x => x.stats.power.peaks[300].avg, fmt: pwr},
        {id: 'wkg-p300s', defaultEn: false, label: 'Watts/kg 5 min peak',
         headerLabel: 'W/kg (<ms>trophy</ms> 5m)', get: x => x.stats.power.peaks[300].avg / x.athlete?.weight,
         fmt: fmtWkg},
        {id: 'pwr-p1200s', defaultEn: false, label: 'Power 20 min peak',
         headerLabel: '<ms>bolt</ms> (<ms>trophy</ms> 20m)', get: x => x.stats.power.peaks[1200].avg,
         fmt: pwr},
        {id: 'wkg-p1200s', defaultEn: false, label: 'Watts/kg 20 min peak',
         headerLabel: 'W/kg (<ms>trophy</ms> 20m)',
         get: x => x.stats.power.peaks[1200].avg / x.athlete?.weight, fmt: fmtWkg},
        {id: 'spd-p60s', defaultEn: false, label: 'Speed 1 min peak',
         headerLabel: '<ms>speed</ms> (<ms>trophy</ms> 1m)', get: x => x.stats.speed.peaks[60].avg, fmt: spd},
        {id: 'hr-p60s', defaultEn: false, label: 'Heart Rate 1 min peak',
         headerLabel: '<ms>ecg_heart</ms> (<ms>trophy</ms> 1m)', get: x => x.stats.hr.peaks[60].avg, fmt: hr},
    ],
}, {
    group: 'misc',
    label: 'Misc',
    fields: [
        convertGenericField('time-coffee'),
        convertGenericField('time-solo'),
        convertGenericField('time-work'),
        convertGenericField('time-follow'),
        convertGenericField('time-pack-graph'),
        convertGenericField('time-coffee-lap'),
        convertGenericField('time-solo-lap'),
        convertGenericField('time-work-lap'),
        convertGenericField('time-follow-lap'),
        convertGenericField('time-pack-graph-lap'),
        {id: 'time-session', defaultEn: false, label: 'Session Time', headerLabel: 'Time',
         get: x => x.state.time, fmt: fmtDur, tooltip: 'Time reported by the game client'},
        {id: 'time-active', defaultEn: false, label: 'Active Time', headerLabel: 'Active',
         get: x => x.stats.activeTime, fmt: fmtDur,
         tooltip: 'Locally observed active time\n\nNOTE: may differ from game value'},
        {id: 'time-lap', defaultEn: false, label: 'Lap Time', headerLabel: 'Lap',
         get: x => (x.lap || x.stats)?.activeTime || 0, fmt: fmtDur,
         tooltip: 'Locally observed current lap time\n\nNOTE: may differ from game value'},
        {id: 'time-elapsed', defaultEn: false, label: 'Elapsed Time', headerLabel: 'Elpsd',
         get: x => x.stats.elapsedTime, fmt: fmtDur,
         tooltip: 'Locally observed elapsed time\n\nNOTE: may differ from game value'},
    ].filter(x => x),
}, {
    group: 'debug',
    label: 'Debug',
    fields: [
        {id: 'id', defaultEn: false, label: 'Athlete ID', headerLabel: 'ID', get: x => x.athleteId},
        {id: 'course', defaultEn: false, label: 'Course (aka world)', headerLabel: '<ms>map</ms>',
         get: x => x.state.courseId},
        {id: 'direction', defaultEn: false, label: 'Direction', headerLabel: 'Dir',
         get: x => x.state.reverse, fmt: x => x ? '<ms>arrow_back</ms>' : '<ms>arrow_forward</ms>'},
        {id: 'latency', defaultEn: false, label: 'Latency',
         get: x => x.state.latency, fmt: x => H.number(x, {suffix: 'ms', html: true})},
        {id: 'power-up', defaultEn: false, label: 'Active Power Up', headerLabel: '<ms>self_improvement</ms>',
         get: x => x.state.activePowerUp, fmt: x => x ? x.toLowerCase() : ''},
        {id: 'event-leader', defaultEn: false, label: 'Event Leader', headerLabel: '<ms>star</ms>',
         get: x => x.eventLeader, fmt: x => x ? '<ms style="color: gold">star</ms>' : ''},
        {id: 'event-sweeper', defaultEn: false, label: 'Event Sweeper', headerLabel: '<ms>mop</ms>',
         get: x => x.eventSweeper, fmt: x => x ? '<ms style="color: darkred">mop</ms>' : ''},
        {id: 'route-progress', defaultEn: false, label: 'Route Checkpoint Index', headerLabel: 'RCI',
         get: x => x.state.routeCheckpointIndex},
        {id: 'route-road-index', defaultEn: false, label: 'Route Decision Index', headerLabel: 'RDI',
         get: x => x.state.routeDecisionIndex},
        {id: 'road-time', defaultEn: false, label: 'Road Time', headerLabel: 'Rd Time',
         get: x => (x.state.roadTime - 5000) / 1e6, fmt: x => x.toFixed(5)},
    ],
}];


function onFilterInput(ev) {
    const f = ev.currentTarget.value;
    filters = parseFilters(f);
    common.settingsStore.set('filtersRaw', f);
    renderData(nearbyData);
}


function parseFilters(raw) {
    return raw.split('|').filter(x => x.length).map(x => {
        const lc = x.toLowerCase();
        return new RegExp(x, lc === x ? 'i' : '');
    });
}


export async function main() {
    if (window.isElectron) {
        const overlayMode = !!window.electron.context.spec.overlay;
        doc.classList.toggle('overlay-mode', overlayMode);
        document.querySelector('#titlebar').classList.toggle('always-visible', overlayMode !== true);
        if (settings.overlayMode !== overlayMode) {
            // Electron context overlay setting is the authority.
            common.settingsStore.set('overlayMode', overlayMode);
        }
    }
    common.initInteractionListeners();
    common.initNationFlags();  // bg okay
    const gcs = await common.rpc.getGameConnectionStatus();
    gameConnection = !!(gcs && gcs.connected);
    doc.classList.toggle('game-connection', gameConnection);
    common.subscribe('status', x => {
        gameConnection = x.connected;
        doc.classList.toggle('game-connection', gameConnection);
    }, {source: 'gameConnection'});
    common.settingsStore.addEventListener('set', async ev => {
        if (!ev.data.remote) {
            return;
        }
        const {key, value} = ev.data;
        if (window.isElectron && key === 'overlayMode') {
            await common.rpc.updateWidgetWindowSpec(window.electron.context.id, {overlay: value});
            await common.rpc.reopenWidgetWindow(window.electron.context.id);
            return;
        } else if (key === '/exteranlEventSite') {
            eventSite = ev.data.value;
        } else if (['solidBackground', 'backgroundColor', 'backgroundAlpha', 'hideHeader'].includes(key)) {
            setStyles();
            return;
        }
        render();
        if (nearbyData) {
            renderData(nearbyData);
        }
    });
    common.storage.addEventListener('update', ev => {
        if (ev.data.key === fieldsKey) {
            fieldStates = ev.data.value;
            render();
            if (nearbyData) {
                renderData(nearbyData);
            }
        }
    });
    setStyles();
    const fields = [].concat(...fieldGroups.map(x => x.fields));
    fieldStates = common.storage.get(fieldsKey, Object.fromEntries(fields.map(x => [x.id, x.defaultEn])));
    render();
    tbody.addEventListener('dblclick', async ev => {
        const row = ev.target.closest('tr');
        if (row) {
            clearSelection();
            if (gameConnection) {
                await watch(Number(row.dataset.id));
            }
        }
    });
    theadRow.addEventListener('click', ev => {
        const col = ev.target.closest('td');
        if (!col) {
            return;
        }
        const id = col.dataset.id;
        for (const th of theadRow.querySelectorAll('.sorted')) {
            th.classList.remove('sorted', 'sort-asc', 'sort-desc');
        }
        if (id === sortBy) {
            sortByDir = -sortByDir;
            common.storage.set('nearby-sort-dir', sortByDir);
        } else {
            sortBy = id;
            for (const td of tbody.querySelectorAll('td.sorted')) {
                td.classList.remove('sorted');
            }
            for (const td of tbody.querySelectorAll(`td[data-id="${sortBy}"]`)) {
                td.classList.add('sorted');
            }
            common.storage.set(`nearby-sort-by-v2`, id);
        }
        col.classList.add('sorted', sortByDir < 0 ? 'sort-asc' : 'sort-desc');
        renderData(nearbyData, {recenter: true});
    });
    tbody.addEventListener('click', async ev => {
        const link = ev.target.closest('.link');
        if (link) {
            ev.stopPropagation();
            const athleteId = Number(ev.target.closest('tr').dataset.id);
            if (link.dataset.id === 'watch') {
                await watch(athleteId);
            }
        }
    });
    const filterInput = document.querySelector('input[name="filter"]');
    if (filtersRaw) {
        filterInput.value = filtersRaw;
        filters = parseFilters(filtersRaw);
    }
    filterInput.addEventListener('input', onFilterInput);
    let lastRefresh = 0;
    common.subscribe('nearby', data => {
        nearbyData = data;
        const elapsed = Date.now() - lastRefresh;
        const refresh = (settings.refreshInterval || 0) * 1000 - 100; // within 100ms is fine.
        if (elapsed >= refresh) {
            lastRefresh = Date.now();
            renderData(data);
        }
    });
}


async function watch(athleteId) {
    await common.rpc.watch(athleteId);
    if (nearbyData) {
        for (const x of nearbyData) {
            x.watching = x.athleteId === athleteId;
        }
        renderData(nearbyData);
    }
}


function render() {
    doc.classList.toggle('autoscroll', settings.autoscroll);
    doc.style.setProperty('--font-scale', settings.fontScale || 1);
    const fields = [].concat(...fieldGroups.map(x => x.fields));
    enFields = fields.filter(x => fieldStates[x.id]);
    enFields.forEach((x, i) => {
        const adj = fieldStates[`${x.id}-adj`] || 0;
        x._idx = i + adj + (adj * 0.00001);
    });
    enFields.sort((a, b) => a._idx < b._idx ? -1 : a._idx === b._idx ? 0 : 1);
    sortBy = common.storage.get('nearby-sort-by-v2', 'gap');
    const isFieldAvail = !!enFields.find(x => x.id === sortBy);
    if (!isFieldAvail) {
        sortBy = enFields[0].id;
    }
    sortByDir = common.storage.get('nearby-sort-dir', 1);
    const sortDirClass = sortByDir < 0 ? 'sort-asc' : 'sort-desc';
    table = document.querySelector('#content table');
    tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    theadRow = table.querySelector('thead tr');
    theadRow.innerHTML = enFields.map(x =>
        `<td data-id="${x.id}"
             title="${common.sanitizeAttr(fGet(x.tooltip) ?? fGet(x.label) ?? '')}"
             class="${sortBy === x.id ? 'sorted ' + sortDirClass : ''}"
             >${fGet(x.headerLabel) ?? fGet(x.label)}` +
                `<ms class="sort-asc">arrow_drop_up</ms>` +
                `<ms class="sort-desc">arrow_drop_down</ms></td>`).join('');
}


function makeTableRow() {
    const tr = document.createElement('tr');
    tr.innerHTML = enFields.map(({id}) => `<td data-id="${id}"></td>`).join('');
    return tr;
}


function gentleClassToggle(el, cls, force) {
    const has = el.classList.contains(cls);
    if (has && !force) {
        el.classList.remove(cls);
    } else if (!has && force) {
        el.classList.add(cls);
    }
}


function updateTableRow(row, ad) {
    if (row.title && !gameConnection) {
        row.title = '';
    } else if (!row.title && gameConnection) {
        row.title = 'Double click row to watch this athlete';
    }
    gentleClassToggle(row, 'watching', ad.watching);
    gentleClassToggle(row, 'marked', ad.athlete && ad.athlete.marked);
    gentleClassToggle(row, 'following', ad.athlete && ad.athlete.following);
    if (row.dataset.id !== '' + ad.athleteId) {
        row.dataset.id = ad.athleteId;
    }
    const tds = row.querySelectorAll('td');
    let unfiltered = !filters.length;
    for (const [i, {id, get, fmt}] of enFields.entries()) {
        let value;
        try {
            value = get ? get(ad) : ad;
        } catch(e) {
            console.warn("Field get error:", e);
            value = null;
        }
        const html = '' + (fmt ? fGet(fmt, value, ad) : value != null ? value : '-');
        const td = tds[i];
        if (td._html !== html) {
            td.innerHTML = (td._html = html);
        }
        if (!unfiltered) {
            unfiltered = filters.some(x => !!td.textContent.match(x));
        }
        gentleClassToggle(td, 'sorted', sortBy === id);
    }
    gentleClassToggle(row, 'hidden', false);
    gentleClassToggle(row, 'filtered', !unfiltered);
}


function disableRow(row) {
    gentleClassToggle(row, 'hidden', true);
    gentleClassToggle(row, 'filtered', false);
}


let frames = 0;
function renderData(data, {recenter}={}) {
    if (!data || !data.length || document.hidden) {
        return;
    }
    if (settings.onlyMarked) {
        data = data.filter(x => x.watching || (x.athlete && x.athlete.marked));
    }
    if (settings.onlySameCategory) {
        const watching = data.find(x => x.watching);
        const sgid = watching && watching.state.eventSubgroupId;
        if (sgid) {
            data = data.filter(x => x.state.eventSubgroupId === sgid);
        }
    }
    if (settings.maxGap) {
        data = data.filter(x => Math.abs(x.gap) <= settings.maxGap);
    }
    const sortField = enFields.find(x => x.id === sortBy);
    const sortGet = sortField && (sortField.sortValue || sortField.get);
    const sortReverse = sortField.reverse ? -1 : 1;
    if (sortGet) {
        data.sort((a, b) => {
            let av = sortGet(a);
            let bv = sortGet(b);
            if (Array.isArray(av)) {
                av = av[0];
            }
            if (Array.isArray(bv)) {
                bv = bv[0];
            }
            const dir = sortByDir * sortReverse;
            if (av === bv || (Number.isNaN(av) && Number.isNaN(av))) {
                return 0;
            } else if (av == null || bv == null) {
                return av == null ? 1 : -1; // Always on the bottom
            } else if (typeof av === 'number' || typeof bv === 'number') {
                const aNotNum = Number.isNaN(av);
                const bNotNum = Number.isNaN(bv);
                return !aNotNum && !bNotNum ? (bv - av) * dir : aNotNum ? 1 : -1;
            } else {
                return (('' + av).toLowerCase() > ('' + bv).toLowerCase() ? -1 : 1) * dir;
            }
        });
    }
    const centerIdx = data.findIndex(x => x.watching);
    const watchingRow = tbody.querySelector('tr.watching') || tbody.appendChild(makeTableRow());
    let row = watchingRow;
    for (let i = centerIdx; i >= 0; i--) {
        updateTableRow(row, data[i]);
        if (i) {
            row = row.previousElementSibling || row.insertAdjacentElement('beforebegin', makeTableRow());
        }
    }
    while (row.previousElementSibling) {
        disableRow(row = row.previousElementSibling);
    }
    row = watchingRow;
    for (let i = centerIdx + 1; i < data.length; i++) {
        row = row.nextElementSibling || row.insertAdjacentElement('afterend', makeTableRow());
        updateTableRow(row, data[i]);
    }
    while (row.nextElementSibling) {
        disableRow(row = row.nextElementSibling);
    }
    if ((!frames++ || recenter) && settings.autoscroll) {
        requestAnimationFrame(() => {
            const r = tbody.querySelector('tr.watching');
            if (r) {
                r.scrollIntoView({block: 'center'});
            }
        });
    }
}


function setStyles() {
    common.setBackground(settings);
    doc.classList.toggle('hide-header', !!settings.hideHeader);
}


export async function settingsMain() {
    common.initInteractionListeners();
    fieldStates = common.storage.get(fieldsKey);
    const form = document.querySelector('form#fields');
    form.addEventListener('input', ev => {
        const el = ev.target;
        const id = el.name;
        if (!id) {
            return;
        }
        fieldStates[id] = el.type === 'checkbox' ?
            el.checked :
            el.type === 'number' ?
                Number(el.value) : el.value;
        el.closest('.field').classList.toggle('disabled', !fieldStates[id]);
        common.storage.set(fieldsKey, fieldStates);
    });
    form.addEventListener('click', ev => {
        const el = ev.target.closest('.button[data-action]');
        if (!el) {
            return;
        }
        const wrapEl = el.closest('[data-id]');
        const key = wrapEl.dataset.id + '-adj';
        const action = el.dataset.action;
        const adj = action === 'moveLeft' ? -1 : 1;
        const value = (fieldStates[key] || 0) + adj;
        fieldStates[key] = value;
        common.storage.set(fieldsKey, fieldStates);
        wrapEl.querySelector('.col-adj .value').textContent = value;
    });
    for (const {fields, label} of fieldGroups) {
        form.insertAdjacentHTML('beforeend', [
            '<div class="field-group">',
            `<div class="title">${label}:</div>`,
            ...fields.map(x => `
                <div class="field ${fieldStates[x.id] ? '' : 'disabled'}" data-id="${x.id}">
                    <label title="${common.sanitizeAttr(fGet(x.tooltip) ?? '')}">
                        <key>${fGet(x.label)}</key>
                        <input type="checkbox" name="${x.id}" ${fieldStates[x.id] ? 'checked' : ''}/>
                    </label>
                    <div class="col-adj" title="Move field left or right">
                        <div class="button std icon-only" data-action="moveLeft"><ms>arrow_left</ms></div>
                        <div class="value">${fieldStates[x.id + '-adj'] || 0}</div>
                        <div class="button std icon-only" data-action="moveRight">` +
                            `<ms>arrow_right</ms></div>
                    </div>
                </div>`),
            '</div>'
        ].join(''));
        form.querySelectorAll('.inline-edit.col-adj').forEach(el => common.makeInlineEditable(el, {
            formatter: x => (x || 0),
            onEdit: x => common.storage.set(el.dataset.id + '-adj', Number(x || 0))
        }));
    }
    await common.initSettingsForm('form#options')();
}
