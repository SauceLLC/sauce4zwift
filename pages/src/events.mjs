import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as elevationMod from './elevation.mjs';
import {render as profileRender} from './profile.mjs';

common.enableSentry();
common.settingsStore.setDefault({});

const settings = common.settingsStore.get();

let filterText;
let templates;
let nations;
let flags;
let worldList;
let gcs;
let selfAthlete;
let allRoutes;

const q = new URLSearchParams(window.location.search);
const chartRefs = new Set();
const allEvents = new Map();
const allSubgroups = new Map();
const contentEl = document.querySelector('#content');
const ioTHack = Array.from(new Array(1000)).map((_, i) => i / 999);
const headingsIntersectionObserver = new IntersectionObserver(onHeadingsIntersecting,
                                                              {root: contentEl, threshold: ioTHack});
const eventId = q.get('id') ? Number(q.get('id')) : null;
if (eventId != null) {
    document.documentElement.classList.add('single-event');
}


async function getTemplates(basenames) {
    return Object.fromEntries(await Promise.all(basenames.map(k =>
        sauce.template.getTemplate(`templates/${k}.html.tpl`).then(v =>
            // make it camelCase...
            [k.replace(/[-_/]+(.)/g, (_, x) => x.toUpperCase()), v]))));
}


async function loadEventsWithRetry() {
    // We don't have any events for, well, events, so just poll to handle
    // mutual startup races with backend.
    let data;
    for (let retry = 100;; retry += 100) {
        data = await common.rpc.getCachedEvents();
        if (data.length) {
            for (const x of data) {
                allEvents.set(x.id, x);
            }
            break;
        }
        await sauce.sleep(retry);
    }
    await fillInEvents();
}


async function loadEvent(id) {
    const event = await common.rpc.getEvent(id);
    allEvents.set(id, event);
    await fillInEvents();
}


const prettyRules = {
    NO_POWERUPS: 'No Powerups',
    NO_DRAFTING: 'No Drafting',
    NO_TT_BIKES: 'No TT Bikes',
    LADIES_ONLY: 'Ladies Only',
    MEN_ONLY: 'Men Only',
    SHOW_RACE_RESULTS: 'Show Results',
    ALLOWS_LATE_JOIN: 'Allow Late Join',
    RUBBERBANDING: 'Rubberbanding',
    ENFORCE_NO_ZPOWER: 'Power Meter Required',
    ONLY_ZPOWER: 'No Power Meter',
    ENFORCE_HRM: 'HRM Required'
};


let _routeListPromise;
async function fillInEvents() {
    if (!_routeListPromise) {
        _routeListPromise = common.getRouteList();
    }
    const routeList = await _routeListPromise;
    if (!allRoutes) {
        allRoutes = new Map();
        for (const x of routeList) {
            allRoutes.set(x.id, x);
        }
    }
    const tagFilterRe = /(^timestamp=|^created_|^after_party_duration=|^powerup_percent[=:])/;
    for (const event of allEvents.values()) {
        event.route = allRoutes.get(event.routeId);
        event.sameRoute = true;
        event.sameRouteName = true;
        event.signedUp = false;
        const durations = [];
        const distances = [];
        if (event.eventSubgroups) {
            event.eventSubgroups.sort((a, b) =>
                a.subgroupLabel === b.subgroupLabel ? 0 : a.subgroupLabel < b.subgroupLabel ? -1 : 1);
            event.sameRoute = (new Set(event.eventSubgroups.map(sg =>
                JSON.stringify([
                    sg.laps,
                    sg.distanceInMeters,
                    sg.durationInSeconds,
                    sg.routeId]
                )))).size === 1;
            event.sameRouteName = (new Set(event.eventSubgroups.map(sg => sg.routeId))).size === 1;
            event.signedUp = event.eventSubgroups.some(x => x.signedUp);
            for (const sg of event.eventSubgroups) {
                sg.route = allRoutes.get(sg.routeId);
                durations.push(sg.durationInSeconds);
                if (!sg.durationInSeconds) {
                    distances.push(sg.distanceInMeters || sg.routeDistance);
                }
                allSubgroups.set(sg.id, {sg, event});
                sg.displayTags = sg.allTags
                    .filter(x => !event.allTags.includes(x))
                    .filter(x => !x.match(tagFilterRe));
                sg.displayRules = sg.rulesSet
                    .filter(x => !event.rulesSet.includes(x))
                    .map(x => prettyRules[x] ?? x.toLowerCase());
            }
        } else {
            if (event.durationInSeconds) {
                durations.push(event.durationInSeconds);
            } else {
                distances.push(event.distanceInMeters || event.routeDistance);
            }
        }
        const desc = (a, b) => a - b;
        event.durations = Array.from(new Set(durations.filter(x => x))).sort(desc);
        event.distances = Array.from(new Set(distances.filter(x => x))).sort(desc);
        event.displayTags = event.allTags.filter(x => !x.match(tagFilterRe));
        event.displayRules = event.rulesSet.map(x => prettyRules[x] ?? x.toLowerCase());
    }
}


