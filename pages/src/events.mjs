import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';

const doc = document.documentElement;
const L = sauce.locale;
const H = L.human;
const num = H.number;
const settingsKey = 'events-settings-v1';
const events = new Map();
let imperial = common.storage.get('/imperialUnits');
L.setImperial(imperial);
let eventSite = common.storage.get('/externalEventSite', 'zwift');
let settings;
let nations;
let flags;
let gameControlEnabled;
let gameControlConnected;

const unit = x => `<abbr class="unit">${x}</abbr>`;
const spd = v => H.pace(v, {precision: 0, suffix: true, html: true});
const weightClass = v => H.weightClass(v, {suffix: true, html: true});
const pwr = v => H.power(v, {suffix: true, html: true});
const hr = v => v ? num(v) + unit('bpm') : '-';
const kj = v => v != null ? num(v) + unit('kJ') : '-';
const pct = v => (v != null && !isNaN(v)) ? num(v) + unit('%') : '-';
//const gapTime = (v, entry) => (H.duration(v, {short: true, html: true}) + (entry.isGapEst ? '<small> (est)</small>' : ''));
const gapTime = (v, entry) => ((v < 0 ? '-' : '') + H.timer(Math.abs(v)) + (entry.isGapEst ? '<small> (est)</small>' : ''));


const badgeHues = {
    A: 0,
    B: 90,
    C: 180,
    D: 60,
    E: 260,
};


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
    if (v == null || v === Infinity || v === -Infinity || isNaN(v)) {
        return '-';
    } else if (Math.abs(v) < 1000) {
        const suffix = unit(imperial ? 'ft' : 'm');
        return H.number(imperial ? v / L.metersPerFoot : v) + suffix;
    } else {
        return H.distance(v, {precision: 1, suffix: true, html: true});
    }
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
    return (wkg !== Infinity && wkg !== -Infinity && !isNaN(wkg)) ?
        num(wkg, {precision: 1, fixed: true}) + unit('w/kg') :
        '-';
}


function fmtName(name, entry) {
    let badge;
    const sgid = entry.state.eventSubgroupId;
    if (sgid) {
        const sg = lazyGetSubgroup(sgid);
        if (sg) {
            badge = makeEventBadge(sg);
        }
    }
    return athleteLink(entry.athleteId, (badge || '') + sanitize(name || '-'));
}


function fmtInitials(initials, entry) {
    let badge;
    const sgid = entry.state.eventSubgroupId;
    if (sgid) {
        const sg = lazyGetSubgroup(sgid);
        if (sg) {
            badge = makeEventBadge(sg, sgid);
        }
    }
    return athleteLink(entry.athleteId, (badge || '') + sanitize(initials || '-'));
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


function makeEventBadge(sg) {
    if (!sg.subgroupLabel) {
        return;
    }
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
    const sg = lazyGetSubgroup(sgid);
    if (sg) {
        return `<a href="${eventUrl(sg.event.id)}" target="_blank" external>${sg.event.name}</a>`;
    } else {
        return '...';
    }
}


function getRoute({state}) {
    if (state.eventSubgroupId) {
        const sg = lazyGetSubgroup(state.eventSubgroupId);
        if (sg) {
            return {route: sg.route, laps: sg.laps};
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


function initExpanderTable(table, detailsCallback) {
    table.querySelector('tbody').addEventListener('click', ev => {
        const row = ev.target.closest('tr');
        if (!row || row.closest('table') !== table) {
            return;
        }
        if (row.classList.contains('summary')) {
            table.querySelectorAll(':scope > tbody > tr.expanded').forEach(x => x.classList.remove('expanded'));
            const el = row.nextElementSibling.querySelector('.container');
            el.innerHTML = '';
            row.classList.add('expanded');
            detailsCallback(el, row);
        }
    });
}


export async function main() {
    common.initInteractionListeners();
    lazyInitNationMeta();  // bg okay
    const gcs = await common.rpc.getGameConnectionStatus();
    gameControlEnabled = gcs != null;
    gameControlConnected = gcs && gcs.connected;
    common.subscribe('status', gcs => {
        gameControlConnected = gcs && gcs.connected;
    }, {source: 'gameConnection'});
    common.storage.addEventListener('globalupdate', ev => {
        if (ev.data.key === '/imperialUnits') {
            L.setImperial(imperial = ev.data.value);
        } else if (ev.data.key === '/exteranlEventSite') {
            eventSite = ev.data.value;
        }
    });
    settings = common.storage.get(settingsKey, {});
    const contentEl = await render();
    const eventDetailTpl = await sauce.template.getTemplate(`templates/event-details.html.tpl`);
    initExpanderTable(contentEl.querySelector('table'), async (eventDetailsEl, eventSummaryEl) => {
        const event = events.get(Number(eventSummaryEl.dataset.eventId));
        const subgroups = await Promise.all(event.eventSubgroups.map(sg =>
            common.rpc.getEventSubgroupEntrants(sg.id).then(entrants =>
                ({...sg, entrants}))));
        eventDetailsEl.appendChild(await eventDetailTpl({event, subgroups, badgeHues}));
        for (const t of eventDetailsEl.querySelectorAll('table.expandable')) {
            initExpanderTable(t, async (entrantDetailsEl, entrantSummaryEl) => {
                const athleteId = Number(entrantSummaryEl.dataset.id);
                entrantDetailsEl.innerHTML = `<iframe src="./athlete.html?athleteId=${athleteId}&embed"></iframe>`;
            });
        }
    });
}


async function render() {
    const eventsTpl = await sauce.template.getTemplate(`templates/events.html.tpl`);
    for (const x of await common.rpc.getEvents()) {
        events.set(x.id, x);
    }
    const frag = await eventsTpl({events: Array.from(events.values())});
    const contentEl = document.querySelector('#content');
    contentEl.innerHTML = '';
    contentEl.appendChild(frag);
    return contentEl;
}
