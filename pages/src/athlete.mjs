import * as common from './common.mjs';
import {locale, template} from '../../shared/sauce/index.mjs';

const H = locale.human;
locale.setImperial(common.storage.get('/imperialUnits'));
const athleteId = Number((new URLSearchParams(location.search)).get('athleteId'));
const gettingAthlete = common.rpc.getAthlete(athleteId || 1, {refresh: true});
const gettingTemplate = template.getTemplate('templates/athlete.html.tpl');
const gettingGameConnectionStatus = common.rpc.getGameConnectionStatus();
const gettingCountries = fetch('deps/src/countries.json').then(r => r.ok ? r.json() : null);


export async function main() {
    common.initInteractionListeners();
    const profile = await gettingAthlete;
    const tpl = await gettingTemplate;
    const gameConnectionStatus = await gettingGameConnectionStatus;
    const countries = await gettingCountries;
    const nations = countries && Object.fromEntries(countries.map(({id, en}) => [id, en]));
    const flags = countries && Object.fromEntries(countries.map(({id, alpha2}) =>
        [id, `deps/flags/${alpha2}.png`]));
    const debug = location.search.includes('debug');
    const tplData = {
        debug,
        athleteId,
        profile,
        gameConnectionStatus,
        nations,
        flags,
        prettyType: profile && {
            NORMAL: '',
            PACER_BOT: 'Pacer Bot',
        }[profile.type],
    };
    const profileFrag = await tpl(tplData);
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
        } else if (a.dataset.action === 'toggleMarked') {
            profile.marked = !profile.marked;
            await common.rpc.updateAthlete(athleteId, {marked: profile.marked});
        } else if (a.dataset.action === 'watch') {
            await common.rpc.watch(athleteId);
        }
        main.innerHTML = '';
        main.appendChild(await tpl(tplData));
    });
    let lastWatching;
    common.subscribe('nearby', async data => {
        const live = data.find(x => x.athleteId === athleteId);
        if (!live) {
            return;
        }
        const liveEls = Object.fromEntries(Array.from(document.querySelectorAll('.live'))
            .map(x => [x.dataset.id, x]));
        liveEls.power.innerHTML = H.power(live.state.power, {suffix: true, html: true});
        liveEls.speed.innerHTML = H.pace(live.state.speed, {suffix: true, html: true});
        liveEls.hr.textContent = H.number(live.state.heartrate);
        liveEls.rideons.textContent = H.number(live.state.rideons);
        liveEls.kj.textContent = H.number(live.state.kj);
        const watching = live.state.watchingAthleteId;
        if (watching === athleteId) {
            liveEls.watching.textContent = '<self>';
        } else if (watching) {
            if (!lastWatching) {
                lastWatching = await common.rpc.getAthlete(watching);
            }
            liveEls.watching.textContent = lastWatching ? lastWatching.sanitizedFullname : '-';
        }
        if (debug) {
            document.querySelector('.debug').textContent = JSON.stringify(live, null, 4);
        }
    });
}

