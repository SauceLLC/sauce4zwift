import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import {render as profileRender} from './profile.mjs';

common.enableSentry();
common.settingsStore.setDefault({});

let filterText;
let filterType;

const allEvents = new Map();
const contentEl = document.querySelector('#content');
let gcs;
let eventDetailTpl;
let profileTpl;

const athletes = new Map();
const pendingNationInit = common.initNationFlags();

const _fetchingRoutes = new Map();
async function getRoute(id) {
    if (!_fetchingRoutes.has(id)) {
        _fetchingRoutes.set(id, common.rpc.getRoute(id));
    }
    return await _fetchingRoutes.get(id);
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
    for (const x of data) {
        allEvents.set(x.id, x);
    }
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
            const text = `name:${x.name} type:${x.eventType.replace(/_/g, ' ')} description:${x.description}`;
            if (re ? !text.match(re) : !text.toLowerCase().includes(filterText)) {
                hide.add('' + x.id);
            }
        }
    }
    for (const x of el.querySelectorAll('table.events > tbody > tr[data-event-id]')) {
        x.classList.toggle('hidden', hide.has(x.dataset.eventId));
    }
}


export async function main() {
    common.initInteractionListeners();
    eventDetailTpl = await sauce.template.getTemplate(`templates/event-details.html.tpl`);
    profileTpl = await sauce.template.getTemplate(`templates/profile.html.tpl`);
    gcs = await common.rpc.getGameConnectionStatus();
    common.subscribe('status', x => (gcs = x), {source: 'gameConnection'});
    await loadEventsWithRetry();
    await render();
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
    const nearest = contentEl.querySelector('table.events > tbody > tr[data-event-id]:not(.started)');
    if (nearest) {
        nearest.scrollIntoView();
    }
}


async function render() {
    const eventsTpl = await sauce.template.getTemplate(`templates/events.html.tpl`);
    const events = Array.from(allEvents.values());
    events.sort((a, b) => a.ts - b.ts);
    const frag = await eventsTpl({
        events,
        eventBadge: common.eventBadge,
    });
    const cleanupCallbacks = new Set();
    common.initExpanderTable(frag.querySelector('table'), async (eventDetailsEl, eventSummaryEl) => {
        const event = allEvents.get(Number(eventSummaryEl.dataset.eventId));
        const route = await getRoute(event.routeId);
        const worldList = await common.getWorldList();
        const world = worldList.find(x =>
            event.mapId ? x.worldId === event.mapId : x.stringId === route.world);
        const subgroups = event.eventSubgroups ? await Promise.all(event.eventSubgroups.map(async sg => {
            const entrants = await common.rpc.getEventSubgroupEntrants(sg.id);
            const sgRoute = await getRoute(sg.routeId);
            for (const x of entrants) {
                athletes.set(x.id, x.athlete);
            }
            return {...sg, route: sgRoute, entrants};
        })) : [];
        await Promise.all(subgroups.map(async x => {
            if (x.eventSubgroupStart < Date.now()) {
                x.results = await common.rpc.getEventSubgroupResults(x.id);
            }
        }));
        console.info(event, subgroups);
        eventDetailsEl.append(await eventDetailTpl({
            event,
            world: world ? world.name : '',
            route,
            subgroups,
            teamBadge: common.teamBadge,
            eventBadge: common.eventBadge
        }));
        const {nations, flags} = await pendingNationInit;
        for (const t of eventDetailsEl.querySelectorAll('table.expandable')) {
            let cleanup;
            common.initExpanderTable(t, async (el, entrantSummaryEl) => {
                const athleteId = Number(entrantSummaryEl.dataset.id);
                cleanup = await profileRender(el, profileTpl, {
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
