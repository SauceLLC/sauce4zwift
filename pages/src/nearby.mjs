import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import {routes} from '../../shared/deps/routes.mjs';

const L = sauce.locale;
const H = L.human;
const num = H.number;
const settingsKey = 'nearby-settings-v3';
const fieldsKey = 'nearby-fields-v2';
let imperial = common.storage.get('/imperialUnits');
L.setImperial(imperial);
let eventSite = common.storage.get('/externalEventSite', 'zwift');
let settings;
let fieldStates;
let athleteData = new Map(); // XXX why now?
let nearbyData;
let enFields;
let sortBy;
let sortByDir;
let table;
let tbody;
let theadRow;
let mainRow;
let nations;
let flags;
let gameControlEnabled;
let gameControlConnected;
let watchingRow;
let watchingRowObservable;
const routesById = new Map(routes.map(x => [x.id, x]));
const activeRows = new Map();
const inactiveRows = [];
const intersectionObserver = new IntersectionObserver(onIntersection, {threshold: 1});

const spd = v => H.pace(v, {precision: 0, suffix: true, html: true});
const weightClass = v => H.weightClass(v, {suffix: true, html: true});
const pwr = v => H.power(v, {suffix: true, html: true});
const hr = v => v ? `${num(v)}<abbr class="unit">bpm</abbr>` : '-';
const kj = v => v != null ? `${num(v)}<abbr class="unit">kJ</abbr>` : '-';
const pct = v => v != null ? `${num(v)}<abbr class="unit">%</abbr>` : '-';
const wkg = v => (v !== Infinity && !isNaN(v)) ?
    `${num(v, {precision: 1, fixed: true})}<abbr class="unit">w/kg</abbr>`: '-';
const gapTime = (v, entry) => (H.duration(v, {short: true, html: true}) + (entry.isGapEst ? '<small> (est)</small>' : ''));


function fmtDist(v) {
    if (v == null || v === Infinity || v === -Infinity) {
        return '-';
    } else if (Math.abs(v) < 1500) {
        const suffix = `<abbr class="unit">${imperial ? 'ft' : 'm'}</abbr>`;
        return H.number(imperial ? v / L.metersPerFoot : v) + suffix;
    } else {
        return H.distance(v, {suffix: true, html: true});
    }
}


function fmtWkg(v, entry) {
    if (v == null) {
        return '-';
    }
    const wkg = v / (entry.athlete && entry.athlete.weight);
    return (wkg !== Infinity && wkg !== -Infinity && !isNaN(wkg)) ?
        `${num(wkg, {precision: 1, fixed: true})}<abbr class="unit">w/kg</abbr>` :
        '-';
}


function fmtName(name, entry) {
    let badge = '';
    const sgid = entry.state.groupId;
    if (sgid) {
        const event = lazyGetSubGroup(sgid);
        if (event) {
            badge = makeEventBadge(event, sgid);
        }
    }
    return athleteLink(entry.athleteId, badge + sanitize(name || '-'));
}


function fmtInitials(initials, entry) {
    let badge = '';
    const sgid = entry.state.groupId;
    if (sgid) {
        const event = lazyGetSubGroup(sgid);
        if (event) {
            badge = makeEventBadge(event, sgid);
        }
    }
    return athleteLink(entry.athleteId, badge + sanitize(initials || '-'));
}


function fmtRoute(meta) {
    if (!meta) {
        return '-';
    }
    const route = routesById.get(meta.id);
    if (!route) {
        console.error("Unknown route:", meta.id);
        return '?';
    }
    const parts = [];
    if (meta.laps) {
        parts.push(`${meta.laps} x`);
    }
    parts.push(route.name);
    return parts.join(' ');
}


function getRouteRemaining(x) {
    const meta = getRouteMeta(x.state);
    if (!meta) {
        return null;
    }
    const route = routesById.get(meta.id);
    if (!route) {
        console.error("Unknown route:", meta.id);
        return null;
    }
    const distance = route.distance * 1000 * meta.laps;
    const covered = x.state.progress * distance;
    return distance - covered;
}


