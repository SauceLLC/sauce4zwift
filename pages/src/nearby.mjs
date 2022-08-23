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
let athleteData = new Map();
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
const routesById = new Map(routes.map(x => [x.id, x]));
const eventsBySubGroup = new Map();

const spd = v => H.pace(v, {precision: 0, suffix: true, html: true});
const weightClass = v => H.weightClass(v, {suffix: true, html: true});
const pwr = v => H.power(v, {suffix: true, html: true});
const hr = v => v ? `${num(v)}<abbr class="unit">bpm</abbr>` : '-';
const kj = v => v != null ? `${num(v)}<abbr class="unit">kJ</abbr>` : '-';
const pct = v => v != null ? `${num(v)}<abbr class="unit">%</abbr>` : '-';
const wkg = v => (v !== Infinity && !isNaN(v)) ?
    `${num(v, {precision: 1, fixed: true})}<abbr class="unit">w/kg</abbr>`: '-';
const dist = v => H.distance(v, {suffix: true, html: true});


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
        parts.push(route.distance * meta.laps);
    }
    parts.push(route.name);
    return parts.join(' ');
}


const _gettingSubGroups = {};
function fmtEvent(sgid) {
    if (!sgid) {
        return '-';
    }
    if (!eventsBySubGroup.has(sgid)) {
        if (!_gettingSubGroups[sgid]) {
            _gettingSubGroups[sgid] = common.rpc.getSubGroupEvent(sgid).then(event => {
                if (!event) {
                    console.warn("Unknown event subgroup (probably private):", sgid);
                }
                eventsBySubGroup.set(sgid, event || null);
                delete _gettingSubGroups[sgid];
            });
        }
        return '...';  // show on next refresh
    } else {
        const event = eventsBySubGroup.get(sgid);
        if (event) {
            const sg = event.eventSubgroups.find(x => x.id === sgid);
            const badgeHue = {
                A: 0,
                B: 90,
                C: 180,
                D: 60,
                E: 260,
            }[sg.subgroupLabel];
            return `<a href="${eventUrl(event.id)}" target="_blank" external>
                <span class="badge" style="--hue: ${badgeHue}deg;">${sg.subgroupLabel}</span> ${event.name}
            </a>`;
        } else {
            return '?';
        }
    }
}


