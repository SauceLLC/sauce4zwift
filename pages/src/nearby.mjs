import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';

common.enableSentry();

const doc = document.documentElement;
const L = sauce.locale;
const H = L.human;
const fieldsKey = 'nearby-fields-v2';
let imperial = common.storage.get('/imperialUnits');
L.setImperial(imperial);
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

const spd = (v, entry) => H.pace(v, {precision: 0, suffix: true, html: true, sport: entry.state.sport});
const weightClass = v => H.weightClass(v, {suffix: true, html: true});
const pwr = v => H.power(v, {suffix: true, html: true});
const hr = v => H.number(v || null, {suffix: 'bpm', html: true});
const kj = (v, options) => H.number(v, {suffix: 'kJ', html: true, ...options});
const pct = (v, options) => H.number(v, {suffix: '%', html: true, ...options});
const gapTime = (v, entry) => H.timer(v) + (entry.isGapEst ? '<small> (est)</small>' : '');

let overlayMode;
if (window.isElectron) {
    overlayMode = !!window.electron.context.spec.overlay;
    doc.classList.toggle('overlay-mode', overlayMode);
    document.querySelector('#titlebar').classList.toggle('always-visible', overlayMode !== true);
    if (common.settingsStore.get('overlayMode') !== overlayMode) {
        // Sync settings to our actual window state, not going to risk updating the window now
        common.settingsStore.set('overlayMode', overlayMode);
    }
}


function makeLazyGetter(cb) {
    const getting = {};
    const cache = new Map();

    return function getter(key) {
        if (!cache.has(key)) {
            if (!getting[key]) {
                getting[key] = cb(key).then(value => {
                    cache.set(key, value || null);
                    if (!value) {
                        // Allow retry, especially for event data which is wonky
                        setTimeout(() => cache.delete(key), 10000);
                    }
                    delete getting[key];
                });
            }
            return;
        } else {
            return cache.get(key);
        }
    };
}


const lazyGetSubgroup = makeLazyGetter(id => common.rpc.getEventSubgroup(id));
const lazyGetRoute = makeLazyGetter(id => common.rpc.getRoute(id));


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
    return H.timer(v);
}


function fmtWkg(v, entry) {
    if (v == null) {
        return '-';
    }
    const wkg = v / (entry.athlete && entry.athlete.weight);
    return H.number(wkg, {precision: 1, fixed: true, suffix: 'w/kg', html: true});
}


function fmtName(name, entry) {
    let badge;
    const sgid = entry.state.eventSubgroupId;
    if (sgid) {
        const sg = lazyGetSubgroup(sgid);
        if (sg) {
            badge = common.eventBadge(sg.subgroupLabel);
        }
    }
    return athleteLink(entry.athleteId, (badge || '') + common.sanitize(name || '-'));
}


function fmtRoute({route, laps}) {
    if (!route) {
        return '-';
    }
    const parts = [];
    if (laps) {
        parts.push(`${laps} x`);
    }
    parts.push(route.name);
    return parts.join(' ');
}


function fmtEvent(sgid) {
    if (!sgid) {
        return '-';
    }
    const sg = lazyGetSubgroup(sgid);
    if (sg) {
        return `<a href="${eventUrl(sg.event.id)}" target="_blank" external>${sg.event.name}</a>`;
    } else {
        return '...';
    }
}