const _gettingSubGroups = {};
const _eventsBySubGroup = new Map();

function lazyGetSubGroup(sgid) {
    if (!_eventsBySubGroup.has(sgid)) {
        if (!_gettingSubGroups[sgid]) {
            _gettingSubGroups[sgid] = common.rpc.getSubGroupEvent(sgid).then(event => {
                if (!event) {
                    console.warn("Unknown event subgroup (probably private):", sgid);
                }
                _eventsBySubGroup.set(sgid, event || null);
                delete _gettingSubGroups[sgid];
            });
        }
        return;
    } else {
        return _eventsBySubGroup.get(sgid);
    }
}


function makeEventBadge(event, sgid) {
    const sg = event.eventSubgroups.find(x => x.id === sgid);
    const badgeHue = {
        A: 0,
        B: 90,
        C: 180,
        D: 60,
        E: 260,
    }[sg.subgroupLabel];
    return `<span class="badge category" style="--hue: ${badgeHue}deg;">${sg.subgroupLabel}</span>`;
}


function fmtEvent(sgid) {
    if (!sgid) {
        return '-';
    }
    const event = lazyGetSubGroup(sgid);
    if (event) {
        return `<a href="${eventUrl(event.id)}" target="_blank" external>${event.name}</a>`;
    } else {
        return '...';
    }
}


