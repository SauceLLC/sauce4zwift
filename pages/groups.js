/* global sauce */

async function main() {
    const content = document.querySelector('#content');
    const groupEls = new Map();
    addEventListener('message', ev => {
        if (!ev.data || ev.data.source !== 'sauce4zwift') {
            return;
        }
        if (ev.data.event !== 'groups') {
            return;
        }
        let groups = ev.data.data;
        if (!groups.length) {
            return;
        }
        let centerIdx = groups.findIndex(x => x.watching);
        const behindCount = (groups.length - 1) - centerIdx;
        const adjacent = 3;
        const firstIndex = Math.max(0, centerIdx - adjacent - (behindCount < adjacent ? adjacent - behindCount : 0));
        groups = groups.filter((x, i) => i >= firstIndex && i - firstIndex <= (adjacent * 2));
        centerIdx = groups.findIndex(x => x.watching);
        const center = groups[centerIdx];
        if (!center) {
            return;
        }
        const centerDistGap = center.totDistGap;
        const centerTimeGap = center.totTimeGap;
        const totAthletes = groups.reduce((agg, x) => agg + x.athletes.length, 0);
        const totGap = Math.round(groups[groups.length - 1].totTimeGap - groups[0].totTimeGap);
        content.style.setProperty('--total-athletes', totAthletes);
        content.style.setProperty('--total-gap', totGap);
        const active = new Set();
        let i = 0;
        for (const x of groups) {
            const relPos = i++ - centerIdx;
            active.add(relPos);
            if (!groupEls.has(relPos)) {
                const group = document.createElement('div');
                group.classList.add('group');
                group.style.setProperty('--rel-pos', relPos);
                const bubble = document.createElement('div');
                bubble.classList.add('bubble');
                const bubbleDesc = document.createElement('div');
                bubbleDesc.classList.add('desc');
                group.appendChild(bubble);
                group.appendChild(bubbleDesc);

                const gap = document.createElement('div');
                gap.classList.add('gap');
                gap.style.setProperty('--rel-pos', relPos);
                const gapDesc = document.createElement('div');
                gapDesc.classList.add('desc');
                gap.appendChild(gapDesc);

                groupEls.set(relPos, group);
                content.appendChild(group);
                content.appendChild(gap);
            }
            const group = groupEls.get(relPos);
            const timeGap = Math.round(relPos < 0 ?
                x.totTimeGap - centerTimeGap :
                i < groups.length ? groups[i].totTimeGap - centerTimeGap : 0);
            const distGap = Math.round(x.totDistGap - centerDistGap);
            group.classList.toggle('watching', !!x.watching);
            group.style.setProperty('--athletes', x.athletes.length);
            group.querySelector('.bubble').textContent = x.athletes.length.toLocaleString();
            group.querySelector('.desc').innerHTML = [
                Math.round(x.power) + sauce.locale.thinSpace + 'w',
                //Math.round(x.draft) + sauce.locale.thinSpace + '% draft',
            ].join('<br/>');
            const gap = group.nextSibling;
            const innerGap = Math.round(i < groups.length ? groups[i].totTimeGap - x.totTimeGap : 0);
            gap.style.setProperty('--inner-gap', Math.abs(innerGap));
            gap.style.setProperty('--outer-gap', Math.abs(timeGap));
            gap.style.setProperty('--gap-sign', timeGap > 0 ? 1 : -1);
            gap.querySelector('.desc').textContent = innerGap ?
                (innerGap > 0 ? '+' : '-') + sauce.locale.humanDuration(Math.abs(innerGap), {short: true}) :
                '';
        }
        for (const [pos, x] of groupEls.entries()) {
            x.classList.toggle('hidden', !active.has(pos));
        }
    });
}

addEventListener('DOMContentLoaded', () => main());
