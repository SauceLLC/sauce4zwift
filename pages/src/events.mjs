import * as sauce from '../../shared/sauce/index.mjs';
import * as common from './common.mjs';
import {render as athleteRender} from './athlete.mjs';

const L = sauce.locale;
//const H = L.human;
//const settingsKey = 'events-settings-v1';
const events = new Map();
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
    const pendingNationInit = common.initNationFlags();
    let gameConnectionStatus = await common.rpc.getGameConnectionStatus();
    common.subscribe('status', gcs => (gameConnectionStatus = gcs), {source: 'gameConnection'});
    common.storage.addEventListener('globalupdate', ev => {
        if (ev.data.key === '/imperialUnits') {
            L.setImperial(imperial = ev.data.value);
        }
    });
    //settings = common.storage.get(settingsKey, {});
    const contentEl = await render();
    const eventDetailTpl = await sauce.template.getTemplate(`templates/event-details.html.tpl`);
    const athleteDetailTpl = await sauce.template.getTemplate(`templates/athlete.html.tpl`);
    const athletes = new Map();
    initExpanderTable(contentEl.querySelector('table'), async (eventDetailsEl, eventSummaryEl) => {
        const event = events.get(Number(eventSummaryEl.dataset.eventId));
        const subgroups = await Promise.all(event.eventSubgroups.map(async sg => {
            const entrants = await common.rpc.getEventSubgroupEntrants(sg.id);
            for (const x of entrants) {
                athletes.set(x.id, x.athlete);
            }
            return {...sg, entrants};
        }));
        eventDetailsEl.append(await eventDetailTpl({event, subgroups, teamBadge: common.teamBadge, eventBadge: common.eventBadge}));
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


async function render() {
    const eventsTpl = await sauce.template.getTemplate(`templates/events.html.tpl`);
    for (const x of await common.rpc.getEvents()) {
        events.set(x.id, x);
    }
    const frag = await eventsTpl({events: Array.from(events.values())});
    const contentEl = document.querySelector('#content');
    contentEl.innerHTML = '';
    contentEl.append(frag);
    return contentEl;
}
