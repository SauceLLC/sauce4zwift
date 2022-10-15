import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import {render as profileRender} from './profile.mjs';

const L = sauce.locale;
//const H = L.human;
common.settingsStore.setDefault({});
let imperial = common.settingsStore.get('/imperialUnits');
L.setImperial(imperial);


function initExpanderTable(table, expandCallback, cleanupCallback) {
    let active;
    table.querySelector('tbody').addEventListener('click', ev => {
        if (ev.target.closest('a')) {
            return;
        }
        const row = ev.target.closest('tr');
        if (!row || row.closest('table') !== table) {
            return;
        }
        if (row.classList.contains('summary')) {
            if (active) {
                if (cleanupCallback) {
                    cleanupCallback(...active);
                }
                active = null;
            }
            const shouldCollapse = row.classList.contains('expanded');
            table.querySelectorAll(':scope > tbody > tr.expanded').forEach(x => x.classList.remove('expanded'));
            const el = row.nextElementSibling.querySelector('.container');
            el.innerHTML = '';
            if (!shouldCollapse) {
                row.classList.add('expanded');
                expandCallback(el, row);
                active = [el, row];
            }
        }
    });
}


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
        const ts = new Date(x.eventStart).getTime();
        if (ts < now - 60 * 60 * 1000) {
            continue;
        }
        x.started = ts < now;
        events.set(x.id, x);
    }
    return events;
}


export async function main() {
    common.initInteractionListeners();
    const pendingNationInit = common.initNationFlags();
    let gameConnectionStatus = await common.rpc.getGameConnectionStatus();
    common.subscribe('status', gcs => (gameConnectionStatus = gcs), {source: 'gameConnection'});
    const events = await getEventsWithRetry();
    const contentEl = await render(events);
    const eventDetailTpl = await sauce.template.getTemplate(`templates/event-details.html.tpl`);
    const profileTpl = await sauce.template.getTemplate(`templates/profile.html.tpl`);
    const athletes = new Map();
    const cleanupCallbacks = new Set();
    initExpanderTable(contentEl.querySelector('table'), async (eventDetailsEl, eventSummaryEl) => {
        const event = events.get(Number(eventSummaryEl.dataset.eventId));
        if (!event.routeId) {
            debugger;
        }
        const route = await getRoute(event.routeId);
        const world = common.worldToNames[event.mapId || common.identToWorldId[route.world]];
        const subgroups = await Promise.all(event.eventSubgroups.map(async sg => {
            const entrants = await common.rpc.getEventSubgroupEntrants(sg.id);
            const route = await getRoute(sg.routeId);
            for (const x of entrants) {
                athletes.set(x.id, x.athlete);
            }
            return {...sg, route, entrants};
        }));
        eventDetailsEl.append(await eventDetailTpl({
            event,
            world,
            route,
            subgroups,
            teamBadge: common.teamBadge,
            eventBadge: common.eventBadge
        }));
        const {nations, flags} = await pendingNationInit;
        for (const t of eventDetailsEl.querySelectorAll('table.expandable')) {
            let cleanup;
            initExpanderTable(t, async (el, entrantSummaryEl) => {
                const athleteId = Number(entrantSummaryEl.dataset.id);
                cleanup = await profileRender(el, profileTpl, {
                    athleteId,
                    athlete: athletes.get(athleteId),
                    gameConnectionStatus,
                    nations,
                    flags,
                    common,
                    embedded: true,
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
                if (!(`${x.name} ${x.type.replace(/_/g, ' ')} ${x.description}`).match(re)) {
                    hide.add(x.id);
                }
            }
        } else if (search) {
            for (const x of events.values()) {
                if (!(`${x.name} ${x.type.replace(/_/g, ' ')} ${x.description}`).toLowerCase().includes()) {
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
    contentEl.innerHTML = '';
    contentEl.append(frag);
    return contentEl;
}


export async function settingsMain() {
    common.initInteractionListeners();
    await common.initSettingsForm('form')();
}