function getRoute({state, routeId}) {
    if (state.eventSubgroupId) {
        const sg = lazyGetSubgroup(state.eventSubgroupId);
        if (sg) {
            return {route: lazyGetRoute(sg.routeId), laps: sg.laps};
        }
    } else if (state.routeId) {
        return {route: lazyGetRoute(state.routeId), laps: 0};
    }
    return {};
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
    const debug = location.search.includes('debug') ? '&debug' : '';
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
            title="Load Watching window for this athlete"><ms>live_tv</ms></a>`,
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
         get: x => x.stats.power.np, fmt: (x, entry) => pct(x / (entry.athlete && entry.athlete.ftp) * 100),
         tooltip: 'NP® / FTP: A value of 100% means NP® = FTP\n\n' + tpAttr},
        {id: 'distance', defaultEn: false, label: 'Distance', headerLabel: 'Dist',
         get: x => x.state.distance, fmt: fmtDist},
        {id: 'event-distance', defaultEn: false, label: 'Event Distance', headerLabel: 'Ev Dist',
         get: x => x.state.eventDistance, fmt: fmtDist},
        {id: 'rideons', defaultEn: false, label: 'Ride Ons', headerLabel: '<ms>thumb_up</ms>',
         get: x => x.state.rideons, fmt: H.number},
        {id: 'kj', defaultEn: false, label: 'Energy (kJ)', headerLabel: 'kJ', get: x => x.state.kj, fmt: kj},
        {id: 'wprimebal', defaultEn: false, label: 'W\'bal', get: x => x.stats.wBal,
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
        {id: 'gap', defaultEn: true, label: 'Gap', get: x => x.gap, fmt: gapTime},
        {id: 'gap-distance', defaultEn: false, label: 'Gap (dist)', get: x => x.gapDistance, fmt: fmtDist},
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
        {id: 'event', defaultEn: false, label: 'Event', headerLabel: '<ms>event</ms>',
         get: x => x.state.eventSubgroupId, fmt: fmtEvent},
        {id: 'route', defaultEn: false, label: 'Route', headerLabel: '<ms>route</ms>',
         get: getRoute, fmt: fmtRoute},
        {id: 'progress', defaultEn: false, label: 'Route %', headerLabel: 'RT %',
         get: x => x.state.progress * 100, fmt: pct},
        {id: 'workout-zone', defaultEn: false, label: 'Workout Zone', headerLabel: 'Zone',
         get: x => x.state.workoutZone, fmt: x => x || '-'},
        {id: 'road', defaultEn: false, label: 'Road ID', get: x => x.state.roadId},
        {id: 'roadcom', defaultEn: false, label: 'Road Completion', headerLabel: 'Road %',
         get: x => x.state.roadCompletion / 10000, fmt: pct},
    ],
}, {
    group: 'power',
    label: 'Power',
    fields: [
        {id: 'pwr-cur', defaultEn: true, label: 'Current Power', headerLabel: 'Pwr',
         get: x => x.state.power, fmt: pwr},
        {id: 'wkg-cur', defaultEn: true, label: 'Current Watts/kg', headerLabel: 'W/kg',
         get: x => x.state.power, fmt: fmtWkg},
        {id: 'pwr-5s', defaultEn: false, label: '5s average', headerLabel: 'Pwr (5s)',
         get: x => x.stats.power.smooth[5], fmt: pwr},
        {id: 'wkg-5s', defaultEn: false, label: '5s average (w/kg)', headerLabel: 'W/kg (5s)',
         get: x => x.stats.power.smooth[5], fmt: fmtWkg},
        {id: 'pwr-15s', defaultEn: false, label: '15 sec average', headerLabel: 'Pwr (15s)',
         get: x => x.stats.power.smooth[15], fmt: pwr},
        {id: 'wkg-15s', defaultEn: false, label: '15 sec average (w/kg)', headerLabel: 'W/kg (15s)',
         get: x => x.stats.power.smooth[15], fmt: fmtWkg},
        {id: 'pwr-60s', defaultEn: false, label: '1 min average', headerLabel: 'Pwr (1m)',
         get: x => x.stats.power.smooth[60], fmt: pwr},
        {id: 'wkg-60s', defaultEn: false, label: '1 min average (w/kg', headerLabel: 'W/kg (1m)',
         get: x => x.stats.power.smooth[60], fmt: fmtWkg},
        {id: 'pwr-300s', defaultEn: false, label: '5 min average', headerLabel: 'Pwr (5m)',
         get: x => x.stats.power.smooth[300], fmt: pwr},
        {id: 'wkg-300s', defaultEn: false, label: '5 min average (w/kg)', headerLabel: 'W/kg (5m)',
         get: x => x.stats.power.smooth[300], fmt: fmtWkg},
        {id: 'pwr-1200s', defaultEn: false, label: '20 min average', headerLabel: 'Pwr (20m)',
         get: x => x.stats.power.smooth[1200], fmt: pwr},
        {id: 'wkg-1200s', defaultEn: false, label: '20 min average (w/kg)', headerLabel: 'W/kg (20m)',
         get: x => x.stats.power.smooth[1200], fmt: fmtWkg},
        {id: 'pwr-avg', defaultEn: true, label: 'Total Average', headerLabel: 'Pwr (avg)',
         get: x => x.stats.power.avg, fmt: pwr},
        {id: 'wkg-avg', defaultEn: false, label: 'Total W/kg Average', headerLabel: 'W/kg (avg)',
         get: x => x.stats.power.avg, fmt: fmtWkg},
        {id: 'pwr-np', defaultEn: true, label: 'NP®', headerLabel: 'NP®',
         get: x => x.stats.power.np, fmt: pwr, tooltip: tpAttr},
        {id: 'wkg-np', defaultEn: false, label: 'NP® (w/kg)', headerLabel: 'NP® (w/kg)',
         get: x => x.stats.power.np, fmt: fmtWkg, tooltip: tpAttr},
        {id: 'pwr-vi', defaultEn: true, label: 'Variability Index', headerLabel: 'VI',
         get: x => x.stats.power.np / x.stats.power.avg, fmt: x => H.number(x, {precision: 2, fixed: true}),
         tooltip: 'NP® / Average-power.  A value of 1.0 means the effort is very smooth, higher ' +
                  'values indicate the effort was more volatile.\n\n' + tpAttr},
        {id: 'power-lap', defaultEn: false, label: 'Lap Average', headerLabel: 'Pwr (lap)',
         get: x => x.lap.power.avg, fmt: pwr},
        {id: 'wkg-lap', defaultEn: false, label: 'Lap W/kg Average', headerLabel: 'W/kg (lap)',
         get: x => x.lap.power.avg, fmt: fmtWkg},
        {id: 'power-last-lap', defaultEn: false, label: 'Last Lap Average', headerLabel: 'Pwr (last)',
         get: x => x.lastLap ? x.lastLap.power.avg : null, fmt: pwr},
        {id: 'wkg-last-lap', defaultEn: false, label: 'Last Lap W/kg Average', headerLabel: 'W/kg (last)',
         get: x => x.lastLap ? x.lastLap.power.avg : null, fmt: fmtWkg},
    ],
}, {
    group: 'speed',
    label: 'Speed',
    fields: [
        {id: 'spd-cur', defaultEn: true, label: 'Current Speed', headerLabel: 'Spd',
         get: x => x.state.speed, fmt: spd},
        {id: 'spd-60s', defaultEn: false, label: '1 min average', headerLabel: 'Spd (1m)',
         get: x => x.stats.speed.smooth[60], fmt: spd},
        {id: 'spd-300s', defaultEn: false, label: '5 min average', headerLabel: 'Spd (5m)',
         get: x => x.stats.speed.smooth[300], fmt: spd},
        {id: 'spd-1200s', defaultEn: false, label: '20 min average', headerLabel: 'Spd (20m)',
         get: x => x.stats.speed.smooth[1200], fmt: spd},
        {id: 'spd-avg', defaultEn: true, label: 'Total Average', headerLabel: 'Spd (avg)',
         get: x => x.stats.speed.avg, fmt: spd},
        {id: 'speed-lap', defaultEn: false, label: 'Lap Average', headerLabel: 'Spd (lap)',
         get: x => x.lap.speed.avg, fmt: spd},
        {id: 'speed-last-lap', defaultEn: false, label: 'Last Lap Average', headerLabel: 'Spd (last)',
         get: x => x.lastLap ? x.lastLap.speed.avg : null, fmt: spd},
    ],
}, {
    group: 'hr',
    label: 'Heart Rate',
    fields: [
        {id: 'hr-cur', defaultEn: true, label: 'Current Heart Rate', headerLabel: 'HR',
         get: x => x.state.heartrate || null, fmt: hr},
        {id: 'hr-60s', defaultEn: false, label: '1 min average', headerLabel: 'HR (1m)',
         get: x => x.stats.hr.smooth[60], fmt: hr},
        {id: 'hr-300s', defaultEn: false, label: '5 min average', headerLabel: 'HR (5m)',
         get: x => x.stats.hr.smooth[300], fmt: hr},
        {id: 'hr-1200s', defaultEn: false, label: '20 min average', headerLabel: 'HR (20m)',
         get: x => x.stats.hr.smooth[1200], fmt: hr},
        {id: 'hr-avg', defaultEn: true, label: 'Total Average', headerLabel: 'HR (avg)',
         get: x => x.stats.hr.avg, fmt: hr},
        {id: 'hr-lap', defaultEn: false, label: 'Lap Average', headerLabel: 'HR (lap)',
         get: x => x.lap.hr.avg, fmt: hr},
        {id: 'hr-last-lap', defaultEn: false, label: 'Last Lap Average', headerLabel: 'HR (last)',
         get: x => x.lastLap ? x.lastLap.hr.avg : null, fmt: hr},
    ],
}, {
    group: 'draft',
    label: 'Draft',
    fields: [
        {id: 'draft', defaultEn: false, label: 'Current Draft', headerLabel: 'Draft',
         get: x => x.state.draft, fmt: pwr},
        {id: 'draft-60s', defaultEn: false, label: '1 min average', headerLabel: 'Draft (1m)',
         get: x => x.stats.draft.smooth[60], fmt: pwr},
        {id: 'draft-300s', defaultEn: false, label: '5 min average', headerLabel: 'Draft (5m)',
         get: x => x.stats.draft.smooth[300], fmt: pwr},
        {id: 'draft-1200s', defaultEn: false, label: '20 min average', headerLabel: 'Draft (20m)',
         get: x => x.stats.draft.smooth[1200], fmt: pwr},
        {id: 'draft-avg', defaultEn: false, label: 'Total Average', headerLabel: 'Draft (avg)',
         get: x => x.stats.draft.avg, fmt: pwr},
        {id: 'draft-lap', defaultEn: false, label: 'Lap Average', headerLabel: 'Draft (lap)',
         get: x => x.lap.draft.avg, fmt: pwr},
        {id: 'draft-last-lap', defaultEn: false, label: 'Last Lap Average', headerLabel: 'Draft (last)',
         get: x => x.lastLap ? x.lastLap.draft.avg : null, fmt: pwr},
        {id: 'draft-energy', defaultEn: false, label: 'Draft (kJ)', get: x => x.stats.draft.kj, fmt: kj,
         tooltip: 'Energy saved by drafting'},
    ],

}, {
    group: 'peaks',
    label: 'Peak Performances',
    fields: [
        {id: 'pwr-max', defaultEn: true, label: 'Power Max', headerLabel: 'Pwr (max)',
         get: x => x.stats.power.max || null, fmt: pwr},
        {id: 'wkg-max', defaultEn: false, label: 'Watts/kg Max', headerLabel: 'W/kg (max)',
         get: x => x.stats.power.max || null, fmt: fmtWkg},
        {id: 'pwr-p5s', defaultEn: false, label: 'Power 5 sec peak', headerLabel: 'Pwr (peak 5s)',
         get: x => x.stats.power.peaks[5].avg, fmt: pwr},
        {id: 'wkg-p5s', defaultEn: false, label: 'Watts/kg 5 sec peak', headerLabel: 'W/kg (peak 5s)',
         get: x => x.stats.power.peaks[5].avg, fmt: fmtWkg},
        {id: 'pwr-p15s', defaultEn: false, label: 'Power 15 sec peak', headerLabel: 'Pwr (peak 15s)',
         get: x => x.stats.power.peaks[15].avg, fmt: pwr},
        {id: 'wkg-p15s', defaultEn: false, label: 'Watts/kg 15 sec peak', headerLabel: 'W/kg (peak 15s)',
         get: x => x.stats.power.peaks[15].avg, fmt: fmtWkg},
        {id: 'pwr-p60s', defaultEn: false, label: 'Power 1 min peak', headerLabel: 'Pwr (peak 1m)',
         get: x => x.stats.power.peaks[60].avg, fmt: pwr},
        {id: 'wkg-p60s', defaultEn: false, label: 'Watts/kg 1 min peak', headerLabel: 'W/kg (peak 1m)',
         get: x => x.stats.power.peaks[60].avg, fmt: fmtWkg},
        {id: 'pwr-p300s', defaultEn: true, label: 'Power 5 min peak', headerLabel: 'Pwr (peak 5m)',
         get: x => x.stats.power.peaks[300].avg, fmt: pwr},
        {id: 'wkg-p300s', defaultEn: false, label: 'Watts/kg 5 min peak', headerLabel: 'W/kg (peak 5m)',
         get: x => x.stats.power.peaks[300].avg, fmt: fmtWkg},
        {id: 'pwr-p1200s', defaultEn: false, label: 'Power 20 min peak', headerLabel: 'Pwr (peak 20m)',
         get: x => x.stats.power.peaks[1200].avg, fmt: pwr},
        {id: 'wkg-p1200s', defaultEn: false, label: 'Watts/kg 20 min peak', headerLabel: 'W/kg (peak 20m)',
         get: x => x.stats.power.peaks[1200].avg, fmt: fmtWkg},
        {id: 'spd-p60s', defaultEn: false, label: 'Speed 1 min peak', headerLabel: 'Spd (peak 1m)',
         get: x => x.stats.speed.peaks[60].avg, fmt: spd},
        {id: 'hr-p60s', defaultEn: false, label: 'Heart Rate 1 min peak', headerLabel: 'HR (peak 1m)',
         get: x => x.stats.hr.peaks[60].avg, fmt: hr},
    ],
}, {
    group: 'debug',
    label: 'Debug',
    fields: [
        //{id: 'index', defaultEn: false, label: 'Data Index', headerLabel: 'Idx', get: x => x.index},
        {id: 'id', defaultEn: false, label: 'Athlete ID', headerLabel: 'ID', get: x => x.athleteId},
        {id: 'course', defaultEn: false, label: 'Course (aka world)', headerLabel: '<ms>map</ms>',
         get: x => x.state.courseId},
        {id: 'direction', defaultEn: false, label: 'Direction', headerLabel: 'Dir',
         get: x => x.state.reverse, fmt: x => x ? '<ms>arrow_back</ms>' : '<ms>arrow_forward</ms>'},
        {id: 'latency', defaultEn: false, label: 'Latency',
         get: x => x.state.latency, fmt: x => H.number(x, {suffix: 'ms', html: true})},
        {id: 'power-up', defaultEn: false, label: 'Active Power Up', headerLabel: 'PU',
         get: x => x.state.activePowerUp, fmt: x => x ? x.toLowerCase() : ''},
        {id: 'event-leader', defaultEn: false, label: 'Event Leader', headerLabel: '<ms>star</ms>',
         get: x => x.eventLeader, fmt: x => x ? '<ms style="color: gold">star</ms>' : ''},
        {id: 'event-sweeper', defaultEn: false, label: 'Event Sweeper', headerLabel: '<ms>mop</ms>',
         get: x => x.eventSweeper, fmt: x => x ? '<ms style="color: darkred">mop</ms>' : ''},
    ],
}];


function onFilterInput(ev) {
    const f = ev.currentTarget.value;
    filters = parseFilters(f);
    renderData(nearbyData);
    common.settingsStore.set('filtersRaw', f);
}


function parseFilters(raw) {
    return raw.split('|').map(x => x.toLowerCase()).filter(x => x.length);
}


export async function main() {
    common.initInteractionListeners();
    common.initNationFlags();  // bg okay
    let onlyMarked = common.settingsStore.get('onlyMarked');
    let onlySameCategory= common.settingsStore.get('onlySameCategory');
    let refresh;
    const setRefresh = () => {
        refresh = (common.settingsStore.get('refreshInterval') || 0) * 1000 - 100; // within 100ms is fine.
    };
    const gcs = await common.rpc.getGameConnectionStatus();
    gameConnection = !!(gcs && gcs.connected);
    doc.classList.toggle('game-connection', gameConnection);
    common.subscribe('status', x => {
        gameConnection = x.connected;
        doc.classList.toggle('game-connection', gameConnection);
    }, {source: 'gameConnection'});
    common.settingsStore.addEventListener('changed', async ev => {
        const changed = ev.data.changed;
        if (window.isElectron && changed.has('overlayMode')) {
            await common.rpc.updateWidgetWindowSpec(window.electron.context.id,
                                                    {overlay: changed.get('overlayMode')});
            await common.rpc.reopenWidgetWindow(window.electron.context.id);
        }
        if (changed.has('refreshInterval')) {
            setRefresh();
        }
        if (changed.has('onlyMarked')) {
            onlyMarked = changed.get('onlyMarked');
        }
        if (changed.has('onlySameCategory')) {
            onlySameCategory = changed.get('onlySameCategory');
        }
        setBackground();
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
    common.storage.addEventListener('globalupdate', ev => {
        if (ev.data.key === '/imperialUnits') {
            L.setImperial(imperial = ev.data.value);
        } else if (ev.data.key === '/exteranlEventSite') {
            eventSite = ev.data.value;
        }
    });
    setBackground();
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
            common.storage.set(`nearby-sort-by`, id);
        }
        col.classList.add('sorted', sortByDir > 0 ? 'sort-asc' : 'sort-desc');
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
    setRefresh();
    let lastRefresh = 0;
    common.subscribe('nearby', data => {
        if (onlyMarked) {
            data = data.filter(x => x.watching || (x.athlete && x.athlete.marked));
        }
        if (onlySameCategory) {
            const watching = data.find(x => x.watching);
            const sgid = watching && watching.state.eventSubgroupId;
            if (sgid) {
                data = data.filter(x => x.state.eventSubgroupId === sgid);
            }
        }
        nearbyData = data;
        const elapsed = Date.now() - lastRefresh;
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
    doc.classList.toggle('autoscroll', common.settingsStore.get('autoscroll'));
    doc.style.setProperty('--font-scale', common.settingsStore.get('fontScale') || 1);
    const fields = [].concat(...fieldGroups.map(x => x.fields));
    enFields = fields.filter(x => fieldStates[x.id]);
    enFields.forEach((x, i) => {
        const adj = fieldStates[`${x.id}-adj`] || 0;
        x._idx = i + adj + (adj * 0.00001);
    });
    enFields.sort((a, b) => a._idx < b._idx ? -1 : a._idx === b._idx ? 0 : 1);
    sortBy = common.storage.get('nearby-sort-by', 'gap');
    const isFieldAvail = !!enFields.find(x => x.id === sortBy);
    if (!isFieldAvail) {
        sortBy = enFields[0].id;
    }
    sortByDir = common.storage.get('nearby-sort-dir', -1);
    const sortDirClass = sortByDir > 0 ? 'sort-asc' : 'sort-desc';
    table = document.querySelector('#content table');
    tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    theadRow = table.querySelector('thead tr');
    theadRow.innerHTML = enFields.map(x =>
        `<td data-id="${x.id}"
             title="${common.sanitizeAttr(x.tooltip || x.label || '')}"
             class="${sortBy === x.id ? 'sorted ' + sortDirClass : ''}"
             >${x.headerLabel || x.label}` +
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


function updateTableRow(row, info) {
    if (row.title && !gameConnection) {
        row.title = '';
    } else if (!row.title && gameConnection) {
        row.title = 'Double click row to watch this athlete';
    }
    gentleClassToggle(row, 'watching', info.watching);
    gentleClassToggle(row, 'marked', info.athlete && info.athlete.marked);
    gentleClassToggle(row, 'following', info.athlete && info.athlete.following);
    if (row.dataset.id !== '' + info.athleteId) {
        row.dataset.id = info.athleteId;
    }
    const tds = row.querySelectorAll('td');
    let unfiltered = !filters.length;
    for (const [i, {id, get, fmt}] of enFields.entries()) {
        let value;
        try {
            value = get ? get(info) : info;
        } catch(e) {
            value = null;
        }
        const html = '' + (fmt ? fmt(value, info) : value != null ? value : '-');
        const td = tds[i];
        if (td._html !== html) {
            td.innerHTML = (td._html = html);
        }
        if (!unfiltered) {
            unfiltered = filters.some(x => ('' + value).toLowerCase().indexOf(x) !== -1);
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
    const sortField = enFields.find(x => x.id === sortBy);
    const sortGet = sortField && (sortField.sortValue || sortField.get);
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
            // eslint-disable-next-line eqeqeq
            if (av == bv) {
                return 0;
            } else if (av == null || bv == null) {
                return av == null ? 1 : -1;
            } else if (typeof av === 'number') {
                return (av < bv ? 1 : -1) * sortByDir;
            } else {
                return (('' + av).toLowerCase() < ('' + bv).toLowerCase() ? 1 : -1) * sortByDir;
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
    if ((!frames++ || recenter) && common.settingsStore.get('autoscroll')) {
        requestAnimationFrame(() => {
            const r = tbody.querySelector('tr.watching');
            if (r) {
                r.scrollIntoView({block: 'center'});
            }
        });
    }
}


function setBackground() {
    const {solidBackground, backgroundColor, hideHeader} = common.settingsStore.get();
    doc.classList.toggle('solid-background', !!solidBackground);
    if (solidBackground) {
        doc.style.setProperty('--background-color', backgroundColor);
    } else {
        doc.style.removeProperty('--background-color');
    }
    doc.classList.toggle('hide-header', !!hideHeader);
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
                    <label title="${common.sanitizeAttr(x.tooltip || '')}">
                        <key>${x.label}</key>
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