async function applyEventFilters(el=contentEl) {
    const hide = new Set();
    if (settings.filterType) {
        for (const x of allEvents.values()) {
            if (x.eventType !== settings.filterType) {
                hide.add('' + x.id);
            }
        }
    }
    if (filterText) {
        if (filterText.match(/^[0-9]{6,10}$/)) {
            const id = parseInt(filterText);
            for (const x of allEvents.keys()) {
                hide.add('' + x);
            }
            if (!allEvents.has(id)) {
                el.classList.add('loading');
                try {
                    const event = await common.rpc.getEvent(id);
                    allEvents.set(id, event);
                    await fillInEvents();
                    await render();
                } finally {
                    el.classList.remove('loading');
                }
            }
            hide.delete('' + id);
        } else {
            let re;
            try {
                re = new RegExp(filterText, 'i');
            } catch(e) {/*no-pragma*/}
            for (const x of allEvents.values()) {
                let text = `name:${x.name}\n` +
                           `type:${x.prettyType}\n` +
                           `description:${x.description}\n`;
                if (x.route?.name) {
                    text += `route:${x.route.name}\n`;
                }
                if (re ? !text.match(re) : !text.toLowerCase().includes(filterText)) {
                    hide.add('' + x.id);
                }
            }
        }
    }
    for (const x of el.querySelectorAll('table.events > tbody > tr.event-row')) {
        x.classList.toggle('hidden', hide.has(x.dataset.eventId));
    }
    await updateStatefulStyles(el);
}


async function updateStatefulStyles(el=contentEl) {
    const realTime = await common.getRealTime();
    for (const x of el.querySelectorAll('table.events > tbody > tr.event-row')) {
        const event = allEvents.get(Number(x.dataset.eventId));
        if (!event) {
            console.error("Internal Error");
            continue;
        }
        const joinable = event.ts + ((event.lateJoinInMinutes || 0) * 60_000) - realTime;
        const started = event.ts <= realTime;
        x.classList.toggle('started', started);
        x.classList.toggle('starts-soon', !started && (event.ts - realTime < 300_000));
        x.classList.toggle('signedup', event.signedUp);
        const startEl = x.querySelector('td.start');
        if (event.lateJoinInMinutes && joinable > 0) {
            x.classList.add('joinable');
            startEl.title = startEl.dataset.lateJoinTooltip;
        } else {
            x.classList.remove('joinable');
            startEl.title = startEl.getAttribute('title') || '';
        }
    }
    const soon = el.querySelector('table.events > tbody > tr.event-row:not(.hidden):not(.started)');
    if (!soon || !soon.classList.contains('soonest')) {
        el.querySelectorAll('table.events > tbody > tr.event-row.soonest')
            .forEach(x => x.classList.remove('soonest'));
        if (soon) {
            soon.classList.add('soonest');
        }
    }
}


function onHeadingsIntersecting(entries) {
    // Only operate on latest (last) entry if we queued..
    const it = entries[entries.length - 1];
    if (it.intersectionRect.top > it.rootBounds.top) {
        return;
    }
    const stickyEl = it.target.previousElementSibling;
    const stickyHeight = stickyEl.getBoundingClientRect().height;
    const offset = Math.max(0, stickyHeight - it.intersectionRect.height);
    if (stickyEl._intersectionOffset !== offset) {
        stickyEl._intersectionOffset = offset;
        stickyEl.style.setProperty('--intersection-offset', `${offset}px`);
        requestAnimationFrame(() => {
            stickyEl.style.setProperty('--intersection-offset', `${offset}px`);
        });
    }
}


