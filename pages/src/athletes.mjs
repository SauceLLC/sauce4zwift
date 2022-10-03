import * as common from './common.mjs';
import * as sauce from '../../shared/sauce/index.mjs';

export async function main() {
    common.initInteractionListeners();
    const [followers, following, marked] = await Promise.all([
        common.rpc.getFollowerAthletes(),
        common.rpc.getFolloweeAthletes(),
        common.rpc.getMarkedAthletes(),
    ]);
    const athleteCard = await sauce.template.getTemplate(`templates/athlete-card.html.tpl`);
    const contentEl = document.querySelector('#content');
    debugger;
    for (const x of followers) {
        console.log(x);
        contentEl.insertAdjacentElement('beforeend', (await athleteCard(x)).childNodes[0]);
    }
}
