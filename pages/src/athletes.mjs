import * as Common from './common.mjs';
import * as Sauce from '../../shared/sauce/index.mjs';

Common.enableSentry();

const athleteCardsPromise = Sauce.template.getTemplate(`templates/athlete-cards.html.tpl`);


function onFilterInput(ev) {
    let term = ev.currentTarget.value;
    if (term.length < 3) {
        term = '';
    }
    let re;
    try {
        re = term && new RegExp(term, 'i');
    } catch(e) {/*no-pragm*/}
    if (re) {
        for (const el of document.querySelectorAll('.card')) {
            el.classList.toggle('hidden', !el.textContent.match(re));
        }
    } else {
        for (const el of document.querySelectorAll('.card')) {
            el.classList.toggle('hidden', !!term || !el.textContent.includes(term));
        }
    }
}


function onSearchClick(ev) {
    if (!ev.target.closest('.search-box')) {
        ev.currentTarget.querySelector('.search-box').classList.toggle('visible');
        ev.currentTarget.querySelector('input').focus();
    }
}


let searchTimeout;
function onSearchInput(ev) {
    clearTimeout(searchTimeout);
    const el = ev.currentTarget;
    searchTimeout = setTimeout(() => _onSearchInput(el), 500);
}


async function _onSearchInput(el) {
    const resultsEl = el.parentElement.querySelector('.results');
    const term = el.value.trim();
    const athleteCards = await athleteCardsPromise;
    let results;
    if (Number(term).toString() === term) {
        for (const refresh of [false, true]) {
            results = [await Common.rpc.getAthlete(Number(term), {refresh})]
                .filter(x => x).map(x => ({id: x.id, athlete: x}));
            if (results.length) {
                break;
            }
        }
    } else {
        if (term.length < 3) {
            resultsEl.innerHTML = '';
            return;
        }
        results = await Common.rpc.searchAthletes(term, {pageLimit: 1, limit: 50, start: 0});
    }
    resultsEl.replaceChildren(await athleteCards(results));
}


function onHeaderClickDelegate(ev) {
    const header = ev.target.closest('header');
    const section = header && header.closest('section');
    if (header && section) {
        section.classList.toggle('compressed');
    }
}


export async function main() {
    Common.initInteractionListeners();
    document.querySelector('#titlebar input[name="filter"]').addEventListener('input', onFilterInput);
    document.querySelector('#titlebar .button.search').addEventListener('click', onSearchClick);
    document.querySelector('#titlebar .search-box input').addEventListener('input', onSearchInput);
    const athleteCards = await athleteCardsPromise;
    const contentEl = document.querySelector('#content');
    contentEl.addEventListener('click', onHeaderClickDelegate);
    await Promise.all([
        Common.rpc.getFollowingAthletes().then(async x =>
            contentEl.querySelector('section.following .cards').append(await athleteCards(x))),
        Common.rpc.getFollowerAthletes().then(async x =>
            contentEl.querySelector('section.followers .cards').append(await athleteCards(x))),
        Common.rpc.getMarkedAthletes().then(async x =>
            contentEl.querySelector('section.marked .cards').append(await athleteCards(x))),
    ]);
}
