import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import {render as profileRender} from './profile.mjs';

const L = sauce.locale;
//const H = L.human;
common.settingsStore.setDefault({});
const imperial = common.settingsStore.get('/imperialUnits');
L.setImperial(imperial);


const _fetchingRoutes = new Map();
async function getRoute(id) {
    if (!_fetchingRoutes.has(id)) {
        _fetchingRoutes.set(id, common.rpc.getRoute(id));
    }
    return await _fetchingRoutes.get(id);
}


async function getEventsWithRetry() {
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
    const now = Date.now();
    const events = new Map();
    for (const x of data) {
        x.started = x.ts < now;
        events.set(x.id, x);
    }
    return events;
}


export async function main() {
    common.initInteractionListeners();
    const pendingNationInit = common.initNationFlags();
    let gcs = await common.rpc.getGameConnectionStatus();
    common.subscribe('status', x => (gcs = x), {source: 'gameConnection'});
    const events = await getEventsWithRetry();
    const contentEl = await render(events);
    const eventDetailTpl = await sauce.template.getTemplate(`templates/event-details.html.tpl`);
    const profileTpl = await sauce.template.getTemplate(`templates/profile.html.tpl`);
    const athletes = new Map();
    const cleanupCallbacks = new Set();
    common.initExpanderTable(contentEl.querySelector('table'), async (eventDetailsEl, eventSummaryEl) => {
        const event = events.get(Number(eventSummaryEl.dataset.eventId));
        if (!event.routeId) {
            debugger;
        }
        const route = await getRoute(event.routeId);
        const worldList = await common.getWorldList();
        const world = worldList.find(x =>
            event.mapId ? x.worldId === event.mapId : x.stringId === route.world);
        const subgroups = await Promise.all(event.eventSubgroups.map(async sg => {
            const entrants = await common.rpc.getEventSubgroupEntrants(sg.id);
            const sgRoute = await getRoute(sg.routeId);
            for (const x of entrants) {
                athletes.set(x.id, x.athlete);
            }
            return {...sg, route: sgRoute, entrants};
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
    document.querySelector('#titlebar input[name="filter"]').addEventListener('input', ev => {
        const hide = new Set();
        const search = ev.currentTarget.value;
        let re;
        try {
            re = search && new RegExp(search, 'i');
        } catch(e) {/*no-pragma*/}
        if (re) {
            for (const x of events.values()) {
                const text = `${x.name} ${x.eventType.replace(/_/g, ' ')} ${x.description}`;
                if (!text.match(re)) {
                    hide.add(x.id);
                }
            }
        } else if (search) {
            for (const x of events.values()) {
                const text = `${x.name} ${x.eventType.replace(/_/g, ' ')} ${x.description}`;
                if (!text.toLowerCase().includes()) {
                    hide.add(x.id);
                }
            }
        }
        for (const el of contentEl.querySelectorAll('table.events > tbody > tr[data-event-id]')) {
            el.classList.toggle('hidden', hide.has(Number(el.dataset.eventId)));
        }
    });
    const nearest = contentEl.querySelector('table.events > tbody > tr[data-event-id]:not(.started)');
    if (nearest) {
        nearest.scrollIntoView();
    }
}


async function render(events) {
    const eventsTpl = await sauce.template.getTemplate(`templates/events.html.tpl`);
    const frag = await eventsTpl({
        events: Array.from(events.values()),
        eventBadge: common.eventBadge,
    });
    const contentEl = document.querySelector('#content');
    contentEl.replaceChildren(frag);
    return contentEl;
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
