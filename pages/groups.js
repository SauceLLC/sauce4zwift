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
        const centerGap = center.totGap;
        const totAthletes = groups.reduce((agg, x) => agg + x.athletes.length, 0);
        const totGap = Math.round(groups[groups.length - 1].totGap - groups[0].totGap);
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
                group.innerHTML = `
                    <div class="bubble"></div>
                    <div class="desc"></div>
                `;
                const gap = document.createElement('div');
                gap.classList.add('gap');
                gap.style.setProperty('--rel-pos', relPos);
                gap.innerHTML = `
                    <div class="desc"></div>
                    <div class="est" title="Estimated gap">(est)</div>
                `;
                content.appendChild(group);
                content.appendChild(gap);
                groupEls.set(relPos, group);
            }
            const group = groupEls.get(relPos);
            const gap = Math.round(relPos < 0 ?
                x.totGap - centerGap :
                i < groups.length ? groups[i].totGap - centerGap : 0);
            const sign = gap < 0 ? -1 : 1;
            group.classList.toggle('watching', !!x.watching);
            group.style.setProperty('--athletes', x.athletes.length);
            group.querySelector('.bubble').textContent = x.athletes.length.toLocaleString();
            group.querySelector('.desc').innerHTML = [
                Math.round(x.power).toLocaleString() + sauce.locale.thinSpace + 'w',
                Math.round(x.speed).toLocaleString() + sauce.locale.thinSpace + 'kph',
            ].join('<br/>');
            const gapEl = group.nextSibling;
            const innerGap = Math.round(i < groups.length ? groups[i].totGap - x.totGap : 0) * sign;
            gapEl.style.setProperty('--inner-gap', Math.abs(innerGap));
            gapEl.style.setProperty('--outer-gap', Math.abs(gap));
            gapEl.style.setProperty('--gap-sign', gap > 0 ? 1 : -1);
            const isReal = x.realGap != null;
            gapEl.classList.toggle('real', isReal);
            gapEl.classList.toggle('alone', !innerGap);
            const dur = innerGap && sauce.locale.humanDuration(Math.abs(gap), {short: true, seperator: ' '});
            gapEl.querySelector('.desc').textContent = dur ? (innerGap > 0 ? '+' : '-') + dur : '';
        }
        for (const [pos, x] of groupEls.entries()) {
            x.classList.toggle('hidden', !active.has(pos));
        }
    });
}

addEventListener('DOMContentLoaded', () => main());