function getRouteMeta(state) {
    if (state.route) {
        return {id: state.route};
    } else if (state.groupId) {
        const event = lazyGetSubGroup(state.groupId);
        if (event) {
            const sg = event.eventSubgroups.find(x => x.id === state.groupId);
            if (sg) {
                return {id: sg.routeId, laps: sg.laps};
            }
        }
    }
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


function getAthleteValue(x, key) {
    // XXX why do I still need this?
    const a = athleteData.get(x.athleteId);
    return a && a[key];
}


function athleteLink(id, content, options={}) {
    const debug = location.search.includes('debug') ? '&debug' : '';
    return `<a title="${options.title || ''}" class="athlete-link ${options.class || ''}"
               href="athlete.html?athleteId=${id}&widthHint=900&heightHint=375${debug}"
               target="_blank">${content || ''}</a>`;
}


const _sanitizeEl = document.createElement('span');
function sanitize(unsafe) {
    _sanitizeEl.textContent = unsafe;
    return _sanitizeEl.innerHTML;
}


function fmtTeam(t) {
    if (!t) {
        return '-';
    }
    const hue = common.badgeHue(t);
    return `<div class="badge" style="--hue: ${hue};">${sanitize(t)}</div>`;
}


function fmtFlag(code) {
    if (code && flags && flags[code]) {
        const nation = common.sanitizeForAttr(nations[code]);
        return `<img src="${flags[code]}" title="${nation}"/>`;
    } else {
        return '-';
    }
}


const fieldGroups = [{
    group: 'athlete',
    label: 'Athlete',
    fields: [
        {id: 'avatar', defaultEn: true, label: 'Avatar', headerLabel: '<img class="fa" src="images/fa/user-circle-solid.svg"/>',
         get: x => [x.athleteId, getAthleteValue(x, 'avatar') || 'images/fa/user-circle-solid.svg'],
         fmt: ([id, avatar]) => avatar ? athleteLink(id, `<img src="${avatar}"/>`, {class: 'avatar'}) : ''},
        {id: 'nation', defaultEn: true, label: 'Country Flag', headerLabel: '<ms>flag</ms>',
         get: x => getAthleteValue(x, 'countryCode'), fmt: fmtFlag},
        {id: 'name', defaultEn: true, label: 'Name', get: x => getAthleteValue(x, 'sanitizedFullname'), fmt: fmtName},
        {id: 'initials', defaultEn: false, label: 'Name Initials', headerLabel: ' ',
         get: x => getAthleteValue(x, 'initials'), fmt: fmtInitials},
        {id: 'team', defaultEn: false, label: 'Team', get: x => getAthleteValue(x, 'team'), fmt: fmtTeam},
        {id: 'weight-class', defaultEn: false, label: 'Weight Class', headerLabel: 'Weight',
         get: x => getAthleteValue(x, 'weight'), fmt: weightClass},
        {id: 'level', defaultEn: false, label: 'Level', get: x => getAthleteValue(x, 'level'),
         tooltip: 'The Zwift level of this athlete'},
        {id: 'ftp', defaultEn: false, label: 'FTP', get: x => getAthleteValue(x, 'ftp'), fmt: pwr,
         tooltip: 'Functional Threshold Power'},
        {id: 'tss', defaultEn: false, label: 'TSS', get: x => x.stats.power.tss, fmt: num,
         tooltip: 'Training Stress Score'},
        {id: 'distance', defaultEn: false, label: 'Distance', headerLabel: 'Dist',
         get: x => x.state.distance, fmt: fmtDist},
        {id: 'rideons', defaultEn: false, label: 'Ride Ons', headerLabel: '<ms>thumb_up</ms>',
         get: x => x.state.rideons, fmt: num},
        {id: 'kj', defaultEn: false, label: 'Energy (kJ)', headerLabel: 'kJ', get: x => x.state.kj, fmt: kj},
        {id: 'power-meter', defaultEn: false, label: 'Power Meter', headerLabel: 'PM',
         get: x => x.state.powerMeter, fmt: x => x ? '<ms>check</ms>' : ''},
    ],
}, {
    group: 'position',
    label: 'Position',
    fields: [
        {id: 'gap', defaultEn: true, label: 'Gap', get: x => x.gap, fmt: gapTime},
        {id: 'gap-distance', defaultEn: false, label: 'Gap (dist)', get: x => x.gapDistance, fmt: fmtDist},
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
        {id: 'pwr-np', defaultEn: true, label: 'NP', headerLabel: 'NP',
         get: x => x.stats.power.np, fmt: pwr},
        {id: 'wkg-np', defaultEn: false, label: 'NP (w/kg)', headerLabel: 'NP (w/kg)',
         get: x => x.stats.power.np, fmt: fmtWkg},
        {id: 'power-lap', defaultEn: false, label: 'Lap Average', headerLabel: 'Pwr (lap)',
         get: x => x.laps.at(-1).power.avg, fmt: pwr},
        {id: 'wkg-lap', defaultEn: false, label: 'Lap W/kg Average', headerLabel: 'W/kg (lap)',
         get: x => x.laps.at(-1).power.avg, fmt: fmtWkg},
        {id: 'power-last-lap', defaultEn: false, label: 'Last Lap Average', headerLabel: 'Pwr (last)',
         get: x => x.laps.at(-2).power.avg, fmt: pwr},
        {id: 'wkg-last-lap', defaultEn: false, label: 'Last Lap W/kg Average', headerLabel: 'W/kg (last)',
         get: x => x.laps.at(-2).power.avg, fmt: fmtWkg},
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
         get: x => x.laps.at(-1).speed.avg, fmt: spd},
        {id: 'speed-last-lap', defaultEn: false, label: 'Last Lap Average', headerLabel: 'Spd (last)',
         get: x => x.laps.at(-2).speed.avg, fmt: spd},
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
         get: x => x.laps.at(-1).hr.avg, fmt: hr},
        {id: 'hr-last-lap', defaultEn: false, label: 'Last Lap Average', headerLabel: 'HR (last)',
         get: x => x.laps.at(-2).hr.avg, fmt: hr},
    ],
}, {
    group: 'draft',
    label: 'Draft',
    fields: [
        {id: 'draft', defaultEn: false, label: 'Current Draft', headerLabel: 'Draft',
         get: x => x.state.draft, fmt: pct},
        {id: 'draft-60s', defaultEn: false, label: '1 min average', headerLabel: 'Draft (1m)',
         get: x => x.stats.draft.smooth[60], fmt: pct},
        {id: 'draft-300s', defaultEn: false, label: '5 min average', headerLabel: 'Draft (5m)',
         get: x => x.stats.draft.smooth[300], fmt: pct},
        {id: 'draft-1200s', defaultEn: false, label: '20 min average', headerLabel: 'Draft (20m)',
         get: x => x.stats.draft.smooth[1200], fmt: pct},
        {id: 'draft-avg', defaultEn: false, label: 'Total Average', headerLabel: 'Draft (avg)',
         get: x => x.stats.draft.avg, fmt: pct},
        {id: 'draft-lap', defaultEn: false, label: 'Lap Average', headerLabel: 'Draft (lap)',
         get: x => x.laps.at(-1).draft.avg, fmt: pct},
        {id: 'draft-last-lap', defaultEn: false, label: 'Last Lap Average', headerLabel: 'Draft (last)',
         get: x => x.laps.at(-2).draft.avg, fmt: pct},
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
    group: 'event',
    label: 'Event / Road',
    fields: [
        {id: 'game-laps', defaultEn: false, label: 'Game Lap', headerLabel: 'Lap',
         get: x => x.state.laps, fmt: x => x != null ? x + 1 : '-'},
        {id: 'route', defaultEn: false, label: 'Route', get: x => getRouteMeta(x.state), fmt: fmtRoute},
        {id: 'remaining', defaultEn: false, label: 'Remaining', headerLabel: 'Rem',
         get: getRouteRemaining, fmt: fmtDist},
        {id: 'event', defaultEn: false, label: 'Event', get: x => x.state.groupId, fmt: fmtEvent},
        {id: 'progress', defaultEn: false, label: 'Route/Workout %', headerLabel: 'RT/WO %',
         get: x => x.state.progress * 100, fmt: pct},
        {id: 'workout-zone', defaultEn: false, label: 'Workout Zone', headerLabel: 'Zone',
         get: x => x.state.workoutZone, fmt: x => x || '-'},
        {id: 'road', defaultEn: false, label: 'Road ID', get: x => x.state.roadId},
        {id: 'roadcom', defaultEn: false, label: 'Road Completion', headerLabel: 'Road %',
         get: x => x.state.roadCompletion / 10000, fmt: pct},
    ],
}, {
    group: 'debug',
    label: 'Debug',
    fields: [
        {id: 'number', defaultEn: false, label: 'Data Index', headerLabel: 'Idx', get: x => x.index + 1},
        {id: 'id', defaultEn: false, label: 'Athlete ID', headerLabel: 'ID', get: x => x.athleteId},
        {id: 'course', defaultEn: false, label: 'Course (aka world)', headerLabel: 'Course',
         get: x => x.state.courseId},
        {id: 'direction', defaultEn: false, label: 'Direction', headerLabel: 'Dir',
         get: x => x.state.reverse, fmt: x => x ? 'rev' : 'fwd'},
    ],
}];


