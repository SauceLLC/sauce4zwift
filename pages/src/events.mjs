import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import * as elevationMod from './elevation.mjs';
import {render as profileRender} from './profile.mjs';

common.enableSentry();
common.settingsStore.setDefault({});

let filterText;
let filterType;
let templates;
let nations;
let flags;
let worldList;
let gcs;

const chartRefs = new Set();
const allEvents = new Map();
const contentEl = document.querySelector('#content');
const athletes = new Map();


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
    // We don't have any events for, well, events, so just poll to handle
    // mutual startup races with backend.
    let data;
    for (let retry = 100;; retry += 100) {
        data = await common.rpc.getEvents();
        if (data.length) {
            break;
        }
        await sauce.sleep(retry);
    }
    await Promise.all(data.map(async x => {
        allEvents.set(x.id, x);
        x.route = await getRoute(x.routeId);
        if (x.eventSubgroups) {
            for (const sg of x.eventSubgroups) {
                sg.route = await getRoute(sg.routeId);
            }
        }
    }));
}


function applyEventFilters(el) {
    const hide = new Set();
    if (filterType) {
        for (const x of allEvents.values()) {
            if (x.eventType !== filterType) {
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
    [,templates, {nations, flags}, worldList, gcs] = await Promise.all([
        loadEventsWithRetry(),
        getTemplates([
            'events/list',
            'events/summary',
            'events/details',
            'profile',
        ]),
        common.initNationFlags(),
        common.getWorldList(),
        common.rpc.getGameConnectionStatus(),
    ]);
    common.subscribe('status', x => (gcs = x), {source: 'gameConnection'});
    document.querySelector('#titlebar select[name="type"]').addEventListener('change', ev => {
        const type = ev.currentTarget.value;
        filterType = type || undefined;
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
        if (action === 'signup') {
            const sgId = Number(button.closest('[data-event-subgroup-id]').dataset.eventSubgroupId);
            await common.rpc.addEventSubgroupSignup(sgId);
            // XXX
            await loadEventsWithRetry();
            await render(); // XXX
        } else if (action === 'unsignup') {
            const eventId = Number(button.closest('[data-event-id]').dataset.eventId);
            await common.rpc.deleteEventSignup(eventId);
            // XXX
            await loadEventsWithRetry();
            await render(); // XXX
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
        const event = allEvents.get(Number(eventSummaryEl.dataset.eventId));
        const world = worldList.find(x =>
            event.mapId ? x.worldId === event.mapId : x.stringId === event.route.world);
        const subgroups = event.eventSubgroups ? await Promise.all(event.eventSubgroups.map(async sg => {
            const entrants = await common.rpc.getEventSubgroupEntrants(sg.id);
            for (const x of entrants) {
                athletes.set(x.id, x.athlete);
            }
            return {...sg, entrants};
        })) : [];
        await Promise.all(subgroups.map(async x => {
            if (x.eventSubgroupStart < Date.now()) {
                x.results = await common.rpc.getEventSubgroupResults(x.id);
            }
        }));
        console.info(event, subgroups);
        eventDetailsEl.append(await templates.eventsDetails({
            world: world ? world.name : '',
            event,
            subgroups,
            teamBadge: common.teamBadge,
            eventBadge: common.eventBadge,
            fmtFlag: common.fmtFlag,
        }));
        for (const el of eventDetailsEl.querySelectorAll('.elevation-chart[data-sg-id]')) {
            const sg = subgroups.find(x => x.id === Number(el.dataset.sgId));
            console.log({sg});
            createElevationProfile(el, sg);
        }
        resizeCharts();
        eventSummaryEl.scrollIntoView({block: 'start'});
        for (const t of eventDetailsEl.querySelectorAll('table.expandable')) {
            let cleanup;
            common.initExpanderTable(t, async (el, entrantSummaryEl) => {
                const athleteId = Number(entrantSummaryEl.dataset.id);
                cleanup = await profileRender(el, templates.profile, {
                    embedded: true,
                    athleteId,
                    athlete: athletes.get(athleteId),
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
        }
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


addEventListener('resize', resizeCharts);