export async function main() {
    common.initInteractionListeners();
    addEventListener('resize', resizeCharts);
    if (settings.filterType) {
        document.querySelector('#titlebar select[name="type"]').value = settings.filterType;
    }
    [,templates, {nations, flags}, worldList, gcs, selfAthlete] = await Promise.all([
        eventId != null ? loadEvent(eventId) : loadEventsWithRetry(),
        getTemplates([
            'events/list',
            'events/summary',
            'events/details',
            'events/subgroup',
            'profile',
        ]),
        common.initNationFlags(),
        common.getWorldList(),
        common.rpc.getGameConnectionStatus(),
        common.rpc.getAthlete('self'),
    ]);
    common.subscribe('status', x => (gcs = x), {source: 'gameConnection'});
    document.querySelector('#titlebar select[name="type"]').addEventListener('change', ev => {
        const type = ev.currentTarget.value;
        settings.filterType = type || undefined;
        common.settingsStore.set(null, settings);
        applyEventFilters();
    });
    document.querySelector('#titlebar input[name="filter"]').addEventListener('input', ev => {
        filterText = ev.currentTarget.value || undefined;
        applyEventFilters();
    });
    document.documentElement.addEventListener('click', async ev => {
        const loader = ev.target.closest('.events > .loader');
        if (!loader) {
            return;
        }
        let added;
        loader.classList.add('loading');
        try {
            if (loader.dataset.dir === 'prev') {
                added = await common.rpc.loadOlderEvents();
            } else {
                added = await common.rpc.loadNewerEvents();
            }
            for (const x of added) {
                allEvents.set(x.id, x);
            }
            await fillInEvents();
        } finally {
            loader.classList.remove('loading');
        }
        if (added && added.length) {
            await render();
        }
    });
    document.documentElement.addEventListener('click', async ev => {
        const button = ev.target.closest('.button[data-action]');
        if (!button) {
            return;
        }
        const action = button.dataset.action;
        if (action === 'signup' || action === 'unsignup') {
            const el = button.closest('[data-event-subgroup-id]');
            const sgId = Number(el.dataset.eventSubgroupId);
            const {sg, event} = allSubgroups.get(sgId);
            if (action === 'signup') {
                let accepted;
                try {
                    accepted = await common.rpc.addEventSubgroupSignup(sgId);
                } catch(e) {
                    console.warn('Signup error:', e.message);
                }
                if (!accepted) {
                    el.classList.remove('can-signup');
                    window.alert("Event subgroup rejected");
                } else {
                    sg.signedUp = event.signedUp = true;
                    el.parentElement.querySelectorAll(':scope > [data-event-subgroup-id]').forEach(x =>
                        x.classList.remove('can-signup'));
                    el.classList.add('signedup');
                    el.closest('tr.details').previousElementSibling.classList.add('signedup');
                }
            } else {
                await common.rpc.deleteEventSignup(event.id);
                sg.signedUp = event.signedUp = false;
                el.parentElement.querySelectorAll(':scope > [data-event-subgroup-id]').forEach(x =>
                    x.classList.add('can-signup'));
                el.classList.remove('signedup');
                el.closest('tr.details').previousElementSibling.classList.remove('signedup');
            }
        } else if (action === 'collapse-subgroup' || action === 'expand-subgroup') {
            const el = ev.target.closest('.event-subgroup');
            el.classList.toggle('collapsed');
        } else if (action === 'zrs-lookup') {
            const athleteId = Number(button.closest('tr[data-id]').dataset.id);
            const athlete = await common.rpc.getAthlete(athleteId, {refresh: true});
            button.outerHTML = sauce.locale.human.number(athlete.racingScore);
        }
    });
    await render();
    if (eventId != null) {
        contentEl.querySelector('table.events > tbody > tr.event-row').click();
    } else {
        const centerRow = contentEl.querySelector('table.events > tbody > ' +
                                                  'tr.event-row:not(.hidden):not(.started)');
        if (centerRow) {
            centerRow.scrollIntoView({block: 'center'});
        }
        setInterval(async () => {
            const data = await common.rpc.getCachedEvents();
            let modified;
            if (data.length) {
                for (const x of data) {
                    const existing = allEvents.get(x.id);
                    const signedUp = x.eventSubgroups.some(x => x.signedUp);
                    if (existing && existing.signedup !== signedUp) {
                        modified = true;
                        allEvents.set(x.id, x);
                    }
                }
                if (modified) {
                    await fillInEvents();
                    await updateStatefulStyles();
                }
            }
        }, 15_000);
    }
}