function getRouteMeta(state) {
    if (state.route) {
        return {id: state.route};
    } else if (state.groupId) {
        const event = eventsBySubGroup.get(state.groupId);
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


function formatTeam(t) {
    if (!t) {
        return '-';
    }
    const hue = common.badgeHue(t);
    return `<div class="badge" style="--hue: ${hue};">${sanitize(t)}</div>`;
}


const fields = [
    {id: 'avatar', defaultEn: true, label: '<img class="fa" src="images/fa/user-circle-solid.svg"/>',
     get: x => [x.athleteId, getAthleteValue(x, 'avatar') || 'images/fa/user-circle-solid.svg'],
     fmt: ([id, avatar]) => avatar ? athleteLink(id, `<img src="${avatar}"/>`, {class: 'avatar'}) : ''},
    {id: 'nation', defaultEn: true, label: '<ms>flag</ms>', get: x => getAthleteValue(x, 'countryCode'),
     fmt: code => (code && flags && flags[code]) ? `<img src="${flags[code]}" title="${common.sanitizeForAttr(nations[code])}"/>` : code ? code : ''},
    {id: 'name', defaultEn: true, label: 'Name', get: x => [getAthleteValue(x, 'sanitizedFullname'), x.athleteId],
     fmt: ([name, id]) => athleteLink(id, sanitize(name || '-'))},
    {id: 'team', defaultEn: false, label: 'Team', get: x => getAthleteValue(x, 'team'),
     fmt: formatTeam},
    {id: 'initials', defaultEn: false, label: 'Initials', get: x => [getAthleteValue(x, 'initials'), x.athleteId],
     fmt: ([initials, id]) => athleteLink(id, sanitize(initials) || '-')},
    {id: 'id', defaultEn: false, label: 'ID', get: x => x.athleteId},
    {id: 'weight-class', defaultEn: false, label: 'Weight', get: x => getAthleteValue(x, 'weight'), fmt: weightClass},
    {id: 'ftp', defaultEn: false, label: 'FTP', get: x => getAthleteValue(x, 'ftp'), fmt: pwr},
    {id: 'tss', defaultEn: false, label: 'TSS', get: x => x.stats.power.tss, fmt: num},

    {id: 'gap', defaultEn: true, label: 'Gap', get: x => x.gap, fmt: x => H.duration(x, {short: true, html: true})},

    {id: 'pwr-cur', defaultEn: true, label: 'Pwr', get: x => x.state.power, fmt: pwr},
    {id: 'wkg-cur', defaultEn: true, label: 'W/kg', get: x => x.state.power / (x.athlete && x.athlete.weight), fmt: wkg},

    {id: 'pwr-5s', defaultEn: false, label: '5s Pwr', get: x => x.stats.power.smooth[5], fmt: pwr},
    {id: 'wkg-5s', defaultEn: false, label: '5s W/kg',
     get: x => x.stats.power.smooth[5] / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-15s', defaultEn: false, label: '15s Pwr', get: x => x.stats.power.smooth[15], fmt: pwr},
    {id: 'wkg-15s', defaultEn: false, label: '15s W/kg',
     get: x => x.stats.power.smooth[15] / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-60s', defaultEn: false, label: '1m Pwr', get: x => x.stats.power.smooth[60], fmt: pwr},
    {id: 'wkg-60s', defaultEn: false, label: '1m W/kg',
     get: x => x.stats.power.smooth[60] / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-300s', defaultEn: false, label: '5m Pwr', get: x => x.stats.power.smooth[300], fmt: pwr},
    {id: 'wkg-300s', defaultEn: false, label: '5m W/kg',
     get: x => x.stats.power.smooth[300] / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-1200s', defaultEn: false, label: '20m Pwr', get: x => x.stats.power.smooth[1200], fmt: pwr},
    {id: 'wkg-1200s', defaultEn: false, label: '20m W/kg',
     get: x => x.stats.power.smooth[1200] / (x.athlete && x.athlete.weight), fmt: wkg},

    {id: 'pwr-avg', defaultEn: true, label: 'Avg Pwr', get: x => x.stats.power.avg, fmt: pwr},
    {id: 'wkg-avg', defaultEn: false, label: 'Avg W/kg',
     get: x => x.stats.power.avg / (x.athlete && x.athlete.weight), fmt: wkg},

    {id: 'pwr-np', defaultEn: true, label: 'NP', get: x => x.stats.power.np, fmt: pwr},
    {id: 'wkg-np', defaultEn: false, label: 'NP W/kg',
     get: x => x.stats.power.np / (x.athlete && x.athlete.weight), fmt: wkg},

    {id: 'pwr-max', defaultEn: true, label: 'Max Pwr', get: x => x.stats.power.max || null, fmt: pwr},
    {id: 'wkg-max', defaultEn: false, label: 'Max W/kg',
     get: x => (x.stats.power.max || null) / (x.athlete && x.athlete.weight), fmt: wkg},

    {id: 'pwr-p5s', defaultEn: false, label: '5s Peak Pwr', get: x => x.stats.power.peaks[5].avg, fmt: pwr},
    {id: 'wkg-p5s', defaultEn: false, label: '5s Peak W/kg',
     get: x => x.stats.power.peaks[5].avg / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-p15s', defaultEn: false, label: '15s Peak Pwr', get: x => x.stats.power.peaks[15].avg, fmt: pwr},
    {id: 'wkg-p15s', defaultEn: false, label: '15s Peak W/kg',
     get: x => x.stats.power.peaks[15].avg / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-p60s', defaultEn: false, label: '1m Peak Pwr', get: x => x.stats.power.peaks[60].avg, fmt: pwr},
    {id: 'wkg-p60s', defaultEn: false, label: '1m Peak W/kg',
     get: x => x.stats.power.peaks[60].avg / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-p300s', defaultEn: true, label: '5m Peak Pwr', get: x => x.stats.power.peaks[300].avg, fmt: pwr},
    {id: 'wkg-p300s', defaultEn: false, label: '5m Peak W/kg',
     get: x => x.stats.power.peaks[300].avg / (x.athlete && x.athlete.weight), fmt: wkg},
    {id: 'pwr-p1200s', defaultEn: false, label: '20m Peak Pwr', get: x => x.stats.power.peaks[1200].avg, fmt: pwr},
    {id: 'wkg-p1200s', defaultEn: false, label: '20m Peak W/kg',
     get: x => x.stats.power.peaks[1200].avg / (x.athlete && x.athlete.weight), fmt: wkg},

    {id: 'distance', defaultEn: false, label: 'Dist', get: x => x.state.distance, fmt: dist},
    {id: 'spd-cur', defaultEn: true, label: 'Spd', get: x => x.state.speed, fmt: spd},
    {id: 'spd-60s', defaultEn: false, label: '1m Spd', get: x => x.stats.speed.smooth[60], fmt: spd},
    {id: 'spd-avg', defaultEn: true, label: 'Avg Spd', get: x => x.stats.speed.avg, fmt: spd},
    {id: 'spd-p60s', defaultEn: false, label: '1m Peak Spd', get: x => x.stats.speed.peaks[60].avg, fmt: spd},

    {id: 'hr-cur', defaultEn: true, label: 'HR', get: x => x.state.heartrate || null, fmt: hr},
    {id: 'hr-60s', defaultEn: false, label: '1m HR', get: x => x.stats.hr.smooth[60], fmt: hr},
    {id: 'hr-avg', defaultEn: true, label: 'Avg HR', get: x => x.stats.hr.avg, fmt: hr},
    {id: 'hr-p60s', defaultEn: false, label: '1m Peak HR', get: x => x.stats.hr.peaks[60].avg, fmt: hr},

    {id: 'rideons', defaultEn: false, label: 'Ride Ons', get: x => x.state.rideons, fmt: num},
    {id: 'kj', defaultEn: false, label: 'Energy', get: x => x.state.kj, fmt: kj},
    {id: 'draft', defaultEn: false, label: 'Draft', get: x => x.state.draft, fmt: pct},

    {id: 'route', defaultEn: false, label: 'Route', get: x => getRouteMeta(x.state), fmt: fmtRoute},
    {id: 'group', defaultEn: false, label: 'Event', get: x => x.state.groupId, fmt: fmtEvent},

    {id: 'progress', defaultEn: false, label: 'Route %', get: x => x.state.progress * 100, fmt: pct},
    {id: 'workout-zone', defaultEn: false, label: 'WO Zone', get: x => x.state.workoutZone},
    {id: 'laps', defaultEn: false, label: 'Laps', get: x => x.state.laps},

    // Debugish fields.
    {id: 'course', defaultEn: false, label: 'Course', get: x => x.state.courseId},
    {id: 'road', defaultEn: false, label: 'Road', get: x => x.state.roadId},
];


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
    const setRefresh = () => refresh = (settings.refreshInterval || 1) * 1000 - 100; // within 100ms is fine.
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
        if (col) {
            const id = col.dataset.id;
            if (id === sortBy) {
                sortByDir = -sortByDir;
                common.storage.set('nearby-sort-dir', sortByDir);
            }
            sortBy = id;
            common.storage.set(`nearby-sort-by`, id);
            for (const td of table.querySelectorAll('td.sorted')) {
                td.classList.remove('sorted', 'sort-asc', 'sort-desc');
            }
            for (const td of table.querySelectorAll(`td[data-id="${sortBy}"]`)) {
                td.classList.add('sorted');
            }
            col.classList.add(sortByDir > 0 ? 'sort-asc' : 'sort-desc');
            renderData(nearbyData);
        }
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
                render();
                renderData(nearbyData);
            }
        }
    });
    refresh = setRefresh();
    let lastRefresh = 0;
    common.subscribe('nearby', data => {
        if (settings.onlyMarked) {
            data = data.filter(x => x.watching || (x.athlete && x.athlete.marked));
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
        render();
        renderData(nearbyData);
    }
}


function render() {
    document.documentElement.classList.toggle('autoscroll', settings.autoscroll);
    document.documentElement.style.setProperty('--font-scale', settings.fontScale || 1);
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
             class="${sortBy === x.id ? 'sorted ' + sortDirClass : ''}"
             >${x.label}<ms class="sort-asc">arrow_drop_up</ms><ms class="sort-desc">arrow_drop_down</ms></td>`).join('');
    mainRow = makeTableRow();
    mainRow.classList.add('watching');
    tbody.innerHTML = '';
    tbody.appendChild(mainRow);
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


function updateTableRow(row, info) {
    gentleClassToggle(row, 'marked', info.athlete && info.athlete.marked);
    gentleClassToggle(row, 'following', info.athlete && info.athlete.following);
    if (row.dataset.id !== '' + info.athleteId) {
        row.dataset.id = info.athleteId;
    }
    const tds = row.querySelectorAll('td');
    for (const [i, {id, get, fmt}] of enFields.entries()) {
        const value = get ? get(info) : info;
        const html = '' + (fmt ? fmt(value) : value);
        const td = tds[i + 1];
        if (td._html !== html) {
            td.innerHTML = (td._html = html);
        }
        gentleClassToggle(td, 'sorted', sortBy === id);
    }
    gentleClassToggle(row, 'hidden', false);
}


let nextAnimFrame;
let frames = 0;
function renderData(data) {
    if (!data || !data.length || document.hidden) {
        return;
    }
    const sortField = enFields.find(x => x.id === sortBy);
    const sortGet = sortField.sortValue || sortField.get;
    data.sort((a, b) => {
        const av = sortGet(a);
        const bv = sortGet(b);
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
    if (nextAnimFrame) {
        cancelAnimationFrame(nextAnimFrame);
    }
    nextAnimFrame = requestAnimationFrame(() => {
        nextAnimFrame = null;
        const centerIdx = data.findIndex(x => x.watching);
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
    });
}


export async function settingsMain() {
    common.initInteractionListeners();
    fieldStates = common.storage.get(fieldsKey);
    const form = document.querySelector('form#fields');
    form.addEventListener('input', ev => {
        const id = ev.target.name;
        fieldStates[id] = ev.target.checked;
        common.storage.set(fieldsKey, fieldStates);
    });
    const fieldsHtml = fields.map(x => `
        <label>
            <key>${x.label}</key>
            <input type="checkbox" name="${x.id}" ${fieldStates[x.id] ? 'checked' : ''}/>
        </label>
    `).join('');
    form.insertAdjacentHTML('beforeend', fieldsHtml);
    await common.initSettingsForm('form#options', {settingsKey})();
}
