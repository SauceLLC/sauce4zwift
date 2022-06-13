import * as common from './common.mjs';
import {locale, template} from '../../shared/sauce/index.mjs';

const H = locale.human;
locale.setImperial(common.storage.get('/imperialUnits'));
const athleteId = Number((new URLSearchParams(location.search)).get('athleteId'));
const gettingAthlete = common.rpc.getAthlete(athleteId || 1, {refresh: true});
const gettingTemplate = template.getTemplate('templates/athlete.html.tpl');
const gettingGameConnectionStatus = common.rpc.getGameConnectionStatus();


export async function main() {
    common.initInteractionListeners();
    const profile = await gettingAthlete;
    const tpl = await gettingTemplate;
    const gameConnectionStatus = await gettingGameConnectionStatus;
    const profileFrag = await tpl({athleteId, profile, gameConnectionStatus});
    const main = document.querySelector('body > main');
    main.appendChild(profileFrag);
    main.addEventListener('click', async ev => {
        const a = ev.target.closest('header a[data-action]');
        if (!a) {
            return;
        }
        ev.preventDefault();
        if (a.dataset.action === 'toggleMuted') {
            profile.muted = !profile.muted;
            await common.rpc.updateAthlete(athleteId, {muted: profile.muted});
        } else if (a.dataset.action === 'togglePinned') {
            profile.pinned = !profile.pinned;
            await common.rpc.updateAthlete(athleteId, {pinned: profile.pinned});
        } else if (a.dataset.action === 'watch') {
            await common.rpc.watch(athleteId);
        }
        main.innerHTML = '';
        main.appendChild(await tpl({athleteId, profile, gameConnectionStatus}));
    });
    let lastWatching;
    common.subscribe('nearby', async data => {
        const liveEls = Object.fromEntries(Array.from(document.querySelectorAll('.live'))
            .map(x => [x.dataset.id, x]));
        for (const x of data) {
            if (x.athleteId === athleteId) {
                liveEls.power.textContent = H.number(x.state.power);
                liveEls.hr.textContent = H.number(x.state.heartrate);
                liveEls.rideons.textContent = H.number(x.state.rideons);
                liveEls.kj.textContent = H.number(x.state.kj);
                const watching = x.state.watchingAthleteId;
                if (watching === athleteId) {
                    liveEls.watching.textContent = 'self';
                } else if (watching) {
                    if (!lastWatching) {
                        lastWatching = await common.rpc.getAthlete(watching);
                    }
                    liveEls.watching.textContent = lastWatching ? lastWatching.sanitizedFullname : '-';
                }
            }
        }
    });
}

