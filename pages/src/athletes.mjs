import * as common from './common.mjs';
import * as sauce from '../../shared/sauce/index.mjs';


const athleteCardsPromise = sauce.template.getTemplate(`templates/athlete-cards.html.tpl`);


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


async function onSearchInput(ev) {
    const resultsEl = ev.currentTarget.parentElement.querySelector('.results');
    let term = ev.currentTarget.value;
    if (term.length < 3) {
        resultsEl.innerHTML = '';
        return;
    }
    const athleteCards = await athleteCardsPromise;
    const results = await common.rpc.searchAthletes(term, {pageLimit: 1, limit: 10, start: 0});
    resultsEl.innerHTML = '';
    resultsEl.append(await athleteCards(results));
}
 

export async function main() {
    common.initInteractionListeners();
    document.querySelector('#titlebar input[name="filter"]').addEventListener('input', onFilterInput);
    document.querySelector('#titlebar .button.search').addEventListener('click', onSearchClick);
    document.querySelector('#titlebar .search-box input').addEventListener('input', onSearchInput);
    const athleteCards = await athleteCardsPromise;
    const contentEl = document.querySelector('#content');
    await Promise.all([
        common.rpc.getFolloweeAthletes().then(async x =>
            contentEl.querySelector('section.following .cards').append(await athleteCards(x))),
        common.rpc.getFollowerAthletes().then(async x =>
            contentEl.querySelector('section.followers .cards').append(await athleteCards(x))),
        common.rpc.getMarkedAthletes().then(async x =>
            contentEl.querySelector('section.marked .cards').append(await athleteCards(x))),
    ]);
}
