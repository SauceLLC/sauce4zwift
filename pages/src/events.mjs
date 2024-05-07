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

const chartRefs = new Set();
const allEvents = new Map();
const allSubgroups = new Map();
const contentEl = document.querySelector('#content');


const _fetchingRoutes = new Map();
async function getRoute(id) {
    if (!_fetchingRoutes.has(id)) {
        _fetchingRoutes.set(id, common.rpc.getRoute(id));
    }
    return await _fetchingRoutes.get(id);
}


async function getTemplates(basenames) {
    return Object.fromEntries(await Promise.all(basenames.map(k =>
        sauce.template.getTemplate(`templates/${k}.html.tpl`).then(v =>
            // make it camelCase...
            [k.replace(/[-_/]+(.)/g, (_, x) => x.toUpperCase()), v]))));
}


async function loadEventsWithRetry() {
    // We don't have any events for, well, Events, so just poll to handle
    // mutual startup races with backend.
    let data;
    for (let retry = 1; retry < 10; retry++) {
        data = await common.rpc.getCachedEvents();
        if (data.length) {
            for (const x of data) {
                allEvents.set(x.id, x);
            }
            break;
        }
        await sauce.sleep(retry * 100);
    }
    await fillInEvents();
}


async function fillInEvents() {
    await Promise.all(Array.from(allEvents.values()).map(async event => {
        event.route = await getRoute(event.routeId);
        event.sameRoute = true;
        event.signedUp = false;
        if (event.eventSubgroups) {
            event.sameRoute = (new Set(event.eventSubgroups.map(sg =>
                JSON.stringify([
                    sg.laps,
                    sg.distanceInMeters,
                    sg.durationInSeconds,
                    sg.routeId]
                )))).size === 1;
            event.signedUp = event.eventSubgroups.some(x => x.signedUp);
            for (const sg of event.eventSubgroups) {
                sg.route = await getRoute(sg.routeId);
                allSubgroups.set(sg.id, {sg, event});
            }
        }
    }));
}


function applyEventFilters(el) {
    const hide = new Set();
    if (settings.filterType) {
        for (const x of allEvents.values()) {
            if (x.eventType !== settings.filterType) {
                hide.add('' + x.id);
            }
        }
    }
    if (filterText) {
        let re;
        try {
            re = new RegExp(filterText, 'i');
        } catch(e) {/*no-pragma*/}
        for (const x of allEvents.values()) {
            const text = `name:${x.name}\n` +
                         `type:${x.eventType.replace(/_/g, ' ')}\n` +
                         `description:${x.description}`;
            if (re ? !text.match(re) : !text.toLowerCase().includes(filterText)) {
                hide.add('' + x.id);
            }
        }
    }
    for (const x of el.querySelectorAll('table.events > tbody > tr.summary[data-event-id]')) {
        x.classList.toggle('hidden', hide.has(x.dataset.eventId));
    }
}


export async function main() {
    common.initInteractionListeners();
    addEventListener('resize', resizeCharts);
    if (settings.filterType) {
        document.querySelector('#titlebar select[name="type"]').value = settings.filterType;
    }
    [,templates, {nations, flags}, worldList, gcs, selfAthlete] = await Promise.all([
        loadEventsWithRetry(),
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
        applyEventFilters(contentEl);
    });
    document.querySelector('#titlebar input[name="filter"]').addEventListener('input', ev => {
        filterText = ev.currentTarget.value || undefined;
        applyEventFilters(contentEl);
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
        try {
            if (action === 'signup' || action === 'unsignup') {
                const el = button.closest('[data-event-subgroup-id]');
                const sgId = Number(el.dataset.eventSubgroupId);
                const {sg, event} = allSubgroups.get(sgId);
                if (action === 'signup') {
                    await common.rpc.addEventSubgroupSignup(sgId);
                    sg.signedUp = event.signedUp = true;
                    el.parentElement.querySelectorAll(':scope > [data-event-subgroup-id]').forEach(x =>
                        x.classList.remove('can-signup'));
                    el.classList.add('signedup');
                    el.closest('tr.details').previousElementSibling.classList.add('signedup');
                } else {
                    await common.rpc.deleteEventSignup(event.id);
                    sg.signedUp = event.signedUp = false;
                    el.parentElement.querySelectorAll(':scope > [data-event-subgroup-id]').forEach(x =>
                        x.classList.add('can-signup'));
                    el.classList.remove('signedup');
                    el.closest('tr.details').previousElementSibling.classList.remove('signedup');
                }
            }
        } catch(e) {
            // XXX
            alert(e.message);
        }
    });
    await render();
    const nearest = contentEl.querySelector('table.events > tbody > tr.summary[data-event-id]:not(.started)');
    if (nearest) {
        nearest.scrollIntoView({block: 'center'});
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
    common.initExpanderTable(frag.querySelector('table'), async (eventDetailsEl, eventSummaryEl) => {
        eventDetailsEl.innerHTML = '<h2><i>Loading...</i></h2>';
        const event = allEvents.get(Number(eventSummaryEl.dataset.eventId));
        const world = worldList.find(x =>
            event.mapId ? x.worldId === event.mapId : x.stringId === event.route.world);
        console.debug('Opening event:', event);
        eventDetailsEl.replaceChildren(await templates.eventsDetails({
            world: world ? world.name : '',
            event,
            eventBadge: common.eventBadge,
            templates,
        }));
        for (const el of eventDetailsEl.querySelectorAll('[data-event-subgroup-id]')) {
            const sg = event.eventSubgroups.find(x => x.id === Number(el.dataset.eventSubgroupId));
            const table = el.querySelector('table.entrants');
            const elChart = el.querySelector('.elevation-chart');
            if (elChart) {
                createElevationProfile(elChart, sg);
            }
            (async () => {
                let results, entrants, fieldSize;
                if (sg.eventSubgroupStart < (Date.now() - (300 * 1000))) {
                    const maybeResults = await common.rpc.getEventSubgroupResults(sg.id);
                    if (maybeResults && maybeResults.length) {
                        results = maybeResults;
                        fieldSize = results.length;
                        el.classList.add('results');
                        table.classList.add('results');
                    }
                }
                if (!results) {
                    if (sg.startOffset) {
                        el.querySelector('header .optional-1').innerHTML =
                            `Starts: +${sauce.locale.human.duration(sg.startOffset / 1000)}`;
                    }
                    el.classList.toggle('signedup', !!sg.signedUp);
                    el.classList.toggle('can-signup', !event.signedUp);
                    entrants = await common.rpc.getEventSubgroupEntrants(sg.id);
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
                    cleanup = await profileRender(el, templates.profile, {
                        embedded: true,
                        athleteId,
                        athlete: await common.rpc.getAthlete(athleteId, {allowFetch: true}),
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
            })();
        }
        resizeCharts();
        eventSummaryEl.scrollIntoView({block: 'start'});
    }, () => {
        const cleanups = Array.from(cleanupCallbacks);
        cleanupCallbacks.clear();
        for (const cb of cleanups) {
            cb();
        }
    });
    applyEventFilters(frag);
    contentEl.replaceChildren(frag);
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