async function createElevationProfile(el, sg) {
    const elProfile = new elevationMod.SauceElevationProfile({
        el,
        worldList,
        preferRoute: true,
        disableAthletePoints: true,
    });
    await elProfile.setCourse(sg.courseId);
    await elProfile.setRoute(sg.routeId, {
        laps: sg.laps,
        distance: sg.distanceInMeters,
        eventSubgroupId: sg.id,
        hideLaps: true,
    });
    chartRefs.add(new WeakRef(elProfile.chart));
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


async function render() {
    const events = Array.from(allEvents.values());
    events.sort((a, b) => a.ts - b.ts);
    const frag = await templates.eventsList({
        templates,
        events,
        eventBadge: common.eventBadge,
    });
    const cleanupCallbacks = new Set();
    headingsIntersectionObserver.disconnect();
    common.initExpanderTable(frag.querySelector('table'), async (eventDetailsEl, eventSummaryEl) => {
        eventDetailsEl.innerHTML = '<h2><i>Loading...</i></h2>';
        const event = allEvents.get(Number(eventSummaryEl.dataset.eventId));
        const courseIds = new Set(event.eventSubgroups.map(x => x.courseId));
        console.debug('Opening event:', event);
        headingsIntersectionObserver.observe(eventDetailsEl.closest('tr'));
        eventDetailsEl.replaceChildren(await templates.eventsDetails({
            worlds: Array.from(courseIds).map(id => worldList.find(w => w.courseId === id)),
            event,
            eventBadge: common.eventBadge,
            templates,
        }));
        if (event.sameRoute) {
            const elChart = eventDetailsEl.querySelector('.elevation-chart');
            if (elChart) {
                createElevationProfile(elChart, event.eventSubgroups[0] || event);
            }
        }
        const realTime = await common.getRealTime();
        const loadingSubgroups = [];
        for (const el of eventDetailsEl.querySelectorAll('[data-event-subgroup-id]')) {
            const sg = event.eventSubgroups.find(x => x.id === Number(el.dataset.eventSubgroupId));
            const table = el.querySelector('table.entrants');
            const elChart = el.querySelector('.elevation-chart');
            if (elChart) {
                createElevationProfile(elChart, sg);
            }
            loadingSubgroups.push((async () => {
                let results, entrants, fieldSize;
                if (sg.eventSubgroupStart < realTime - 300_000) {
                    const maybeResults = await common.rpc.getEventSubgroupResults(sg.id);
                    if (maybeResults && maybeResults.length) {
                        results = maybeResults;
                        fieldSize = results.length;
                        el.classList.add('results');
                        table.classList.add('results');
                        console.debug("Subgroup results:", sg.id, maybeResults);
                    }
                }
                if (!results) {
                    if (sg.startOffset) {
                        const optEl = el.querySelector('header .optional-1');
                        optEl.title = 'Start offset';
                        optEl.innerHTML =
                            `<ms>timelapse</ms> +${sauce.locale.human.duration(sg.startOffset / 1000)}`;
                    }
                    el.classList.toggle('signedup', !!sg.signedUp);
                    el.classList.toggle('can-signup', !event.signedUp);
                    entrants = await common.rpc.getEventSubgroupEntrants(sg.id);
                    entrants.sort((a, b) =>
                        a.athlete?.lastName.toLowerCase() < b.athlete?.lastName.toLowerCase() ? -1 : 1);
                    entrants.sort((a, b) =>
                        !!b.athlete?.following - !!a.athlete?.following ||
                        !!b.athlete?.follower - !!a.athlete?.follower);
                    console.debug("Subgroup entrants:", sg.id, entrants);
                    fieldSize = entrants.length;
                    el.classList.add('signups');
                    table.classList.add('signups');
                }
                if (fieldSize != null) {
                    el.querySelector('.field-size').innerHTML = sauce.locale.human.number(fieldSize);
                }
                table.replaceChildren(await templates.eventsSubgroup({
                    event,
                    sg,
                    results: (results && results.length) ? results : undefined,
                    entrants,
                    selfAthlete,
                    fmtFlag: common.fmtFlag,
                    teamBadge: common.teamBadge,
                }));
                let cleanup;
                common.initExpanderTable(table, async (el, entrantSummaryEl) => {
                    const athleteId = Number(entrantSummaryEl.dataset.id);
                    const athlete = await common.rpc.getAthlete(athleteId, {refresh: true});
                    console.debug("Athlete:", athlete);
                    cleanup = await profileRender(el, templates.profile, {
                        embedded: true,
                        athleteId,
                        athlete,
                        gameConnection: gcs && gcs.connected,
                        nations,
                        flags,
                        common,
                        worldList,
                    });
                    cleanupCallbacks.add(cleanup);
                }, () => {
                    if (cleanup) {
                        cleanupCallbacks.delete(cleanup);
                        cleanup();
                    }
                });
                el.classList.remove('loading');
            })());
        }
        Promise.all(loadingSubgroups).then(resizeCharts);
        eventSummaryEl.scrollIntoView({block: 'start', behavior: 'smooth'});
    }, (el) => {
        headingsIntersectionObserver.unobserve(el);
        const cleanups = Array.from(cleanupCallbacks);
        cleanupCallbacks.clear();
        for (const cb of cleanups) {
            cb();
        }
    });
    await applyEventFilters(frag);
    contentEl.replaceChildren(frag);
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
