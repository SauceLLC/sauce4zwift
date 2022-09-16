import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import {render as athleteRender} from './athlete.mjs';

const L = sauce.locale;
//const H = L.human;
//const settingsKey = 'events-settings-v1';
let imperial = common.storage.get('/imperialUnits');
L.setImperial(imperial);
//let settings;

//const weightClass = v => H.weightClass(v, {suffix: true, html: true});


function initExpanderTable(table, detailsCallback) {
    table.querySelector('tbody').addEventListener('click', ev => {
        const row = ev.target.closest('tr');
        if (!row || row.closest('table') !== table) {
            return;
        }
        if (row.classList.contains('summary')) {
            const shouldCollapse = row.classList.contains('expanded');
            table.querySelectorAll(':scope > tbody > tr.expanded').forEach(x => x.classList.remove('expanded'));
            const el = row.nextElementSibling.querySelector('.container');
            el.innerHTML = '';
            if (!shouldCollapse) {
                row.classList.add('expanded');
                detailsCallback(el, row);
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
        if (x.ts < now - 60 * 60 * 1000) {
            continue;
        }
        x.started = x.ts < now;
        console.debug('event', x);
        events.set(x.id, x);
    }
    return events;
}


export async function main() {
    common.initInteractionListeners();
    const pendingNationInit = common.initNationFlags();
    let gameConnectionStatus = await common.rpc.getGameConnectionStatus();
    common.subscribe('status', gcs => (gameConnectionStatus = gcs), {source: 'gameConnection'});
    common.storage.addEventListener('globalupdate', ev => {
        if (ev.data.key === '/imperialUnits') {
            L.setImperial(imperial = ev.data.value);
        }
    });
    //settings = common.storage.get(settingsKey, {});
    const events = await getEventsWithRetry();
    const contentEl = await render(events);
    const eventDetailTpl = await sauce.template.getTemplate(`templates/event-details.html.tpl`);
    const athleteDetailTpl = await sauce.template.getTemplate(`templates/athlete.html.tpl`);
    const athletes = new Map();
    initExpanderTable(contentEl.querySelector('table'), async (eventDetailsEl, eventSummaryEl) => {
        const event = events.get(Number(eventSummaryEl.dataset.eventId));
        if (!event.routeId) {
            debugger;
        }
        const route = await getRoute(event.routeId);
        const world = common.worldToNames[event.mapId || common.identToWorldId[route.world]];
        console.log('route', route);
        const subgroups = await Promise.all(event.eventSubgroups.map(async sg => {
            const entrants = await common.rpc.getEventSubgroupEntrants(sg.id);
            const route = await getRoute(sg.routeId);
            console.log('route', route);
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
            initExpanderTable(t, async (entrantDetailsEl, entrantSummaryEl) => {
                const athleteId = Number(entrantSummaryEl.dataset.id);
                await athleteRender(entrantDetailsEl, athleteDetailTpl, {
                    athleteId,
                    athlete: athletes.get(athleteId),
                    gameConnectionStatus,
                    nations,
                    flags,
                });
            });
        }
    });
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