async function lazyInitNationMeta() {
    const r = await fetch('deps/src/countries.json');
    if (!r.ok) {
        throw new Error('Failed to get country data: ' + r.status);
    }
    const data = await r.json();
    nations = Object.fromEntries(data.map(({id, en}) => [id, en]));
    flags = Object.fromEntries(data.map(({id, alpha2}) => [id, `deps/flags/${alpha2}.png`]));
    // Hack in the custom codes I've seen for UK
    flags[900] = flags[826]; // Scotland
    flags[901] = flags[826]; // Wales
    flags[902] = flags[826]; // England
    flags[903] = flags[826]; // Northern Ireland
}


export async function main() {
    common.initInteractionListeners();
    lazyInitNationMeta();  // bg okay
    let refresh;
    const setRefresh = () => refresh = (settings.refreshInterval || 0) * 1000 - 100; // within 100ms is fine.
    const gcs = await common.rpc.getGameConnectionStatus();
    gameControlEnabled = gcs != null;
    gameControlConnected = gcs && gcs.connected;
    common.subscribe('status', gcs => {
        gameControlConnected = gcs && gcs.connected;
    }, {source: 'gameConnection'});
    common.storage.addEventListener('update', async ev => {
        if (ev.data.key === fieldsKey) {
            fieldStates = ev.data.value;
        } else if (ev.data.key === settingsKey) {
            const oldSettings = settings;
            settings = ev.data.value;
            if (oldSettings.transparency !== settings.transparency) {
                common.rpc.setWindowOpacity(window.electron.context.id, 1 - (settings.transparency / 100));
            }
            if (window.isElectron && typeof settings.overlayMode === 'boolean') {
                await common.rpc.updateWindow(window.electron.context.id, {overlay: settings.overlayMode});
                if (settings.overlayMode !== oldSettings.overlayMode) {
                    await common.rpc.reopenWindow(window.electron.context.id);
                }
            }
        } else {
            return;
        }
        setRefresh();
        render();
        if (nearbyData) {
            renderData(nearbyData);
        }
    });
    common.storage.addEventListener('globalupdate', ev => {
        if (ev.data.key === '/imperialUnits') {
            L.setImperial(imperial = ev.data.value);
        } else if (ev.data.key === '/exteranlEventSite') {
            eventSite = ev.data.value;
        }
    });
    settings = common.storage.get(settingsKey, {
        autoscroll: true,
        refreshInterval: 2,
        overlayMode: false,
        fontScale: 1,
        transparency: 0,
    });
    document.documentElement.classList.toggle('overlay-mode', settings.overlayMode);
    document.documentElement.classList.toggle('noframe', settings.overlayMode);
    const fields = [].concat(...fieldGroups.map(x => x.fields));
    fieldStates = common.storage.get(fieldsKey, Object.fromEntries(fields.map(x => [x.id, x.defaultEn])));
    if (window.isElectron) {
        common.rpc.getWindow(window.electron.context.id).then(({overlay}) => {
            if (settings.overlayMode !== overlay) {
                settings.overlayMode = overlay;
                common.storage.set(settingsKey, settings);
                document.documentElement.classList.toggle('overlay-mode', overlay);
                document.documentElement.classList.toggle('noframe', overlay);
            }
        });
    }
    render();
    tbody.addEventListener('dblclick', async ev => {
        const row = ev.target.closest('tr');
        if (row) {
            clearSelection();
            await watch(Number(row.dataset.id));
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
        table.classList.add('notransitions');
        requestAnimationFrame(() => table.classList.remove('notransitions'));
        renderData(nearbyData, {recenter: true});
    });
    tbody.addEventListener('click', async ev => {
        const link = ev.target.closest('.link');
        if (link) {
            ev.stopPropagation();
            const athleteId = Number(ev.target.closest('tr').dataset.id);
            if (link.dataset.id === 'export') {
                const fitData = await common.rpc.exportFIT(athleteId);
                const f = new File([new Uint8Array(fitData)], `${athleteId}.fit`, {type: 'application/binary'});
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
            if (link.dataset.id === 'watch') {
                await watch(athleteId);
            }
        }
    });
    refresh = setRefresh();
    let lastRefresh = 0;
    common.subscribe('nearby', data => {
        if (window.pause) {
            return;
        }
        if (settings.onlyMarked) {
            data = data.filter(x => x.watching || (x.athlete && x.athlete.marked));
        }
        if (settings.onlySameCategory) {
            const watching = data.find(x => x.watching);
            if (watching && watching.groupId) {
                data = data.filter(x => x.groupId === watching.groupId);
            }
        }
        nearbyData = data;
        athleteData = new Map(data.filter(x => x.athlete).map(x => [x.athleteId, x.athlete]));
        const elapsed = Date.now() - lastRefresh;
        if (elapsed >= refresh) {
            lastRefresh = Date.now();
            renderData(data);
        }
    });
}


async function watch(athleteId) {
    if (!gameControlEnabled || !gameControlConnected) {
        console.warn("Game control not connected/enabled. Can't send watch command");
        return;
    }
    await common.rpc.watch(athleteId);
    if (nearbyData) {
        for (const x of nearbyData) {
            x.watching = x.athleteId === athleteId;
        }
        renderData(nearbyData);
    }
}


function render() {
    document.documentElement.classList.toggle('autoscroll', settings.autoscroll);
    document.documentElement.style.setProperty('--font-scale', settings.fontScale || 1);
    const fields = [].concat(...fieldGroups.map(x => x.fields));
    enFields = fields.filter(x => fieldStates[x.id]);
    sortBy = common.storage.get('nearby-sort-by', 'gap');
    const isFieldAvail = !!enFields.find(x => x.id === sortBy);
    if (!isFieldAvail) {
        sortBy = enFields[0].id;
    }
    sortByDir = common.storage.get('nearby-sort-dir', -1);
    const sortDirClass = sortByDir > 0 ? 'sort-asc' : 'sort-desc';
    table = document.querySelector('#content table');
    tbody = table.querySelector('tbody');
    theadRow = table.querySelector('thead tr');
    theadRow.innerHTML = '<td></td>' + enFields.map(x =>
        `<td data-id="${x.id}"
             title="${common.sanitizeForAttr(x.tooltip || x.label || '')}"
             class="${sortBy === x.id ? 'sorted ' + sortDirClass : ''}"
             >${x.headerLabel || x.label}<ms class="sort-asc">arrow_drop_up</ms><ms class="sort-desc">arrow_drop_down</ms></td>`).join('');
    tbody.innerHTML = '';
    activeRows.clear();
    inactiveRows.length = 0;
    //mainRow = makeTableRow();
    //mainRow.classList.add('watching');
    //tbody.appendChild(mainRow);
    for (let i = 0; i < 50; i++) {
        const row = makeTableRow();
        row.style.setProperty('--dom-index', i);
        row.classList.add('hiding');
        inactiveRows.push(row);
        tbody.appendChild(row);
    }
}


function makeTableRow() {
    const tr = document.createElement('tr');
    const btns = [`<a class="link" data-id="export" title="Export FIT file of collected data"><ms>file_download</ms></a>`];
    if (gameControlEnabled) {
        btns.push(`<a class="link" data-id="watch" title="Watch this athlete"><ms>video_camera_front</ms></a>`);
    }
    tr.innerHTML = `<td>${btns.join('')}</td>${enFields.map(({id}) => `<td data-id="${id}"></td>`).join('')}`;
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


function onIntersection(entries) {
    const ent = entries[0];
    watchingRowObservable = ent && ent.intersectionRatio === 1;
    console.warn('observable', watchingRowObservable);
}


function updateTableRow(row, info) {
    gentleClassToggle(row, 'watching', info.watching);
    if (info.watching) {
        if (row !== watchingRow) {
            if (watchingRow) {
                intersectionObserver.unobserve(watchingRow);
                watchingRow.removeEventListener('transitionstart', startKeepCentered);
            }
            watchingRow = row;
            watchingRow.addEventListener('transitionstart', startKeepCentered);
            requestAnimationFrame(() => intersectionObserver.observe(watchingRow));
        }
    }
    gentleClassToggle(row, 'marked', info.athlete && info.athlete.marked);
    gentleClassToggle(row, 'following', info.athlete && info.athlete.following);
    if (row.dataset.id !== '' + info.athleteId) {
        row.dataset.id = info.athleteId;
    }
    const tds = row.querySelectorAll('td');
    for (const [i, {id, get, fmt}] of enFields.entries()) {
        let value;
        try {
            value = get ? get(info) : info;
        } catch(e) {
            value = null;
        }
        const html = '' + (fmt ? fmt(value, info) : value != null ? value : '-');
        const td = tds[i + 1];
        if (td._html !== html) {
            td.innerHTML = (td._html = html);
        }
        gentleClassToggle(td, 'sorted', sortBy === id);
    }
}


function hideRow(row) {
    delete row.dataset.id;
    gentleClassToggle(row, 'slideout', true);
    row.addEventListener('transitionend', ev => {
        console.warn(ev.propertyName, row.dataset.id);
        gentleClassToggle(row, 'hidden', true);
    }, {once: true});
}


let frames = 0;
function renderData(data, {recenter}={}) {
    if (!data || !data.length || document.hidden) {
        return;
    }
    const sortField = enFields.find(x => x.id === sortBy);
    const sortGet = sortField.sortValue || sortField.get;
    data = data.filter(x => !x.hidden); //XXX
    data.sort((a, b) => {
        let av = sortGet(a);
        let bv = sortGet(b);
        if (Array.isArray(av)) {
            av = av[0];
        }
        if (Array.isArray(bv)) {
            bv = bv[0];
        }
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
    /*  const centerIdx = data.findIndex(x => x.watching);
        let row = mainRow;
        for (let i = centerIdx; i >= 0; i--) {
            updateTableRow(row, data[i]);
            if (i) {
                row = row.previousElementSibling || row.insertAdjacentElement('beforebegin', makeTableRow());
            }
        }
        while (row.previousElementSibling) {
            gentleClassToggle(row = row.previousElementSibling, 'hidden', true);
        }
        row = mainRow;
        for (let i = centerIdx + 1; i < data.length; i++) {
            row = row.nextElementSibling || row.insertAdjacentElement('afterend', makeTableRow());
            updateTableRow(row, data[i]);
        }
        while (row.nextElementSibling) {
            gentleClassToggle(row = row.nextElementSibling, 'hidden', true);
        }
        if (!frames++ && settings.autoscroll) {
            queueMicrotask(() => mainRow.scrollIntoView({block: 'center'}));
        }
    });*/
    const unusedRows = new Set(activeRows.keys());
    const prevIndexes = new Map(Array.from(tbody.querySelectorAll('tr:not(.hiding)')).map(x => [x._dataIdx, x]));
    const watchingIdx = data.findIndex(x => x.watching);
    for (const [i, entry] of data.entries()) {
        entry.index = i;
        let row;
        if (activeRows.has(entry.athleteId)) {
            row = activeRows.get(entry.athleteId);
            unusedRows.delete(entry.athleteId);
        } else {
            if (inactiveRows.length) {
                row = inactiveRows.shift();
                row.style.transition = 'initial';
                row.style.setProperty('--data-index', i);
                void row.offsetWidth; // Trigger reflow
                row.style.transition = null;
                row.classList.remove('hiding');
            } else {
                activeRows.set(entry.athleteId, row);
                row = makeTableRow();
                tbody.appendChild(row);
                row.style.setProperty('--dom-index', tbody.childElementCount - 1);
            }
            activeRows.set(entry.athleteId, row);
        }
        row.style.setProperty('--data-index', i);
        row._dataIdx = i;
        updateTableRow(row, data[i]);
    }
    for (const id of unusedRows) {
        const row = activeRows.get(id);
        activeRows.delete(id);
        inactiveRows.push(row);
        row.classList.add('hiding');
        if (row === watchingRow) {
            row.classList.remove('watching');
        }
    }
    if (watchingRowObservable && watchingRow) {
        // Scroll to where we will be using the row that is there now
        watchingRow.scrollIntoView({block: 'center'});
        const idx = watchingRow._dataIdx;
        const destRow = prevIndexes.get(idx);
        if (destRow) {
            destRow.scrollIntoView({block: 'center'});
        } else {
            console.log('borked, off end?', idx); // off
        }
    } else {
        console.log("out of scroll frame");
    }
    if ((!frames++ || recenter) && settings.autoscroll) {
        requestAnimationFrame(() => {
            const row = tbody.querySelector('tr.watching');
            if (row) {
                row.scrollIntoView({block: 'center'});
            }
        });
    }
}

function startKeepCentered() {
    console.info("started");
    let animating = true;
    if (watchingRowObservable && watchingRow) {
        watchingRow.addEventListener('transitioncancel', () => {
            console.info("cancel");
            animating = false;
        }, {once: true});
        watchingRow.addEventListener('transitionend', () => {
            console.info("end");
            animating = false;
        }, {once: true});
        const center = () => {
            watchingRow.scrollIntoView({block: 'center'});
            //keepCentered();
            if (animating) {
                requestAnimationFrame(center);
            }
        };
        center();
    }
}
function keepCentered() {
    //setTimeout(keepCentered, 100);
    if (watchingRowObservable && watchingRow) {
        const {height, y} = watchingRow.getBoundingClientRect();
        const midPoint = (window.content.clientHeight - height) / 2;
        const t = y - midPoint;
        if (Math.abs(t) < 1) {
            return;
        }
        if (t > 0) {
            console.log("move up", t);
            window.content.scrollTop += t;
        } else {
            console.log("move down", t);
            window.content.scrollTop += t;
        }
    }
}
//keepCentered();
window.renderData = renderData;

//window.data = nearbyData = [];
const data = window.data = [];
for (let i = 0; i < 50; i++) {
    data.push({state:{}, athlete: {}, athleteId: i});
}

data[20].athlete.marked = true;
data[25].watching = true;
data[30].athlete.following = true;

//setTimeout(() => renderData(data), 1000);
//setInterval(() => renderData(data.filter(x => !x.hidden)), 5000);

window.move = (from, to) => {
    const t = data.splice(from, 1)[0];
    data.splice(to, 0, t);
    renderData(data.filter(x => !x.hidden));
};

window.shuffleAll = () => {
    for (const i of data.keys()) {
        const ti = (Math.random() * data.length) | 0;
        [data[i], data[ti]] = [data[ti], data[i]];
    }
    renderData(data.filter(x => !x.hidden));
};

window.shuffleSome = (pct=10) => {
    for (const i of data.keys()) {
        if (Math.random() > pct / 100) {
            continue;
        }
        const ti = (Math.random() * data.length) | 0;
        [data[i], data[ti]] = [data[ti], data[i]];
    }
    renderData(data.filter(x => !x.hidden));
};

window.showHideSome = (pct=5) => {
    for (const x of data) {
        if (Math.random() > pct / 100) {
            continue;
        }
        x.hidden = !x.hidden;
    }
    renderData(data.filter(x => !x.hidden));
};


window.rd = () => renderData(data.filter(x => !x.hidden));

export async function settingsMain() {
    common.initInteractionListeners();
    fieldStates = common.storage.get(fieldsKey);
    const form = document.querySelector('form#fields');
    form.addEventListener('input', ev => {
        const id = ev.target.name;
        fieldStates[id] = ev.target.checked;
        common.storage.set(fieldsKey, fieldStates);
    });
    for (const {fields, label} of fieldGroups) {
        form.insertAdjacentHTML('beforeend', [
            '<div class="field-group">',
                `<div class="title">${label}:</div>`,
                ...fields.map(x => `
                    <label title="${common.sanitizeForAttr(x.tooltip || '')}">
                        <key>${x.label}</key>
                        <input type="checkbox" name="${x.id}" ${fieldStates[x.id] ? 'checked' : ''}/>
                    </label>
                `),
            '</div>'
        ].join(''));
    }
    await common.initSettingsForm('form#options', {settingsKey})();
}
