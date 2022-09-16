import * as common from './common.mjs';
import {locale, template} from '../../shared/sauce/index.mjs';

const queryParams = new URLSearchParams(location.search);

const H = locale.human;
const athleteId = Number(queryParams.get('athleteId'));
let gettingAthlete;
let gettingTemplate;
let gettingGameConnectionStatus;
let pendingInitNationFlags;


export function init() {
    gettingAthlete = common.rpc.getAthlete(athleteId || 1, {refresh: true});
    gettingTemplate = template.getTemplate('templates/athlete.html.tpl');
    gettingGameConnectionStatus = common.rpc.getGameConnectionStatus();
    pendingInitNationFlags = common.initNationFlags();
    locale.setImperial(common.storage.get('/imperialUnits'));
    addEventListener('DOMContentLoaded', main);
}


export async function main() {
    common.initInteractionListeners();
    const athlete = await gettingAthlete;
    const tpl = await gettingTemplate;
    const gameConnectionStatus = await gettingGameConnectionStatus;
    const {nations, flags} = await pendingInitNationFlags;
    const debug = location.search.includes('debug');
    const tplData = {
        debug,
        athleteId,
        athlete,
        gameConnectionStatus,
        nations,
        flags,
        common,
    };
    const main = document.querySelector('body > main');
    await render(main, tpl, tplData);
}


function handleWPrimeEdit(el, {athleteId, athlete}, rerender) {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = athlete.wPrime;
    el.replaceChildren(input);
    let done;
    input.focus();
    document.addEventListener('keydown', async ev => {
        if (done) {
            return;
        }
        if (ev.key === 'Enter') {
            done = true;
            const wPrime = Number(input.value);
            if (isNaN(wPrime)) {
                alert('Invalid number');
            }
            await common.rpc.updateAthlete(athleteId, {wPrime});
            athlete.wPrime = wPrime;
            rerender();
        } else if (ev.key === 'Escape') {
            done = true;
            rerender();
        }
    });
}


export async function render(el, tpl, tplData) {
    const athleteId = tplData.athleteId;
    const rerender = async () => el.replaceChildren(...(await tpl(tplData)).children);
    el.addEventListener('click', async ev => {
        const a = ev.target.closest('header a[data-action]');
        if (!a) {
            const wp = ev.target.closest('a.wprime');
            if (wp) {
                handleWPrimeEdit(wp, tplData, rerender);
            }
            return;
        }
        ev.preventDefault();
        if (a.dataset.action === 'toggleMuted') {
            tplData.athlete.muted = !tplData.athlete.muted;
            await common.rpc.updateAthlete(athleteId, {muted: tplData.athlete.muted});
        } else if (a.dataset.action === 'toggleMarked') {
            tplData.athlete.marked = !tplData.athlete.marked;
            await common.rpc.updateAthlete(athleteId, {marked: tplData.athlete.marked});
        } else if (a.dataset.action === 'watch') {
            await common.rpc.watch(athleteId);
            return;
        } else if (a.dataset.action === 'join') {
            await common.rpc.join(athleteId);
            return;
        } else if (a.dataset.action === 'follow') {
            tplData.athlete = await common.rpc.setFollowing(athleteId);
        } else if (a.dataset.action === 'unfollow') {
            tplData.athlete = await common.rpc.setNotFollowing(athleteId);
        } else if (a.dataset.action === 'rideon') {
            await common.rpc.giveRideon(athleteId);
            tplData.rideonSent = true;
        } else {
            alert("Invalid command: " + a.dataset.action);
        }
        await rerender();
    });
    common.subscribe('nearby', async data => {
        const live = data.find(x => x.athleteId === athleteId);
        if (!live) {
            return;
        }
        const liveEls = Object.fromEntries(Array.from(el.querySelectorAll('.live'))
            .map(x => [x.dataset.id, x]));
        liveEls.power.innerHTML = H.power(live.state.power, {suffix: true, html: true});
        liveEls.speed.innerHTML = H.pace(live.state.speed, {suffix: true, html: true});
        liveEls.hr.textContent = H.number(live.state.heartrate);
        liveEls.rideons.textContent = H.number(live.state.rideons);
        liveEls.kj.textContent = H.number(live.state.kj);
        if (tplData.debug) {
            document.querySelector('.debug').textContent = JSON.stringify([live.state, live.athlete], null, 4);
        }
    });
    await rerender();
}
