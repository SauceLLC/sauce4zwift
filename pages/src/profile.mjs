import * as common from './common.mjs';
import {locale, template} from '../../shared/sauce/index.mjs';

const q = new URLSearchParams(location.search);

const H = locale.human;
const ident = q.get('id') || q.get('athleteId') || 'self';
let gettingAthlete;
let gettingTemplate;
let gettingWorldList;
let gettingGameConnectionStatus;
let pendingInitNationFlags;


export function init() {
    gettingAthlete = common.rpc.getAthlete(ident, {refresh: true});
    gettingTemplate = template.getTemplate('templates/profile.html.tpl');
    gettingWorldList = common.getWorldList();
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
    const gcs = await gettingGameConnectionStatus;
    const {nations, flags} = await pendingInitNationFlags;
    const debug = location.search.includes('debug');
    const tplData = {
        debug,
        athleteId: athlete && athlete.id,
        athlete,
        gameConnection: gcs && gcs.connected,
        nations,
        flags,
        common,
        worldList: await gettingWorldList,
    };
    const mainEl = document.querySelector('body > main');
    await render(mainEl, tpl, tplData);
}


function handleInlineEdit(el, {athleteId, athlete}, rerender) {
    const key = el.dataset.key;
    const type = el.dataset.type;
    const input = document.createElement('input');
    input.type = type;
    input.value = athlete[key];
    input.classList.add('hide-spinner');
    el.replaceChildren(input);
    let done;
    input.focus();
    document.addEventListener('keydown', async ev => {
        if (done) {
            return;
        }
        if (ev.key === 'Enter') {
            done = true;
            let v;
            if (type === 'number') {
                v = Number(input.value);
                if (isNaN(v)) {
                    alert('Invalid number');
                    return;
                }
            } else {
                throw new TypeError("unimplemented");
            }
            await common.rpc.updateAthlete(athleteId, {[key]: v});
            athlete[key] = v;
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
            const editable = ev.target.closest('.inline-edit');
            if (editable) {
                handleInlineEdit(editable, tplData, rerender);
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
    let inGame;
    function setInGame(en) {
        if (en === inGame) {
            return;
        }
        inGame = en;
        const nodes = el.querySelectorAll('.enabled-in-game-only');
        if (inGame) {
            nodes.forEach(x => x.removeAttribute('disabled'));
        } else {
            nodes.forEach(x => x.setAttribute('disabled', 'disabled'));
        }
    }
    let lastUpdate = 0;
    function updatePlayerState(state) {
        lastUpdate = Date.now();
        const world = tplData.worldList.find(x => x.courseId === state.courseId);
        const liveEls = Object.fromEntries(Array.from(el.querySelectorAll('.live'))
            .map(x => [x.dataset.id, x]));
        liveEls.world.textContent = world ? world.name : '-';
        liveEls.power.innerHTML = H.power(state.power, {suffix: true, html: true});
        liveEls.speed.innerHTML = H.pace(state.speed, {suffix: true, html: true});
        liveEls.hr.textContent = H.number(state.heartrate);
        liveEls.rideons.textContent = H.number(state.rideons);
        liveEls.kj.textContent = H.number(state.kj);
        if (tplData.debug) {
            document.querySelector('.debug').textContent = JSON.stringify([state, tplData.athlete], null, 4);
        }
    }
    async function getPlayerState() {
        if (document.hidden) {
            console.warn("hidden");
            return;
        }
        console.debug("Using RPC get player state");
        const state = await common.rpc.getPlayerState(athleteId);
        setInGame(!!state);
        if (state) {
            updatePlayerState(state);
        }
    }
    // Backup for not nearby or in game.
    const pollInterval = setInterval(async () => {
        const now = Date.now();
        if (now - lastUpdate < 9000) {
            return;
        }
        await getPlayerState();
    }, 10000);
    await rerender();
    await getPlayerState();
    const onAthleteData = data => {
        setInGame(true);
        updatePlayerState(data.state);
    };
    await common.subscribe(`athlete/${athleteId}`, onAthleteData);
    return function cleanup() {
        clearInterval(pollInterval);
        common.unsubscribe(`athlete/${athleteId}`, onAthleteData);
    };
}
