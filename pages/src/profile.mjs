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
    if (athlete) {
        document.title = `${athlete.sanitizedFullname} - Sauce for Zwift™`;
    }
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
    input.classList.add('no-increment');
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


async function exportFITActivity(athleteId) {
    const fitData = await common.rpc.exportFIT(athleteId);
    const f = new File([new Uint8Array(fitData)], `${athleteId}.fit`, {type: 'application/binary'});
    const l = document.createElement('a');
    l.download = f.name;
    l.style.display = 'none';
    l.href = URL.createObjectURL(f);
    try {
        document.body.appendChild(l);
        l.click();
    } finally {
        URL.revokeObjectURL(l.href);
        l.remove();
    }
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
        } else if (a.dataset.action === 'exportFit') {
            await exportFITActivity(athleteId);
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
        } else if (a.dataset.action === 'close') {
            await common.rpc.closeWindow();
        } else {
            alert("Invalid command: " + a.dataset.action);
        }
        await rerender();
    });
    let lastUpdate = 0;
    function updatePlayerState(state) {
        lastUpdate = Date.now();
        const liveEls = Object.fromEntries(Array.from(el.querySelectorAll('.live'))
            .map(x => [x.dataset.id, x]));
        liveEls.power.innerHTML = H.power(state.power, {suffix: true, html: true});
        liveEls.speed.innerHTML = H.pace(state.speed, {suffix: true, html: true});
        liveEls.hr.textContent = H.number(state.heartrate);
        liveEls.rideons.textContent = H.number(state.rideons);
        liveEls.kj.textContent = H.number(state.kj);
        if (tplData.debug) {
            document.querySelector('.debug').textContent = JSON.stringify([state, tplData.athlete], null, 4);
        }
    }
    // XXX nearby his extremely wasteful and limited in scope, need new system to subscribe to one
    common.subscribe('nearby', async data => {
        const ad = data.find(x => x.athleteId === athleteId);
        if (!ad) {
            return;
        }
        console.log("update now");
        updatePlayerState(ad.state);
    });
    async function getPlayerState() {
        console.debug("Using RPC get player state");
        const state = await common.rpc.getPlayerState(athleteId);
        if (state) {
            updatePlayerState(state);
        }
    }
    // Backup for not nearby or in game.
    setInterval(async () => {
        const now = Date.now();
        if (now - lastUpdate < 9000) {
            return;
        }
        await getPlayerState();
    }, 10000);
    await rerender();
    await getPlayerState();
}
